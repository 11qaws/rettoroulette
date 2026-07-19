import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { DrawMode, DrawTarget, WheelPresentation } from '../types';
import {
  createDartAimSession,
  createDartPhysicalCommit,
  createSpinPhysicalCommit,
  resolveDartImpactPoint,
  type DartAimSession,
  type DartPhysicalCommit,
  type RouletteFinishLanding,
  type SpinPhysicalCommit,
} from '../lib/roulette';
import type {
  RouletteRevealEvent,
  RouletteRevealPhase,
  RouletteWheelHandle,
} from './RouletteWheel';
import MarbleRace from './MarbleRace';
import RouletteWheel from './RouletteWheel';

import './DrawPreviewDirector.css';

const SAMPLE_PEOPLE = ['아모레또', '유레카', '세나', '코코', '망징이'];
const SAMPLE_PRIZES = ['선물 A', '선물 B', '선물 C', '선물 D', '선물 E', '선물 F'];
const PREVIEW_COMMIT_DELAY = 120;
const PREVIEW_RESULT_HOLD = 900;
const PREVIEW_RESTART_GAP = 220;

function createPreviewRandom(seed: number) {
  let state = (seed + 1) * 0x9e3779b1;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 0x21f0aaad);
    state = Math.imul(state ^ (state >>> 15), 0x735a2d97);
    state ^= state >>> 15;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export type PreviewPhase =
  | 'idle'
  | 'cruise'
  | 'result-committed'
  | 'motion-started'
  | 'hold'
  | RouletteRevealPhase;

/**
 * A committed preview result is private until its physical presentation has
 * started. The stopped hold is the only non-moving phase allowed to retain it.
 */
export function canExposePreviewWinner(phase: PreviewPhase, moving: boolean) {
  return moving || phase === 'hold';
}

type PreviewCameraStyle = CSSProperties & {
  '--cinematic-impact-x': string;
  '--cinematic-impact-y': string;
  '--cinematic-final-x': string;
  '--cinematic-final-y': string;
};

export interface DrawPreviewDirectorProps {
  names: readonly string[];
  weights?: readonly number[];
  target: DrawTarget;
  mode: DrawMode;
  presentation: WheelPresentation;
  title?: string;
}

export default function DrawPreviewDirector({
  names,
  weights,
  target,
  mode,
  presentation,
  title,
}: DrawPreviewDirectorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const wheelRef = useRef<RouletteWheelHandle>(null);
  const timersRef = useRef<number[]>([]);
  const runIdRef = useRef(0);
  const armedRunIdRef = useRef(0);
  const spinKeyRef = useRef(0);
  const sampleIndexRef = useRef(0);
  const singleRunRef = useRef(false);
  const [spinKey, setSpinKey] = useState(0);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [dartAim, setDartAim] = useState<DartAimSession | null>(null);
  const [spinCommit, setSpinCommit] = useState<SpinPhysicalCommit | null>(null);
  const [dartCommit, setDartCommit] = useState<DartPhysicalCommit | null>(null);
  const [landing, setLanding] = useState<RouletteFinishLanding>({
    kind: 'interior',
    positionRatio: 0.5,
    entryGapDegrees: 0,
    leadDegrees: 0,
    boundaryHit: false,
  });
  const [moving, setMoving] = useState(false);
  const [phase, setPhase] = useState<PreviewPhase>('idle');
  const [inViewport, setInViewport] = useState(true);
  const [documentVisible, setDocumentVisible] = useState(() => document.visibilityState !== 'hidden');
  const [reducedMotion, setReducedMotion] = useState(() => (
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  ));

  const isSample = names.length === 0;
  const previewNames = useMemo(
    () => isSample ? (target === 'people' ? SAMPLE_PEOPLE : SAMPLE_PRIZES) : [...names],
    [isSample, names, target],
  );
  const previewWeights = isSample ? undefined : weights;
  const signature = useMemo(
    () => [target, mode, presentation, previewNames.join('\u001f'), previewWeights?.join(',') ?? 'equal'].join('|'),
    [mode, presentation, previewNames, previewWeights, target],
  );
  const active = inViewport && documentVisible;
  const previewTitle = title?.trim() || (target === 'people' ? '당첨자 추첨' : '상품 추첨');

  const clearTimers = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current = [];
  }, []);

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(callback, delay);
    timersRef.current.push(timer);
  }, []);

  const startCycle = useCallback((single = false) => {
    clearTimers();
    runIdRef.current += 1;
    const runId = runIdRef.current;
    armedRunIdRef.current = 0;
    singleRunRef.current = single;
    setMoving(false);
    setWinnerIndex(null);
    setSpinCommit(null);
    setDartCommit(null);
    setDartAim(presentation === 'dart'
      ? createDartAimSession(
          runId,
          typeof performance === 'undefined' ? Date.now() : performance.now(),
          createPreviewRandom(runId + 301),
        )
      : null);
    setPhase(reducedMotion && !single ? 'idle' : 'cruise');

    if (!active || (reducedMotion && !single) || previewNames.length === 0) return;

    if (mode === 'marble') {
      schedule(() => {
        if (runId !== runIdRef.current) return;
        const nextWinner = sampleIndexRef.current % previewNames.length;
        sampleIndexRef.current += 1;
        spinKeyRef.current += 1;
        setWinnerIndex(nextWinner);
        setSpinKey(spinKeyRef.current);
        setPhase('motion-started');
        setMoving(true);
      }, 520);
    }
  }, [active, clearTimers, mode, presentation, previewNames.length, reducedMotion, schedule]);

  const commitWheelPreview = useCallback((runId: number) => {
    if (runId !== runIdRef.current || previewNames.length === 0 || mode !== 'wheel') return;

    sampleIndexRef.current += 1;
    const sampleIndex = sampleIndexRef.current;
    let nextWinner: number;
    let nextLanding: RouletteFinishLanding;
    let nextSpinCommit: SpinPhysicalCommit | null = null;
    let nextDartCommit: DartPhysicalCommit | null = null;

    if (presentation === 'dart') {
      const capture = wheelRef.current?.freezeDartAim();
      if (!capture) {
        armedRunIdRef.current = 0;
        return;
      }
      nextDartCommit = createDartPhysicalCommit(
        capture.rotation,
        capture.angularVelocity,
        previewNames.length,
        previewWeights,
        capture.shot,
      );
      if (!nextDartCommit) {
        armedRunIdRef.current = 0;
        return;
      }
      nextWinner = nextDartCommit.winnerIndex;
      nextLanding = nextDartCommit.landing;
    } else {
      const capture = wheelRef.current?.captureRotor();
      if (!capture) {
        armedRunIdRef.current = 0;
        return;
      }
      nextSpinCommit = createSpinPhysicalCommit(
        capture.rotation,
        capture.angularVelocity,
        previewNames.length,
        previewWeights,
        createPreviewRandom(sampleIndex + 701),
        capture.selectionGeometry,
      );
      if (!nextSpinCommit) {
        armedRunIdRef.current = 0;
        return;
      }
      nextWinner = nextSpinCommit.winnerIndex;
      nextLanding = nextSpinCommit.landing;
    }

    spinKeyRef.current += 1;
    const nextSpinKey = spinKeyRef.current;
    setLanding(nextLanding);
    setSpinCommit(nextSpinCommit);
    setDartCommit(nextDartCommit);
    setPhase('result-committed');
    schedule(() => {
      if (runId !== runIdRef.current) return;
      // Match the live path: the committed winner enters the visual component
      // in the same render as motion. A stopped wheel must never see it first.
      setSpinKey(nextSpinKey);
      setWinnerIndex(nextWinner);
      setPhase('motion-started');
      setMoving(true);
    }, presentation === 'dart' ? 0 : 140);
  }, [mode, presentation, previewNames.length, previewWeights, schedule]);

  const handleIdleCruise = useCallback(() => {
    const runId = runIdRef.current;
    if (!active || mode !== 'wheel' || armedRunIdRef.current === runId) return;
    armedRunIdRef.current = runId;
    schedule(() => commitWheelPreview(runId), PREVIEW_COMMIT_DELAY);
  }, [active, commitWheelPreview, mode, schedule]);

  const finishCycle = useCallback((runId: number) => {
    if (runId !== runIdRef.current) return;
    setMoving(false);
    setPhase('hold');
    if (singleRunRef.current || !active || reducedMotion) return;

    schedule(() => {
      if (runId !== runIdRef.current) return;
      setWinnerIndex(null);
      setSpinCommit(null);
      setDartCommit(null);
      setPhase('idle');
      schedule(() => {
        if (runId !== runIdRef.current) return;
        startCycle(false);
      }, PREVIEW_RESTART_GAP);
    }, PREVIEW_RESULT_HOLD);
  }, [active, reducedMotion, schedule, startCycle]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const onChange = () => setReducedMotion(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setDocumentVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => setInViewport(entry?.isIntersecting ?? true), {
      threshold: 0.08,
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => startCycle(false), 180);
    return () => {
      window.clearTimeout(timer);
      runIdRef.current += 1;
      clearTimers();
    };
  }, [active, clearTimers, signature, startCycle]);

  useEffect(() => () => {
    runIdRef.current += 1;
    clearTimers();
  }, [clearTimers]);

  const handleRevealPhase = (event: RouletteRevealEvent) => {
    if (event.spinKey !== spinKeyRef.current) return;
    setPhase(event.phase);
  };

  const rootClassName = [
    'draw-preview-director',
    'broadcast-focus',
    `preview-phase--${phase}`,
    `reveal-phase--${phase}`,
    moving ? 'is-moving' : '',
    isSample ? 'is-sample' : '',
    reducedMotion ? 'is-reduced-motion' : '',
  ].filter(Boolean).join(' ');
  const previewImpactPoint = resolveDartImpactPoint(dartCommit?.shot);
  const exposedWinnerIndex = canExposePreviewWinner(phase, moving) ? winnerIndex : null;
  const cameraStyle: PreviewCameraStyle = {
    '--cinematic-impact-x': `${previewImpactPoint.xPercent}%`,
    '--cinematic-impact-y': `${previewImpactPoint.yPercent}%`,
    '--cinematic-final-x': `${previewImpactPoint.finalXPercent}%`,
    '--cinematic-final-y': `${previewImpactPoint.finalYPercent}%`,
  };

  return (
    <div ref={rootRef} className={rootClassName} data-preview-signature={signature}>
      <h3 className="draw-preview-director__title" title={previewTitle}>{previewTitle}</h3>
      <div className="draw-preview-director__badge">
        <strong>미리보기</strong>
        <span>{isSample ? '샘플 명단' : '결과에 반영되지 않음'}</span>
      </div>

      <div className="draw-preview-director__viewport broadcast-focus__camera" style={cameraStyle}>
        {mode === 'wheel' ? (
          <RouletteWheel
            ref={wheelRef}
            participants={previewNames}
            weights={previewWeights}
            itemType={target === 'prizes' ? 'prize' : 'participant'}
            winnerIndex={exposedWinnerIndex}
            spinning={moving}
            idleSpinning={active && phase !== 'idle' && !moving && winnerIndex === null}
            spinKey={spinKey}
            revealId={spinKey}
            presentation={presentation}
            landing={landing}
            spinCommit={presentation === 'spin' ? spinCommit ?? undefined : undefined}
            dartShot={presentation === 'dart' ? dartCommit?.shot : undefined}
            dartAim={presentation === 'dart' ? dartAim ?? undefined : undefined}
            dartCommit={presentation === 'dart' ? dartCommit ?? undefined : undefined}
            onRevealPhase={handleRevealPhase}
            onIdleCruise={handleIdleCruise}
            onSpinEnd={() => finishCycle(runIdRef.current)}
          />
        ) : (
          <MarbleRace
            participants={previewNames}
            itemType={target === 'prizes' ? 'prize' : 'participant'}
            winnerIndex={exposedWinnerIndex}
            racing={moving}
            raceKey={spinKey}
            onRaceEnd={() => finishCycle(runIdRef.current)}
          />
        )}
      </div>

      <button
        className="draw-preview-director__replay"
        type="button"
        onClick={() => startCycle(reducedMotion)}
        disabled={moving}
        aria-label="연출 미리보기 다시 재생"
      >
        ↻ 다시 보기
      </button>
    </div>
  );
}
