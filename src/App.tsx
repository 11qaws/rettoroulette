import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CurrentRoundWinners from './components/CurrentRoundWinners';
import MarbleRace from './components/MarbleRace';
import ParticipantSetup from './components/ParticipantSetup';
import RouletteWheel from './components/RouletteWheel';
import WinnerHero from './components/WinnerHero';
import { csvField } from './lib/csv';
import {
  buildWeightedDrawPlanWithReplacement,
  buildWeightedDrawPlanWithoutReplacement,
  sampleWithoutReplacement,
} from './lib/draw';
import {
  getRaffleTransition,
  isRaffleActive,
  RAFFLE_STATUS_META,
  type RaffleEvent,
  type RaffleStatus,
} from './lib/raffleLifecycle';
import type { RouletteFinishLanding } from './lib/roulette';
import type { DrawMode, DrawRecord, DrawTarget, Participant, Prize, WheelPresentation } from './types';

import './App.css';

type DrawOption = {
  id: string;
  /** Inventory source for a prize unit; participant options use their own id. */
  sourceId?: string;
  name: string;
  weight: number;
};

type SideTab = 'participants' | 'prizes' | 'history';
type SetupStartStep = 'paste' | 'edit';
type SetupReturnStatus = Extract<RaffleStatus, 'configuring' | 'ready' | 'completed'>;

type CurrentRound = {
  id: string;
  target: DrawTarget;
  mode: DrawMode;
  wheelPresentation: WheelPresentation;
  winnerGoal: number;
  candidateCount: number;
  candidateTotalWeight: number;
  /** A limited people pool stays fixed for the whole active round. */
  poolLimit: number;
  removeAfterDraw: boolean;
  useWeights: boolean;
  recipient?: string;
  results: DrawRecord[];
  /** The host ended an unfinished multi-shot dart round deliberately. */
  endedEarly?: boolean;
};

type PlannedPresentation = {
  options: DrawOption[];
  winnerIndex: number;
  target: DrawTarget;
  selectedAt: string;
  candidateFingerprint: string;
  candidateTotalWeight: number;
  /** Changes only where the committed result stops inside its slice. */
  landing: RouletteFinishLanding;
  recipient?: string;
};

type ActivePresentation = PlannedPresentation & {
  /** Rejects an animation callback from an older result or abandoned round. */
  revealId: number;
};

type PresentationBeat = 'idle' | 'motion' | 'hero' | 'dock';
type RevealContinuation = 'continue-auto' | 'await-next-dart' | 'complete-round';

type WinnerHeroState = {
  revealId: number;
  result: DrawRecord;
  total: number;
  continuation: RevealContinuation;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(iso: string, includeSeconds = false) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
  }).format(new Date(iso));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value) || min));
}

function prizeTotal(prizes: Prize[]) {
  return prizes.reduce((sum, prize) => sum + Math.max(0, prize.quantity), 0);
}

function totalEffectiveWeight(options: readonly DrawOption[]) {
  return options.reduce((sum, option) => sum + Math.max(0, option.weight), 0);
}

/** Result-neutral visual variation created only after a winner is selected. */
function createFinishLanding(): RouletteFinishLanding {
  const photoFinish = Math.random() < 0.24;
  return photoFinish
    ? {
        entryGapDegrees: 1.5 + Math.random() * 1.8,
        leadDegrees: 1.4 + Math.random() * 1.7,
      }
    : {
        entryGapDegrees: 8 + Math.random() * 10,
        leadDegrees: 7 + Math.random() * 9,
      };
}

/** A compact audit marker without persisting an unbounded copy of a large roster. */
function fingerprintOptions(options: readonly DrawOption[]) {
  let hash = 0x811c9dc5;

  for (const option of options) {
    const token = `${option.id}\u001f${option.name}\u001f${option.weight}\u001e`;
    for (let index = 0; index < token.length; index += 1) {
      hash ^= token.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
  }

  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function App() {
  const [drawMode, setDrawMode] = useState<DrawMode>('wheel');
  const [wheelPresentation, setWheelPresentation] = useState<WheelPresentation>('spin');
  const [drawTarget, setDrawTarget] = useState<DrawTarget>('people');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [excludedParticipantIds, setExcludedParticipantIds] = useState<string[]>([]);
  const [poolLimit, setPoolLimit] = useState(0);
  const [poolIds, setPoolIds] = useState<string[]>([]);
  const [winnerCount, setWinnerCount] = useState(1);
  const [removeAfterDraw, setRemoveAfterDraw] = useState(true);
  const [useWeights, setUseWeights] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [queuedPresentations, setQueuedPresentations] = useState<PlannedPresentation[]>([]);
  const [spinning, setSpinning] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [presentedOptions, setPresentedOptions] = useState<DrawOption[]>([]);
  const [activePresentation, setActivePresentation] = useState<ActivePresentation | null>(null);
  const [presentationBeat, setPresentationBeat] = useState<PresentationBeat>('idle');
  const [winnerHero, setWinnerHero] = useState<WinnerHeroState | null>(null);
  const [currentRound, setCurrentRound] = useState<CurrentRound | null>(null);
  const [history, setHistory] = useState<DrawRecord[]>([]);
  const [sideTab, setSideTab] = useState<SideTab>('participants');
  const [raffleStatus, setRaffleStatus] = useState<RaffleStatus>('roster');
  const [setupReturnStatus, setSetupReturnStatus] = useState<SetupReturnStatus>('configuring');
  const [setupSession, setSetupSession] = useState(0);
  const [setupStartStep, setSetupStartStep] = useState<SetupStartStep>('paste');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const toolsCloseRef = useRef<HTMLButtonElement>(null);
  const toolsDrawerRef = useRef<HTMLElement>(null);
  const raffleStatusRef = useRef<RaffleStatus>('roster');
  const presentationRunRef = useRef(0);
  const winnerHeroTimerRef = useRef<number | null>(null);
  const winnerDockTimerRef = useRef<number | null>(null);

  const transitionRaffle = useCallback((event: RaffleEvent) => {
    const nextStatus = getRaffleTransition(raffleStatusRef.current, event);
    if (!nextStatus) return false;
    raffleStatusRef.current = nextStatus;
    setRaffleStatus(nextStatus);
    return true;
  }, []);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const cancelWinnerRevealTimers = useCallback(() => {
    if (winnerHeroTimerRef.current !== null) {
      window.clearTimeout(winnerHeroTimerRef.current);
      winnerHeroTimerRef.current = null;
    }
    if (winnerDockTimerRef.current !== null) {
      window.clearTimeout(winnerDockTimerRef.current);
      winnerDockTimerRef.current = null;
    }
  }, []);

  const closeTools = useCallback((restoreFocus = false) => {
    setToolsOpen(false);

    if (restoreFocus) {
      window.requestAnimationFrame(() => toolsTriggerRef.current?.focus());
    }
  }, []);

  useEffect(() => {
    if (!toolsOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => toolsCloseRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeTools(true);
        return;
      }

      if (event.key !== 'Tab') return;

      const drawer = toolsDrawerRef.current;
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>([
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(','))).filter((element) => !element.hasAttribute('hidden'));

      if (focusable.length === 0) {
        event.preventDefault();
        drawer.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !drawer.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeTools, toolsOpen]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('retto-roulette-history');
      if (!saved) return;
      const parsed = JSON.parse(saved) as DrawRecord[];
      if (Array.isArray(parsed)) setHistory(parsed.slice(0, 100));
    } catch {
      // A history failure should never prevent a live giveaway from working.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('retto-roulette-history', JSON.stringify(history.slice(0, 100)));
  }, [history]);

  useEffect(() => {
    if (!window.location.hash.startsWith('#import=')) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    showToast('네이버 URL 자동 가져오기는 종료됐어요. 카페 페이지를 붙여넣어 주세요.');
  }, [showToast]);

  useEffect(() => {
    if (raffleStatus !== 'roster' && raffleStatus !== 'configuring') window.scrollTo(0, 0);
  }, [raffleStatus]);

  useEffect(() => () => {
    // Ignore a late browser animation callback after this app has gone away.
    presentationRunRef.current += 1;
    cancelWinnerRevealTimers();
  }, [cancelWinnerRevealTimers]);

  const eligibleParticipants = useMemo(
    () => participants.filter((participant) => !excludedParticipantIds.includes(participant.id)),
    [excludedParticipantIds, participants],
  );

  useEffect(() => {
    // A limited candidate pool must not silently refill while a round owns its
    // snapshot. An early-ended dart round is complete for this purpose.
    if (currentRound && isRaffleActive(raffleStatus)) return;

    if (poolLimit === 0) {
      if (poolIds.length > 0) setPoolIds([]);
      return;
    }

    const limit = Math.min(poolLimit, eligibleParticipants.length);
    const availableIds = new Set(eligibleParticipants.map((participant) => participant.id));
    const retained = poolIds.filter((id) => availableIds.has(id)).slice(0, limit);
    if (retained.length === limit) {
      if (retained.join('|') !== poolIds.join('|')) setPoolIds(retained);
      return;
    }

    const remaining = eligibleParticipants.filter((participant) => !retained.includes(participant.id));
    const fill = sampleWithoutReplacement(remaining, limit - retained.length).map((participant) => participant.id);
    setPoolIds([...retained, ...fill]);
  }, [currentRound, eligibleParticipants, poolIds, poolLimit, raffleStatus]);

  const candidateParticipants = useMemo(() => {
    if (poolLimit === 0) return eligibleParticipants;
    const selected = new Set(poolIds);
    return eligibleParticipants.filter((participant) => selected.has(participant.id));
  }, [eligibleParticipants, poolIds, poolLimit]);

  const drawOptions = useMemo<DrawOption[]>(() => {
    const options = drawTarget === 'people'
      ? candidateParticipants.map((participant) => ({
          id: participant.id,
          name: participant.name,
          weight: useWeights ? participant.weight : 1,
        }))
      : prizes
          .flatMap((prize) => Array.from(
            { length: Math.max(0, prize.quantity) },
            (_, unitIndex) => ({
              id: `${prize.id}::${unitIndex + 1}`,
              sourceId: prize.id,
              name: prize.name,
              weight: useWeights ? prize.weight : 1,
            }),
          ));

    return useWeights ? options.filter((option) => option.weight > 0) : options;
  }, [candidateParticipants, drawTarget, prizes, useWeights]);

  // People can repeat only when the broadcaster deliberately allows it.
  // Inventory and duplicate-prevention modes are always capped by candidates.
  const maximumWinnerCount = Math.max(
    1,
    drawTarget === 'people' && !removeAfterDraw ? 99 : drawOptions.length,
  );
  const effectiveWinnerCount = Math.min(winnerCount, maximumWinnerCount);

  useEffect(() => {
    if (winnerCount > maximumWinnerCount) setWinnerCount(maximumWinnerCount);
  }, [maximumWinnerCount, winnerCount]);

  const displayOptions = spinning || winnerIndex !== null ? presentedOptions : drawOptions;
  const displayNames = displayOptions.map((option) => option.name);
  const availablePrizeCount = prizeTotal(prizes);
  const isAutoPresentation = currentRound?.mode === 'marble' || currentRound?.wheelPresentation === 'spin';
  const isStageLocked = isRaffleActive(raffleStatus);
  const isConfigurationEditable = raffleStatus === 'configuring';

  const buildPresentationPlan = useCallback((
    snapshot: readonly DrawOption[],
    count: number,
    target: DrawTarget,
    recipientSnapshot: string | undefined,
    withoutReplacement: boolean,
  ) => {
    const options = [...snapshot];
    const selectedAt = new Date().toISOString();
    const drawPlan = withoutReplacement
      ? buildWeightedDrawPlanWithoutReplacement(options, count)
      : buildWeightedDrawPlanWithReplacement(options, count);

    if (!withoutReplacement) {
      return drawPlan.indices.map((winnerIndex) => ({
        options,
        winnerIndex,
        target,
        selectedAt,
        recipient: recipientSnapshot,
        candidateFingerprint: fingerprintOptions(options),
        candidateTotalWeight: totalEffectiveWeight(options),
        landing: createFinishLanding(),
      }));
    }

    const remaining = options.map((option, sourceIndex) => ({ option, sourceIndex }));

    return drawPlan.indices.flatMap((sourceIndex) => {
      const winnerIndex = remaining.findIndex((item) => item.sourceIndex === sourceIndex);
      if (winnerIndex < 0) return [];

      const candidateSnapshot = remaining.map((item) => item.option);
      const presentation: PlannedPresentation = {
        options: candidateSnapshot,
        winnerIndex,
        target,
        selectedAt,
        recipient: recipientSnapshot,
        candidateFingerprint: fingerprintOptions(candidateSnapshot),
        candidateTotalWeight: totalEffectiveWeight(candidateSnapshot),
        landing: createFinishLanding(),
      };
      remaining.splice(winnerIndex, 1);
      return [presentation];
    });
  }, []);

  /**
   * Starts an already-committed reveal. Selection happened before this call;
   * the short locking beat makes that boundary visible on the broadcast.
   */
  const launchCommittedPresentation = useCallback((presentation: PlannedPresentation) => {
    if (!transitionRaffle('lock-result')) return false;

    cancelWinnerRevealTimers();
    setWinnerHero(null);
    const revealId = presentationRunRef.current + 1;
    presentationRunRef.current = revealId;
    window.setTimeout(() => {
      if (presentationRunRef.current !== revealId) return;

      setActivePresentation({ ...presentation, revealId });
      setPresentedOptions(presentation.options);
      setWinnerIndex(presentation.winnerIndex);
      setSpinning(true);
      setPresentationBeat('motion');
      setSpinKey((value) => value + 1);
      transitionRaffle('start-presentation');
    }, 150);

    return true;
  }, [cancelWinnerRevealTimers, transitionRaffle]);

  useEffect(() => {
    const activeRound = currentRound;
    const nextPresentation = queuedPresentations[0];
    if (
      raffleStatus !== 'presenting' ||
      !activeRound ||
      !isAutoPresentation ||
      !nextPresentation ||
      spinning ||
      presentationBeat !== 'idle' ||
      winnerHero !== null
    ) return undefined;

    const revealTimer = window.setTimeout(() => {
      setQueuedPresentations((presentations) => presentations.slice(1));
      launchCommittedPresentation(nextPresentation);
    }, 720);

    return () => window.clearTimeout(revealTimer);
  }, [currentRound, isAutoPresentation, launchCommittedPresentation, presentationBeat, queuedPresentations, raffleStatus, spinning, winnerHero]);

  const clearStagePresentation = () => {
    cancelWinnerRevealTimers();
    setWinnerIndex(null);
    setPresentedOptions([]);
    setActivePresentation(null);
    setWinnerHero(null);
    setPresentationBeat('idle');
  };

  const clearCurrentRound = () => {
    presentationRunRef.current += 1;
    clearStagePresentation();
    setQueuedPresentations([]);
    setSpinning(false);
    setCurrentRound(null);
  };

  const prepareNextRoundSettings = () => {
    if (raffleStatus === 'configuring') clearStagePresentation();
  };

  const changeTarget = (target: DrawTarget) => {
    if (!isConfigurationEditable) return;
    setDrawTarget(target);
    prepareNextRoundSettings();
  };

  const changeMode = (mode: DrawMode) => {
    if (!isConfigurationEditable) return;
    setDrawMode(mode);
    prepareNextRoundSettings();
  };

  const changeWheelPresentation = (presentation: WheelPresentation) => {
    if (!isConfigurationEditable || drawMode !== 'wheel') return;
    setWheelPresentation(presentation);
    prepareNextRoundSettings();
  };

  const completeDraw = (revealId?: number) => {
    const presentation = activePresentation;
    const activeRound = currentRound;
    if (
      raffleStatus !== 'presenting' ||
      !spinning ||
      !presentation ||
      !activeRound ||
      revealId !== presentation.revealId ||
      revealId !== presentationRunRef.current
    ) {
      return;
    }

    const chosen = presentation.options[presentation.winnerIndex];
    if (!chosen) {
      setSpinning(false);
      return;
    }

    const nextResultOrder = activeRound.results.length + 1;
    const hasAnotherDartShot =
      activeRound.mode === 'wheel' &&
      activeRound.wheelPresentation === 'dart' &&
      nextResultOrder < activeRound.winnerGoal;
    const continuation: RevealContinuation = hasAnotherDartShot
      ? 'await-next-dart'
      : nextResultOrder >= activeRound.winnerGoal
        ? 'complete-round'
        : 'continue-auto';

    const result: DrawRecord = {
      id: createId('result'),
      createdAt: presentation.selectedAt,
      revealedAt: new Date().toISOString(),
      roundId: activeRound.id,
      roundOrder: nextResultOrder,
      mode: activeRound.mode,
      presentation: activeRound.mode === 'wheel' ? activeRound.wheelPresentation : undefined,
      candidateCount: presentation.options.length,
      candidateFingerprint: presentation.candidateFingerprint,
      candidateTotalWeight: presentation.candidateTotalWeight,
      useWeights: activeRound.useWeights,
      removeAfterDraw: activeRound.removeAfterDraw,
      target: presentation.target,
      winner: chosen.name,
      prize: presentation.target === 'prizes' ? chosen.name : undefined,
      prizeId: presentation.target === 'prizes' ? chosen.sourceId ?? chosen.id : undefined,
      prizeUnitId: presentation.target === 'prizes' ? chosen.id : undefined,
      recipient: presentation.target === 'prizes' ? presentation.recipient : undefined,
    };

    setHistory((items) => [result, ...items].slice(0, 100));
    setCurrentRound((round) => {
      if (!round) return { ...activeRound, results: [...activeRound.results, result] };
      return { ...round, results: [...round.results, result] };
    });

    if (presentation.target === 'people' && activeRound.removeAfterDraw) {
      setExcludedParticipantIds((ids) => (ids.includes(chosen.id) ? ids : [...ids, chosen.id]));
    }

    if (presentation.target === 'prizes') {
      const prizeId = chosen.sourceId ?? chosen.id;
      setPrizes((items) => items.map((prize) => (
        prize.id === prizeId
          ? { ...prize, quantity: Math.max(0, prize.quantity - 1) }
          : prize
      )));
      setSideTab('history');
    }

    setSpinning(false);
    cancelWinnerRevealTimers();
    setPresentationBeat('hero');
    setWinnerHero({
      revealId: presentation.revealId,
      result,
      total: activeRound.winnerGoal,
      continuation,
    });

    winnerHeroTimerRef.current = window.setTimeout(() => {
      if (presentationRunRef.current !== presentation.revealId) return;

      winnerHeroTimerRef.current = null;
      setWinnerHero(null);
      setPresentationBeat('dock');
      winnerDockTimerRef.current = window.setTimeout(() => {
        if (presentationRunRef.current !== presentation.revealId) return;

        winnerDockTimerRef.current = null;
        setPresentationBeat('idle');
        if (continuation === 'complete-round') {
          transitionRaffle('complete-round');
          return;
        }

        // The next dart gets a fresh click-time candidate snapshot. Automatic
        // multi-draws instead continue through their already committed queue.
        clearStagePresentation();
        if (continuation === 'await-next-dart') transitionRaffle('await-next-dart');
      }, 620);
    }, 2_200);
  };

  const startDraw = () => {
    if (raffleStatus !== 'ready') return;
    const possibleCount = effectiveWinnerCount;
    if (possibleCount < 1) {
      showToast(drawTarget === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }

    clearStagePresentation();
    const recipientSnapshot = drawTarget === 'prizes' ? recipient.trim() || undefined : undefined;
    const withoutReplacement = drawTarget === 'prizes' || removeAfterDraw;
    const freezeWholeRound = drawMode === 'marble' || wheelPresentation === 'spin';
    const presentations = buildPresentationPlan(
      drawOptions,
      freezeWholeRound ? possibleCount : 1,
      drawTarget,
      recipientSnapshot,
      withoutReplacement,
    );
    const firstPresentation = presentations[0];

    if (!firstPresentation) {
      showToast(drawTarget === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }

    const nextRound: CurrentRound = {
      id: createId('round'),
      target: drawTarget,
      mode: drawMode,
      wheelPresentation,
      winnerGoal: possibleCount,
      candidateCount: drawOptions.length,
      candidateTotalWeight: totalEffectiveWeight(drawOptions),
      poolLimit,
      removeAfterDraw,
      useWeights,
      recipient: recipientSnapshot,
      results: [],
    };
    setCurrentRound(nextRound);
    setToolsOpen(false);
    // Automatic multi-draws freeze the whole reveal plan on this one click.
    setQueuedPresentations(freezeWholeRound ? presentations.slice(1) : []);
    launchCommittedPresentation(firstPresentation);
  };

  const startNextDart = () => {
    if (
      raffleStatus !== 'awaiting-dart' ||
      !currentRound ||
      currentRound.mode !== 'wheel' ||
      currentRound.wheelPresentation !== 'dart' ||
      currentRound.results.length >= currentRound.winnerGoal
    ) return;

    if (drawOptions.length === 0) {
      showToast(currentRound.target === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }

    const nextPresentation = buildPresentationPlan(
      drawOptions,
      1,
      currentRound.target,
      currentRound.recipient,
      currentRound.target === 'prizes' || currentRound.removeAfterDraw,
    )[0];
    if (!nextPresentation) return;

    setToolsOpen(false);
    launchCommittedPresentation(nextPresentation);
  };

  const endDartRound = () => {
    if (raffleStatus !== 'awaiting-dart' || !currentRound) return;
    if (!window.confirm(`현재까지 뽑힌 ${currentRound.results.length}${currentRound.target === 'people' ? '명' : '개'}으로 이번 회차를 마칠까요? 이미 공개한 결과와 기록은 유지됩니다.`)) return;

    setCurrentRound((round) => round ? { ...round, endedEarly: true } : round);
    transitionRaffle('end-round-early');
    showToast('이번 다트 복권 회차를 여기서 마쳤어요. 공개된 결과와 기록은 그대로예요.');
  };

  const reshufflePool = () => {
    if (raffleStatus !== 'ready' || poolLimit === 0) return;
    const count = Math.min(poolLimit, eligibleParticipants.length);
    setPoolIds(sampleWithoutReplacement(eligibleParticipants, count).map((participant) => participant.id));
    showToast(`후보 ${count}명을 새로 골랐어요.`);
  };

  const openParticipantEditor = (returnStatus: SetupReturnStatus, startStep: SetupStartStep = 'edit') => {
    if (!transitionRaffle('open-roster')) return;
    setSetupStartStep(startStep);
    setSetupReturnStatus(returnStatus);
    setSetupSession((value) => value + 1);
    setToolsOpen(false);
  };

  const clearParticipantRoster = () => {
    if (raffleStatus !== 'roster' || participants.length === 0) return;
    if (!window.confirm(`현재 명단 ${participants.length}명을 비울까요? 당첨 기록과 상품 설정은 유지됩니다.`)) return;

    setParticipants([]);
    setExcludedParticipantIds([]);
    setPoolIds([]);
    setPoolLimit(0);
    setRecipient('');
    clearCurrentRound();
    setSetupStartStep('paste');
    setSetupSession((value) => value + 1);
    showToast('명단을 비웠어요. 새 명단을 붙여넣거나 직접 입력해 주세요.');
  };

  const cancelParticipantEditor = () => {
    const event = setupReturnStatus === 'configuring'
      ? 'cancel-roster-configuring'
      : setupReturnStatus === 'completed'
        ? 'cancel-roster-completed'
        : 'cancel-roster-ready';
    transitionRaffle(event);
  };

  const saveParticipants = (nextParticipants: Participant[]) => {
    const nextIds = new Set(nextParticipants.map((participant) => participant.id));
    setParticipants(nextParticipants);
    setExcludedParticipantIds((ids) => ids.filter((id) => nextIds.has(id)));
    setPoolIds([]);
    setPoolLimit((limit) => Math.min(limit, nextParticipants.length));
    clearCurrentRound();
    setToolsOpen(false);
    transitionRaffle('save-roster');
    showToast(`${nextParticipants.length}명의 참여자 명단을 준비했어요.`);
  };

  const startBroadcast = () => {
    if (raffleStatus !== 'configuring') return;
    if (drawOptions.length === 0) {
      showToast(drawTarget === 'people' ? '먼저 참여자 명단을 준비해 주세요.' : '먼저 상품을 추가해 주세요.');
      return;
    }
    setToolsOpen(false);
    clearCurrentRound();
    transitionRaffle('open-stage');
  };

  const openConfiguration = () => {
    if (!transitionRaffle('open-configuration')) return false;
    setToolsOpen(false);
    return true;
  };

  const beginNextRound = () => {
    if (!transitionRaffle('start-next-round')) return;
    clearCurrentRound();
    setToolsOpen(false);
  };

  const restoreParticipant = (id: string, name: string) => {
    if (isStageLocked) return;
    setExcludedParticipantIds((ids) => ids.filter((excludedId) => excludedId !== id));
    prepareNextRoundSettings();
    showToast(`${name}님을 다시 추첨 명단에 넣었어요.`);
  };

  const resetWinnerState = () => {
    if (isStageLocked) return;
    if (excludedParticipantIds.length === 0) {
      showToast('초기화할 당첨 제외 인원이 없어요.');
      return;
    }
    if (!window.confirm(`당첨 제외 ${excludedParticipantIds.length}명을 다시 명단에 넣을까요? 당첨 기록은 유지됩니다.`)) return;
    setExcludedParticipantIds([]);
    setPoolIds([]);
    showToast('당첨 제외를 초기화했어요. 이전 결과와 당첨 기록은 그대로예요.');
  };

  const startPrizeForWinner = (winner: string) => {
    if (!openConfiguration()) return;
    setRecipient(winner);
    setWinnerCount(1);
    setDrawTarget('prizes');
    setSideTab('prizes');
    showToast(availablePrizeCount === 0
      ? '상품을 추가한 뒤 이 당첨자에게 드릴 선물을 뽑아 주세요.'
      : `${winner}님에게 드릴 상품을 뽑아 주세요.`);
  };

  const updateParticipantWeight = (id: string, weight: number) => {
    if (!isConfigurationEditable) return;
    setParticipants((items) => items.map((participant) => (
      participant.id === id
        ? { ...participant, weight: Math.max(0, Math.min(99, Math.floor(weight) || 0)) }
        : participant
    )));
    prepareNextRoundSettings();
  };

  const updatePrize = (id: string, patch: Partial<Prize>) => {
    if (!isConfigurationEditable) return;
    setPrizes((items) => items.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)));
    prepareNextRoundSettings();
  };

  const updatePrizeWeight = (id: string, weight: number) => {
    if (!isConfigurationEditable) return;
    setPrizes((items) => items.map((prize) => (
      prize.id === id
        ? { ...prize, weight: Math.max(0, Math.min(99, Math.floor(weight) || 0)) }
        : prize
    )));
    prepareNextRoundSettings();
  };

  const addPrize = () => {
    if (!isConfigurationEditable) return;
    setPrizes((items) => [...items, { id: createId('prize'), name: '새 선물', quantity: 1, weight: 1 }]);
    prepareNextRoundSettings();
  };

  const removePrize = (id: string, name: string) => {
    if (!isConfigurationEditable) return;
    if (!window.confirm(`${name} 상품을 목록에서 지울까요?`)) return;
    setPrizes((items) => items.filter((prize) => prize.id !== id));
    prepareNextRoundSettings();
  };

  const copyParticipantList = async () => {
    if (participants.length === 0) return;
    const numbered = participants.map((participant, index) => `${index + 1}. ${participant.name}`).join('\n');
    try {
      await navigator.clipboard.writeText(numbered);
      showToast(`${participants.length}명의 참여자 목록을 복사했어요.`);
    } catch {
      showToast('클립보드 권한을 허용한 뒤 다시 시도해 주세요.');
    }
  };

  const exportHistory = () => {
    if (history.length === 0) {
      showToast('저장할 당첨 기록이 없어요.');
      return;
    }
    const header = [
      '선정 시각',
      '공개 시각',
      '모드',
      '연출',
      '추첨 대상',
      '결과',
      '수령자',
      '상품 원본 ID',
      '상품 재고 단위 ID',
      '후보 수',
      '후보 지문',
      '추첨권 합계',
      '가중치',
      '중복 정책',
    ];
    const rows = history.map((item) => [
      new Date(item.createdAt).toLocaleString('ko-KR'),
      item.revealedAt ? new Date(item.revealedAt).toLocaleString('ko-KR') : '',
      item.mode === 'wheel' ? '룰렛' : '마블',
      item.mode === 'wheel' ? item.presentation === 'dart' ? '다트 복권' : '자동' : '마블',
      item.target === 'people' ? '사람' : '상품',
      item.winner,
      item.recipient ?? '',
      item.prizeId ?? '',
      item.prizeUnitId ?? '',
      String(item.candidateCount ?? ''),
      item.candidateFingerprint ?? '',
      String(item.candidateTotalWeight ?? ''),
      typeof item.useWeights === 'boolean' ? item.useWeights ? '적용' : '동일 확률' : '',
      item.target === 'people'
        ? item.removeAfterDraw === false ? '중복 허용' : '중복 방지'
        : '재고 단위',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map(csvField).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'retto-roulette-winners.csv';
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearHistory = () => {
    if (history.length === 0) return;
    if (!window.confirm('당첨 기록을 모두 비울까요? 이 작업은 되돌릴 수 없어요.')) return;
    setHistory([]);
    showToast('당첨 기록을 비웠어요.');
  };

  const currentRoundResults = currentRound?.results ?? [];
  const latestRoundResult = currentRoundResults[currentRoundResults.length - 1] ?? null;
  const roundTarget = currentRound?.target ?? drawTarget;
  const roundMode = currentRound?.mode ?? drawMode;
  const roundWheelPresentation = currentRound?.wheelPresentation ?? wheelPresentation;
  const roundGoal = currentRound?.winnerGoal ?? effectiveWinnerCount;
  const roundPoolLimit = currentRound?.poolLimit ?? poolLimit;
  const roundPresentationOptions = activePresentation?.options ?? drawOptions;
  const roundCandidateCount = roundPresentationOptions.length || currentRound?.candidateCount || 0;
  const roundTotalWeight = totalEffectiveWeight(roundPresentationOptions);
  const isWholeRoundPlan = roundMode === 'marble' || (roundMode === 'wheel' && roundWheelPresentation === 'spin');
  const roundInitialCandidateCount = currentRound?.candidateCount ?? roundCandidateCount;
  const roundInitialTotalWeight = currentRound?.candidateTotalWeight ?? roundTotalWeight;
  const roundRemovesWinners = currentRound?.removeAfterDraw ?? removeAfterDraw;
  const roundUsesWeights = currentRound?.useWeights ?? useWeights;
  const roundRecipient = currentRound?.recipient ?? (recipient.trim() || undefined);
  const roundUnit = roundTarget === 'people' ? '명' : '개';
  const roundUnitSubjectParticle = roundUnit === '명' ? '이' : '가';
  const targetLabel = roundTarget === 'people' ? '사람' : '상품';
  const resultTitle = roundTarget === 'people' ? '이번 추첨 당첨자' : '이번 추첨 상품';
  const dynamicFairnessLabel = roundUsesWeights
    ? `가중치 적용 · 총 ${roundTotalWeight} 추첨권 · ${roundMode === 'wheel' ? '조각 크기는 확률에 비례' : '결과 확률은 가중치에 비례'}`
    : '동일 확률 · 후보마다 한 번씩 표시';
  const fairnessLabel = isWholeRoundPlan && currentRound
    ? roundUsesWeights
      ? `첫 클릭에 시작 후보 ${roundInitialCandidateCount}${roundUnit}, 총 ${roundInitialTotalWeight} 추첨권으로 결과를 고정 · 현재 공개 후보 ${roundCandidateCount}${roundUnit}`
      : `첫 클릭에 시작 후보 ${roundInitialCandidateCount}${roundUnit}을 기준으로 전체 결과를 고정 · 현재 공개 후보 ${roundCandidateCount}${roundUnit}`
    : dynamicFairnessLabel;
  const ruleSummary = [
    roundMode === 'wheel'
      ? roundWheelPresentation === 'dart' ? '룰렛 · 다트 복권' : '룰렛 · 자동 회전'
      : '마블',
    `${targetLabel} ${roundGoal}${roundUnit}`,
    `${isWholeRoundPlan ? '시작 후보' : '후보'} ${isWholeRoundPlan ? roundInitialCandidateCount : roundCandidateCount}${roundUnit}`,
    roundTarget === 'people' && roundPoolLimit > 0 ? '후보 풀 회차 고정' : null,
    roundTarget === 'people' && roundRemovesWinners ? '중복 당첨 방지' : null,
    roundUsesWeights ? '가중치 적용' : null,
  ].filter(Boolean).join(' · ');
  const resultRemovalMessage = roundTarget === 'people'
    ? roundRemovesWinners
      ? `중복 당첨 방지로 ${currentRoundResults.length}명은 이 회차 뒤 명단에서 제외되었습니다.`
      : '중복 당첨 허용: 이번 회차와 다음 추첨에도 같은 사람이 다시 뽑힐 수 있습니다.'
    : '상품은 재고 단위로 한 개씩 차감됩니다.';
  const stageTitle = roundTarget === 'people'
    ? '참여자 추첨'
    : roundRecipient ? `${roundRecipient}님 상품 추첨` : '상품 추첨';
  const isDartRound = roundMode === 'wheel' && roundWheelPresentation === 'dart';
  const isDartWaiting = raffleStatus === 'awaiting-dart';
  const statusMeta = RAFFLE_STATUS_META[raffleStatus];
  const upcomingDrawLabel = drawMode === 'wheel' && wheelPresentation === 'dart'
    ? '다트 발사'
    : drawTarget === 'people'
      ? `${effectiveWinnerCount}명 추첨하기`
      : `${effectiveWinnerCount}개 상품 뽑기`;
  const noAvailableDrawOptions = drawOptions.length === 0;
  const unavailableDrawLabel = drawTarget === 'people'
    ? participants.length === 0
      ? '참여자 명단을 준비해 주세요'
      : eligibleParticipants.length === 0
        ? '당첨 제외를 초기화해 주세요'
        : useWeights && candidateParticipants.length > 0
          ? '가중치를 조정해 주세요'
          : '추첨 후보를 준비해 주세요'
    : availablePrizeCount === 0
      ? '상품 재고를 추가해 주세요'
      : '가중치를 조정해 주세요';
  const unavailableDrawHint = drawTarget === 'people' ? '추첨 가능한 참여자' : '상품 재고';
  const unavailableDrawPrompt = drawTarget === 'people'
    ? participants.length === 0
      ? '참여자 명단을 준비하면 바로 추첨을 시작할 수 있습니다.'
      : eligibleParticipants.length === 0
        ? '명단 도구에서 당첨 제외를 초기화하면 새 회차를 시작할 수 있습니다.'
      : useWeights && candidateParticipants.length > 0
          ? '설정 바꾸기에서 가중치를 조정하면 바로 추첨을 시작할 수 있습니다.'
          : '설정 바꾸기에서 추첨 후보를 준비하면 바로 추첨을 시작할 수 있습니다.'
    : availablePrizeCount === 0
      ? '상품 재고를 추가하면 바로 추첨을 시작할 수 있습니다.'
      : '설정 바꾸기에서 상품 가중치를 조정하면 바로 추첨을 시작할 수 있습니다.';
  const drawButtonLabel = raffleStatus === 'locking'
    ? '결과 고정 중…'
    : raffleStatus === 'presenting'
      ? `${currentRoundResults.length} / ${roundGoal}${roundUnit} 결과 공개 중…`
    : isDartWaiting
      ? noAvailableDrawOptions
        ? unavailableDrawLabel
        : `다음 다트 발사 (${currentRoundResults.length + 1}/${roundGoal})`
    : noAvailableDrawOptions
      ? unavailableDrawLabel
      : upcomingDrawLabel;
  const broadcastVisualClassName = [
    'broadcast-focus__visual',
    isDartRound && spinning ? 'is-dart-flying' : '',
    roundMode === 'wheel' && roundWheelPresentation === 'spin' && spinning ? 'is-auto-spinning' : '',
    presentationBeat === 'hero' ? 'is-winner-hero' : '',
    presentationBeat === 'dock' ? 'is-result-docking' : '',
    raffleStatus === 'completed' ? 'is-round-complete' : '',
  ].filter(Boolean).join(' ');
  const isStageOnly =
    raffleStatus === 'locking' || presentationBeat === 'motion' || presentationBeat === 'hero';
  const showResultsPanel = !isStageOnly;
  const broadcastFocusClassName = [
    'broadcast-focus',
    isStageOnly ? 'is-stage-only' : '',
    presentationBeat === 'hero' ? 'is-winner-hero' : '',
    presentationBeat === 'dock' ? 'is-result-docking' : '',
    raffleStatus === 'completed' ? 'is-completed' : '',
  ].filter(Boolean).join(' ');
  const stageHeading = raffleStatus === 'completed'
    ? currentRound?.endedEarly
      ? `이번 회차 ${currentRoundResults.length}${roundUnit} 확정 · 여기서 종료`
      : `${resultTitle} ${currentRoundResults.length}${roundUnit}`
    : raffleStatus === 'awaiting-dart'
      ? `${currentRoundResults.length} / ${roundGoal}${roundUnit} 확정`
      : raffleStatus === 'locking' || raffleStatus === 'presenting'
        ? `${currentRoundResults.length} / ${roundGoal}${roundUnit} 공개 중`
        : stageTitle;
  const stagePrompt = raffleStatus === 'locking'
    ? '방금 누른 버튼의 후보와 결과를 고정했습니다. 곧 방송 연출을 시작합니다.'
    : raffleStatus === 'presenting'
      ? isDartRound
        ? `${currentRoundResults.length + 1}번째 다트의 결과는 발사 버튼을 누른 순간 고정되었습니다. 지금은 다트 복권 연출 중이에요.`
        : `첫 버튼을 누른 순간 이번 회차 ${roundGoal}${roundUnit}의 결과와 후보 규칙이 고정되었습니다. 지금은 ${currentRoundResults.length}${roundUnit} 공개 중이에요.`
      : raffleStatus === 'awaiting-dart'
        ? noAvailableDrawOptions
          ? `${unavailableDrawHint}가 없어 다음 다트를 시작할 수 없어요. 이번 회차를 여기서 마치거나, 결과 뒤에 다음 회차 설정을 바꿔 주세요.`
          : `${currentRoundResults.length + 1}번째 다트는 발사 버튼을 누르는 순간 그 한 결과가 확정되고, 바로 다트 복권 연출이 시작됩니다.`
        : raffleStatus === 'completed'
          ? currentRound?.endedEarly
            ? '공개된 결과와 기록은 유지됩니다. 다음 회차를 같은 조건으로 이어가거나, 명단·규칙을 새로 정할 수 있어요.'
            : '오른쪽 보드에 이번 회차의 전체 당첨자가 남아 있습니다. 아래에서 다음 행동을 고르세요.'
          : noAvailableDrawOptions
            ? unavailableDrawPrompt
            : roundTarget === 'prizes' && roundRecipient
              ? `${roundRecipient}님에게 드릴 상품을 뽑아 주세요.`
              : '추첨 시작을 누르는 순간 후보와 결과가 고정되고, 그 다음에 방송 연출이 시작됩니다.';

  const renderDrawVisual = (variant: 'preview' | 'live') => {
    const preview = variant === 'preview';
    const names = preview ? drawOptions.map((option) => option.name) : displayNames;
    const mode = preview ? drawMode : roundMode;
    const target = preview ? drawTarget : roundTarget;
    const activeWinnerIndex = preview ? null : winnerIndex;
    const activeSpin = preview ? false : spinning;
    const presentation = preview ? wheelPresentation : roundWheelPresentation;
    const sliceWeights = preview
      ? drawOptions.map((option) => option.weight)
      : displayOptions.map((option) => option.weight);

    return mode === 'wheel' ? (
      <RouletteWheel
        participants={names}
        weights={sliceWeights}
        itemType={target === 'prizes' ? 'prize' : 'participant'}
        winnerIndex={activeWinnerIndex}
        spinning={activeSpin}
        spinKey={spinKey}
        presentation={presentation}
        landing={preview ? undefined : activePresentation?.landing}
        onSpinEnd={preview ? () => undefined : () => completeDraw(activePresentation?.revealId)}
      />
    ) : (
      <MarbleRace
        participants={names}
        itemType={target === 'prizes' ? 'prize' : 'participant'}
        winnerIndex={activeWinnerIndex}
        racing={activeSpin}
        raceKey={spinKey}
        onRaceEnd={preview ? () => undefined : () => completeDraw(activePresentation?.revealId)}
      />
    );
  };

  const renderRoundSettings = () => (
    <section className="broadcast-settings broadcast-settings--preflight" aria-label="이번 회차 설정">
      <div className="broadcast-settings__heading">
        <div>
          <p>이번 회차 규칙</p>
          <h2>{drawTarget === 'people' ? '사람을 뽑을게요' : '상품을 뽑을게요'}</h2>
        </div>
        <span>{drawOptions.length}{drawTarget === 'people' ? '명 후보' : '개 준비'}</span>
      </div>

      <div className="broadcast-settings__grid">
        <fieldset className="settings-choice">
          <legend>무엇을 뽑을까요?</legend>
          <button type="button" aria-pressed={drawTarget === 'people'} disabled={!isConfigurationEditable} onClick={() => changeTarget('people')}>사람</button>
          <button type="button" aria-pressed={drawTarget === 'prizes'} disabled={!isConfigurationEditable} onClick={() => changeTarget('prizes')}>상품</button>
        </fieldset>

        <label className="settings-number">
          <span>이번 당첨</span>
          <input
            type="number"
            min="1"
            max={maximumWinnerCount}
            value={winnerCount}
            disabled={!isConfigurationEditable}
            onChange={(event) => {
              setWinnerCount(clampInteger(Number(event.target.value), 1, maximumWinnerCount));
              prepareNextRoundSettings();
            }}
          />
          <em>{drawTarget === 'people' ? '명' : '개'}</em>
        </label>

        {drawTarget === 'people' ? (
          <label className="settings-number settings-number--pool">
            <span>이번 후보</span>
            <input
              type="number"
              min="0"
              max={eligibleParticipants.length}
              value={poolLimit}
              disabled={!isConfigurationEditable}
              onChange={(event) => {
                setPoolLimit(Math.max(0, Math.min(eligibleParticipants.length, Number(event.target.value) || 0)));
                setPoolIds([]);
                prepareNextRoundSettings();
              }}
            />
            <em>명 · 0은 전체</em>
          </label>
        ) : (
          <label className="settings-recipient">
            <span>받을 사람</span>
            <input
              value={recipient}
              disabled={!isConfigurationEditable}
              onChange={(event) => {
                setRecipient(event.target.value);
                prepareNextRoundSettings();
              }}
              placeholder="선택 입력"
            />
          </label>
        )}

        <fieldset className="settings-choice">
          <legend>어떻게 보여줄까요?</legend>
          <button type="button" aria-pressed={drawMode === 'wheel'} disabled={!isConfigurationEditable} onClick={() => changeMode('wheel')}>룰렛</button>
          <button type="button" aria-pressed={drawMode === 'marble'} disabled={!isConfigurationEditable} onClick={() => changeMode('marble')}>마블</button>
        </fieldset>

        {drawMode === 'wheel' && (
          <fieldset className="settings-choice settings-choice--presentation">
            <legend>룰렛 연출</legend>
            <button type="button" aria-pressed={wheelPresentation === 'spin'} disabled={!isConfigurationEditable} onClick={() => changeWheelPresentation('spin')}>자동</button>
            <button type="button" aria-pressed={wheelPresentation === 'dart'} disabled={!isConfigurationEditable} onClick={() => changeWheelPresentation('dart')}>다트 복권</button>
          </fieldset>
        )}
      </div>

      <p className="broadcast-settings__status">
        {drawTarget === 'people'
          ? removeAfterDraw ? '중복 당첨 방지' : '중복 당첨 허용'
          : '상품은 재고 단위로 한 번씩'}
        {useWeights ? ' · 가중치 적용' : ' · 동일 확률'}
      </p>

      <details className="broadcast-settings__advanced">
        <summary>고급 추첨 설정</summary>
        <label>
          <input
            type="checkbox"
            checked={useWeights}
            disabled={!isConfigurationEditable}
            onChange={(event) => {
              setUseWeights(event.target.checked);
              prepareNextRoundSettings();
            }}
          />
          가중치 추첨 사용
        </label>
        {drawTarget === 'people' && (
          <label>
            <input
              type="checkbox"
              checked={!removeAfterDraw}
              disabled={!isConfigurationEditable}
              onChange={(event) => {
                setRemoveAfterDraw(!event.target.checked);
                prepareNextRoundSettings();
              }}
            />
            중복 당첨 허용
          </label>
        )}
        {useWeights && (
          <div className="weight-editor">
            <p className="weight-editor__note">
              0은 추첨에서 제외됩니다. 숫자만큼 조각 크기와 당첨 확률이 함께 바뀝니다.
            </p>
            {drawTarget === 'people'
              ? candidateParticipants.map((participant) => (
                  <label className="weight-editor__row" key={participant.id}>
                    <span>{participant.name}</span>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={participant.weight}
                      disabled={!isConfigurationEditable}
                      onChange={(event) => updateParticipantWeight(participant.id, Number(event.target.value))}
                    />
                  </label>
                ))
              : prizes.filter((prize) => prize.quantity > 0).map((prize) => (
                  <label className="weight-editor__row" key={prize.id}>
                    <span>{prize.name} · 재고 {prize.quantity}개</span>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={prize.weight}
                      disabled={!isConfigurationEditable}
                      onChange={(event) => updatePrizeWeight(prize.id, Number(event.target.value))}
                    />
                  </label>
                ))}
          </div>
        )}
      </details>
    </section>
  );

  const renderStatusPath = () => (
    <ol className="raffle-status-path" aria-label="추첨 진행 단계">
      {[
        { step: 1, label: '명단' },
        { step: 2, label: '설정' },
        { step: 3, label: '추첨' },
        { step: 4, label: '결과' },
      ].map((item) => (
        <li
          key={item.step}
          className={item.step === statusMeta.step ? 'is-current' : item.step < statusMeta.step ? 'is-complete' : ''}
          aria-current={item.step === statusMeta.step ? 'step' : undefined}
        >
          <span>{item.step}</span>{item.label}
        </li>
      ))}
    </ol>
  );

  const liveStatusDescription = raffleStatus === 'ready'
    ? '현재 명단과 규칙으로 바로 추첨할 수 있어요.'
    : raffleStatus === 'completed'
      ? '이번 회차 결과는 유지한 채, 다음 행동을 고르세요.'
      : '결과와 규칙이 고정되어 있어 방송 연출이 끝날 때까지 바꿀 수 없어요.';

  const renderProgressTools = () => (
    <aside
      ref={toolsDrawerRef}
      id="broadcast-tools-drawer"
      className="broadcast-tools-drawer"
      role="dialog"
      aria-modal="true"
      aria-labelledby="broadcast-tools-title"
      tabIndex={-1}
    >
      <div className="broadcast-tools-drawer__header">
        <div>
          <p>방송 진행</p>
          <h2 id="broadcast-tools-title">필요할 때만 열어 보세요</h2>
        </div>
        <button ref={toolsCloseRef} type="button" aria-label="진행 도구 닫기" onClick={() => closeTools(true)}>×</button>
      </div>

      <section className="live-session-status" aria-label="현재 추첨 상태">
        <div>
          <p>현재 상태</p>
          <h3>{statusMeta.liveLabel}</h3>
        </div>
        <span>{ruleSummary}</span>
        <p>{liveStatusDescription}</p>
      </section>

      <nav className="live-tabs" aria-label="방송 진행 패널">
        <button type="button" aria-pressed={sideTab === 'participants'} onClick={() => setSideTab('participants')}>참여자 <span>{participants.length}</span></button>
        <button type="button" aria-pressed={sideTab === 'prizes'} onClick={() => setSideTab('prizes')}>상품 <span>{availablePrizeCount}</span></button>
        <button type="button" aria-pressed={sideTab === 'history'} onClick={() => setSideTab('history')}>당첨 기록 <span>{history.length}</span></button>
      </nav>

      {sideTab === 'participants' && (
        <section className="live-panel" aria-labelledby="participant-panel-title">
          <div className="live-panel__heading">
            <div>
              <h2 id="participant-panel-title">현재 참여자</h2>
              <p>추첨 가능 {eligibleParticipants.length}명 · 당첨 제외 {excludedParticipantIds.length}명</p>
            </div>
            <button className="compact-button" type="button" disabled={isStageLocked} onClick={() => openParticipantEditor(raffleStatus === 'completed' ? 'completed' : 'ready')}>편집</button>
          </div>
          <ol className="live-participant-list">
            {participants.slice(0, 18).map((participant, index) => {
              const excluded = excludedParticipantIds.includes(participant.id);
              return (
                <li key={participant.id} className={excluded ? 'is-excluded' : ''}>
                  <span>{index + 1}</span>
                  <strong>{participant.name}</strong>
                  {excluded ? <button type="button" disabled={isStageLocked} onClick={() => restoreParticipant(participant.id, participant.name)}>복귀</button> : <em>참여 중</em>}
                </li>
              );
            })}
          </ol>
          {participants.length > 18 && <p className="live-panel__note">+{participants.length - 18}명은 명단 조정에서 확인할 수 있어요.</p>}
          <button className="panel-wide-button" type="button" onClick={copyParticipantList}>번호가 붙은 명단 복사</button>
          <button className="panel-wide-button panel-wide-button--soft" type="button" disabled={isStageLocked} onClick={resetWinnerState}>당첨 제외 상태 초기화</button>
          <button className="panel-wide-button panel-wide-button--soft" type="button" disabled={isStageLocked} onClick={() => openParticipantEditor(raffleStatus === 'completed' ? 'completed' : 'ready', 'paste')}>명단 교체 · 비우기</button>
        </section>
      )}

      {sideTab === 'prizes' && (
        <section className="live-panel" aria-labelledby="prize-panel-title">
          {currentRound?.target === 'people' && currentRound.results.length > 0 && (
            <section className="winner-prize-choices" aria-labelledby="winner-prize-choices-title">
              <h3 id="winner-prize-choices-title">당첨자에게 상품 뽑기</h3>
              <p>이름을 누르면 해당 분의 상품 추첨으로 바뀝니다.</p>
              <div>
                {currentRound.results.map((result) => (
                  <button type="button" key={result.id} disabled={isStageLocked} onClick={() => startPrizeForWinner(result.winner)}>{result.winner}님</button>
                ))}
              </div>
            </section>
          )}
          <div className="live-panel__heading">
            <div>
              <h2 id="prize-panel-title">상품 수량</h2>
              <p>남은 상품 {availablePrizeCount}개</p>
            </div>
            <button className="compact-button" type="button" disabled={isStageLocked} onClick={openConfiguration}>상품 설정</button>
          </div>
          <div className="live-prize-list">
            {prizes.length === 0 && <p className="live-panel__empty">아직 상품이 없어요. 선물을 추가해 주세요.</p>}
            {prizes.map((prize) => (
              <div className="live-prize-row" key={prize.id}>
                <strong>{prize.name}</strong>
                <span>남은 {prize.quantity}개</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {sideTab === 'history' && (
        <section className="live-panel" aria-labelledby="history-panel-title">
          <div className="live-panel__heading">
            <div>
              <h2 id="history-panel-title">당첨 기록</h2>
              <p>최근 {history.length}건</p>
            </div>
            <div className="live-panel__actions">
              <button className="compact-button" type="button" onClick={exportHistory}>CSV</button>
              <button className="compact-button" type="button" onClick={clearHistory}>비우기</button>
            </div>
          </div>
          {history.length === 0 ? (
            <p className="live-panel__empty">아직 당첨 기록이 없어요.</p>
          ) : (
            <ol className="live-history-list">
              {history.slice(0, 12).map((item) => (
                <li key={item.id}>
                  <small>
                    선정 {formatTime(item.createdAt, true)}
                    {item.revealedAt ? ` · 공개 ${formatTime(item.revealedAt, true)}` : ''}
                    {' · '}{item.target === 'people' ? '사람' : '상품'}
                  </small>
                  <strong>{item.winner}</strong>
                  <span>
                    {item.target === 'prizes' && item.recipient
                      ? `${item.recipient}님에게 전달`
                      : item.mode === 'wheel'
                        ? item.presentation === 'dart' ? '다트 복권' : '자동 룰렛'
                        : '마블'}
                    {item.candidateCount ? ` · 후보 ${item.candidateCount}${item.target === 'people' ? '명' : '개'}` : ''}
                    {item.candidateTotalWeight ? ` · 총 ${item.candidateTotalWeight}추첨권` : ''}
                    {item.candidateFingerprint ? ` · 검증 ${item.candidateFingerprint}` : ''}
                    {typeof item.useWeights === 'boolean'
                      ? item.useWeights ? ' · 가중치 적용' : ' · 동일 확률'
                      : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </aside>
  );

  if (raffleStatus === 'roster') {
    return (
      <main className="app-shell app-shell--setup">
        <header className="brand-header">
          <a className="brand" href="./" aria-label="Retto Roulette 홈">
            <span className="brand__mark" aria-hidden="true">🍸 💝</span>
            <strong>Retto Roulette</strong>
          </a>
          <div className="header-status">
            {renderStatusPath()}
            <span className="header-pill">{statusMeta.label}</span>
          </div>
        </header>
        <ParticipantSetup
          key={setupSession}
          initialParticipants={participants}
          initialStep={setupStartStep}
          onClear={participants.length > 0 ? clearParticipantRoster : undefined}
          onCancel={participants.length > 0 ? cancelParticipantEditor : undefined}
          onStart={saveParticipants}
        />
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    );
  }

  if (raffleStatus === 'configuring') {
    return (
      <main className="app-shell app-shell--preflight">
        <header className="brand-header">
          <a className="brand" href="./" aria-label="Retto Roulette 홈">
            <span className="brand__mark" aria-hidden="true">🍸 💝</span>
            <strong>Retto Roulette</strong>
          </a>
          <div className="header-status">
            {renderStatusPath()}
            <span className="header-pill">{statusMeta.label}</span>
          </div>
        </header>

        <section className="preflight-layout" aria-label="추첨 설정">
          <section className="preflight-setup">
            <p className="preflight-setup__eyebrow">다음 회차 설정</p>
            <h1>명단은 준비됐어요. 이번 방식만 정해 주세요.</h1>
            <p className="preflight-setup__copy">결과는 실제 추첨을 시작하기 전까지 확정되지 않아요. 오른쪽에서 방송 화면도 바로 확인할 수 있어요.</p>

            <section className="preflight-roster" aria-labelledby="preflight-roster-title">
              <div>
                <p>참여자</p>
                <h2 id="preflight-roster-title">{participants.length}명 준비됨</h2>
              </div>
              <button className="compact-button" type="button" onClick={() => openParticipantEditor('configuring')}>명단 다듬기</button>
              <ol>
                {participants.slice(0, 5).map((participant, index) => (
                  <li key={participant.id}><span>{index + 1}</span><strong>{participant.name}</strong></li>
                ))}
                {participants.length > 5 && <li className="preflight-roster__more">+{participants.length - 5}명</li>}
              </ol>
            </section>

            {renderRoundSettings()}

            <button className="primary-button preflight-setup__start" type="button" disabled={drawOptions.length === 0} onClick={startBroadcast}>이 설정으로 추첨 화면 열기</button>
          </section>

          <aside className="preflight-preview" aria-label="방송 화면 미리보기">
            <div className="preflight-preview__heading">
              <div>
                <p>방송 화면 미리보기</p>
                <h2>{drawMode === 'wheel' ? wheelPresentation === 'dart' ? '다트 복권으로 진행' : '자동 룰렛으로 진행' : '마블 레이스로 진행'}</h2>
              </div>
              <span>{drawTarget === 'people' ? `사람 ${effectiveWinnerCount}명` : `상품 ${effectiveWinnerCount}개`}</span>
            </div>
            <div className="preflight-preview__visual">{renderDrawVisual('preview')}</div>
            <p className="preflight-preview__note">추첨 화면에서는 설정을 접고 룰렛과 당첨자 목록만 크게 보여 줍니다.</p>
          </aside>
        </section>

        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    );
  }

  return (
    <main className="app-shell app-shell--live">
      <header className="brand-header broadcast-header" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
        <a className="brand" href="./" aria-label="Retto Roulette 홈">
          <span className="brand__mark" aria-hidden="true">🍸 💝</span>
          <strong>Retto Roulette</strong>
        </a>
        <div className="broadcast-header__actions">
          <span className="broadcast-rule-strip">{ruleSummary}</span>
          <button
            ref={toolsTriggerRef}
            className="compact-button"
            type="button"
            disabled={isRaffleActive(raffleStatus)}
            aria-expanded={toolsOpen}
            aria-controls="broadcast-tools-drawer"
            onClick={() => {
              if (toolsOpen) closeTools(true);
              else setToolsOpen(true);
            }}
          >명단 · 기록</button>
        </div>
      </header>

      <div className="broadcast-phase-bar" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
        {renderStatusPath()}
        <span>{statusMeta.liveLabel}</span>
      </div>

      {toolsOpen && (
        <>
          <button
            className="broadcast-tools-scrim"
            type="button"
            tabIndex={-1}
            aria-label="진행 도구 닫기"
            onClick={() => closeTools(true)}
          />
          {renderProgressTools()}
        </>
      )}

      <section className={broadcastFocusClassName} aria-label="방송 집중 화면" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
        <section className="broadcast-focus__stage" aria-labelledby="stage-title">
          <div className="broadcast-focus__heading">
            <div>
              <p>{statusMeta.liveLabel}</p>
              <h1 id="stage-title">{stageHeading}</h1>
            </div>
            <span>
              {roundMode === 'wheel' ? roundWheelPresentation === 'dart' ? '룰렛 · 다트 복권' : '룰렛 · 자동' : '마블'}
              {' · '}{isWholeRoundPlan ? '시작 후보' : '후보'} {isWholeRoundPlan ? roundInitialCandidateCount : roundCandidateCount}{roundUnit}
            </span>
          </div>

          <p className="broadcast-focus__fairness">{fairnessLabel}</p>

          <div className={broadcastVisualClassName}>
            <div className="broadcast-focus__camera">{renderDrawVisual('live')}</div>
            {winnerHero && presentationBeat === 'hero' ? (
              <WinnerHero
                key={winnerHero.revealId}
                className="broadcast-focus__winner-hero"
                winnerName={winnerHero.result.winner}
                ordinal={winnerHero.result.roundOrder}
                total={winnerHero.total}
                targetLabel={winnerHero.result.target === 'people' ? '당첨자' : '당첨 상품'}
                recipient={winnerHero.result.recipient}
              />
            ) : null}
          </div>

          <p className="broadcast-focus__prompt">{stagePrompt}</p>

          <div className="broadcast-focus__action">
            {raffleStatus === 'completed' ? (
              <div className="round-complete-actions">
                <button className="primary-button" type="button" onClick={beginNextRound}>같은 조건으로 다음 회차</button>
                <button className="stage-link stage-link--button" type="button" onClick={openConfiguration}>설정 바꾸고 다음 회차</button>
                <button className="stage-link stage-link--button" type="button" onClick={() => openParticipantEditor('completed', 'paste')}>명단 바꾸기</button>
              </div>
            ) : raffleStatus === 'awaiting-dart' ? (
              <div className="round-complete-actions">
                <button className="primary-button" type="button" onClick={startNextDart} disabled={noAvailableDrawOptions || toolsOpen}>{drawButtonLabel}</button>
                <button className="stage-link stage-link--button" type="button" onClick={endDartRound}>이번 회차 여기서 마치기</button>
              </div>
            ) : raffleStatus === 'ready' ? (
              <div className="round-ready-actions">
                <button className="primary-button" type="button" onClick={startDraw} disabled={drawOptions.length === 0 || toolsOpen}>{drawButtonLabel}</button>
                <div>
                  <button className="stage-link stage-link--button" type="button" onClick={openConfiguration}>설정 바꾸기</button>
                  <button className="stage-link stage-link--button" type="button" onClick={() => openParticipantEditor('ready', 'paste')}>명단 바꾸기</button>
                  {drawTarget === 'people' && poolLimit > 0 && (
                    <button className="stage-link stage-link--button" type="button" onClick={reshufflePool}>후보 다시 섞기</button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {showResultsPanel && (
          <aside className="broadcast-focus__results" aria-label="이번 추첨 결과">
            <CurrentRoundWinners
              winners={currentRoundResults.map((result) => ({
                id: result.id,
                name: result.winner,
                detail: result.target === 'prizes' && result.recipient ? `${result.recipient}님에게 전달` : undefined,
              }))}
              drawCount={currentRound?.endedEarly ? currentRoundResults.length : roundGoal}
              unit={roundUnit}
              latestWinnerId={latestRoundResult?.id}
              title={resultTitle}
              announcement={currentRoundResults.length > 0
                ? raffleStatus === 'presenting'
                  ? `${resultTitle} ${currentRoundResults.length}${roundUnit}${roundUnitSubjectParticle} 확정되었습니다.`
                  : `${resultTitle} ${currentRoundResults.length}${roundUnit}${roundUnitSubjectParticle} 발표되었습니다.`
                : undefined}
              removalMessage={currentRoundResults.length > 0 ? resultRemovalMessage : undefined}
            />
            {currentRound?.target === 'people' && currentRoundResults.length > 0 && (
              <button className="broadcast-focus__prize-link" type="button" disabled={isStageLocked} onClick={() => {
                setSideTab('prizes');
                setToolsOpen(true);
              }}>당첨자별 상품 설정</button>
            )}
          </aside>
        )}
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

export default App;
