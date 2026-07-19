import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DrawMode, DrawTarget, WheelPresentation } from '../types';
import type { RouletteRevealEvent, RouletteRevealPhase } from './RouletteWheel';
import MarbleRace from './MarbleRace';
import RouletteWheel from './RouletteWheel';

import './DrawPreviewDirector.css';

const SAMPLE_PEOPLE = ['참가자 A', '참가자 B', '참가자 C', '참가자 D', '참가자 E', '참가자 F'];
const SAMPLE_PRIZES = ['선물 A', '선물 B', '선물 C', '선물 D', '선물 E', '선물 F'];
const PREVIEW_CRUISE_DELAY = 900;
const PREVIEW_RESULT_HOLD = 900;
const PREVIEW_RESTART_GAP = 220;

type PreviewPhase = 'idle' | 'cruise' | 'motion' | 'hold' | RouletteRevealPhase;

export interface DrawPreviewDirectorProps {
  names: readonly string[];
  weights?: readonly number[];
  target: DrawTarget;
  mode: DrawMode;
  presentation: WheelPresentation;
}

export default function DrawPreviewDirector({
  names,
  weights,
  target,
  mode,
  presentation,
}: DrawPreviewDirectorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const timersRef = useRef<number[]>([]);
  const runIdRef = useRef(0);
  const spinKeyRef = useRef(0);
  const sampleIndexRef = useRef(0);
  const singleRunRef = useRef(false);
  const [spinKey, setSpinKey] = useState(0);
  const [visualRunId, setVisualRunId] = useState(0);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
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
    setVisualRunId(runId);
    singleRunRef.current = single;
    setMoving(false);
    setWinnerIndex(null);
    setPhase(reducedMotion && !single ? 'idle' : 'cruise');

    if (!active || (reducedMotion && !single) || previewNames.length === 0) return;

    schedule(() => {
      if (runId !== runIdRef.current) return;
      const nextWinner = sampleIndexRef.current % previewNames.length;
      sampleIndexRef.current += 1;
      spinKeyRef.current += 1;
      setWinnerIndex(nextWinner);
      setSpinKey(spinKeyRef.current);
      setPhase('motion');
      setMoving(true);
    }, mode === 'marble' ? 520 : PREVIEW_CRUISE_DELAY);
  }, [active, clearTimers, mode, previewNames.length, reducedMotion, schedule]);

  const finishCycle = useCallback((runId: number) => {
    if (runId !== runIdRef.current) return;
    setMoving(false);
    setPhase('hold');
    if (singleRunRef.current || !active || reducedMotion) return;

    schedule(() => {
      if (runId !== runIdRef.current) return;
      setWinnerIndex(null);
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
    `preview-phase--${phase}`,
    moving ? 'is-moving' : '',
    isSample ? 'is-sample' : '',
    reducedMotion ? 'is-reduced-motion' : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={rootClassName} data-preview-signature={signature}>
      <div className="draw-preview-director__badge">
        <strong>미리보기</strong>
        <span>{isSample ? '샘플 명단' : '결과에 반영되지 않음'}</span>
      </div>

      <div className="draw-preview-director__viewport" key={`${signature}-${visualRunId}`}>
        {mode === 'wheel' ? (
          <RouletteWheel
            participants={previewNames}
            weights={previewWeights}
            itemType={target === 'prizes' ? 'prize' : 'participant'}
            winnerIndex={winnerIndex}
            spinning={moving}
            idleSpinning={active && !reducedMotion && !moving && winnerIndex === null}
            spinKey={spinKey}
            revealId={spinKey}
            presentation={presentation}
            landing={{ entryGapDegrees: 14, leadDegrees: 0.55, boundaryHit: true }}
            onRevealPhase={handleRevealPhase}
            onSpinEnd={() => finishCycle(visualRunId)}
          />
        ) : (
          <MarbleRace
            participants={previewNames}
            itemType={target === 'prizes' ? 'prize' : 'participant'}
            winnerIndex={winnerIndex}
            racing={moving}
            raceKey={spinKey}
            onRaceEnd={() => finishCycle(visualRunId)}
          />
        )}
      </div>

      <button
        className="draw-preview-director__replay"
        type="button"
        onClick={() => startCycle(reducedMotion)}
        aria-label="연출 미리보기 다시 재생"
      >
        ↻ 다시 보기
      </button>
    </div>
  );
}
