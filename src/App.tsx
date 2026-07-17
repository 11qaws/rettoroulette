import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import CurrentRoundWinners from './components/CurrentRoundWinners';
import MarbleRace from './components/MarbleRace';
import ParticipantSetup from './components/ParticipantSetup';
import RouletteWheel from './components/RouletteWheel';
import { csvField } from './lib/csv';
import {
  buildWeightedDrawPlanWithReplacement,
  buildWeightedDrawPlanWithoutReplacement,
  sampleWithoutReplacement,
} from './lib/draw';
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
type BroadcastPhase = 'roster' | 'preflight' | 'live';
type SetupReturnPhase = Exclude<BroadcastPhase, 'roster'>;

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
};

type PlannedPresentation = {
  options: DrawOption[];
  winnerIndex: number;
  target: DrawTarget;
  selectedAt: string;
  candidateFingerprint: string;
  candidateTotalWeight: number;
  recipient?: string;
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
  const [activePresentation, setActivePresentation] = useState<PlannedPresentation | null>(null);
  const [currentRound, setCurrentRound] = useState<CurrentRound | null>(null);
  const [history, setHistory] = useState<DrawRecord[]>([]);
  const [sideTab, setSideTab] = useState<SideTab>('participants');
  const [broadcastPhase, setBroadcastPhase] = useState<BroadcastPhase>('roster');
  const [setupReturnPhase, setSetupReturnPhase] = useState<SetupReturnPhase>('preflight');
  const [setupSession, setSetupSession] = useState(0);
  const [setupStartStep, setSetupStartStep] = useState<SetupStartStep>('paste');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const toolsCloseRef = useRef<HTMLButtonElement>(null);
  const toolsDrawerRef = useRef<HTMLElement>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
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
    if (broadcastPhase === 'live') window.scrollTo(0, 0);
  }, [broadcastPhase]);

  const eligibleParticipants = useMemo(
    () => participants.filter((participant) => !excludedParticipantIds.includes(participant.id)),
    [excludedParticipantIds, participants],
  );

  useEffect(() => {
    // A limited candidate pool must not silently refill between arrow shots.
    // Once the round is complete, the usual pool maintenance can resume.
    if (currentRound && currentRound.results.length < currentRound.winnerGoal) return;

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
  }, [currentRound, eligibleParticipants, poolIds, poolLimit]);

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
  const isDrawing = spinning || (queuedPresentations.length > 0 && isAutoPresentation);
  const isRoundInProgress = Boolean(
    currentRound && currentRound.results.length < currentRound.winnerGoal,
  );
  const isCompletedRound = Boolean(
    currentRound && currentRound.results.length >= currentRound.winnerGoal && currentRound.results.length > 0,
  );
  const isStageLocked = isDrawing || isRoundInProgress;

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
      };
      remaining.splice(winnerIndex, 1);
      return [presentation];
    });
  }, []);

  /** Starts a previously committed reveal. It never chooses a result itself. */
  const launchPresentation = useCallback((presentation: PlannedPresentation) => {
    setActivePresentation(presentation);
    setPresentedOptions(presentation.options);
    setWinnerIndex(presentation.winnerIndex);
    setSpinning(true);
    setSpinKey((value) => value + 1);
  }, []);

  useEffect(() => {
    const activeRound = currentRound;
    const nextPresentation = queuedPresentations[0];
    if (!activeRound || !isAutoPresentation || !nextPresentation || spinning) return undefined;

    const revealTimer = window.setTimeout(() => {
      launchPresentation(nextPresentation);
      setQueuedPresentations((presentations) => presentations.slice(1));
    }, 720);

    return () => window.clearTimeout(revealTimer);
  }, [currentRound, isAutoPresentation, launchPresentation, queuedPresentations, spinning]);

  const clearStagePresentation = () => {
    setWinnerIndex(null);
    setPresentedOptions([]);
    setActivePresentation(null);
  };

  const clearCurrentRound = () => {
    clearStagePresentation();
    setQueuedPresentations([]);
    setSpinning(false);
    setCurrentRound(null);
  };

  const prepareNextRoundSettings = () => {
    if (!currentRound) clearStagePresentation();
  };

  const changeTarget = (target: DrawTarget) => {
    if (isStageLocked) return;
    setDrawTarget(target);
    prepareNextRoundSettings();
  };

  const changeMode = (mode: DrawMode) => {
    if (isStageLocked) return;
    setDrawMode(mode);
    prepareNextRoundSettings();
  };

  const changeWheelPresentation = (presentation: WheelPresentation) => {
    if (isStageLocked || drawMode !== 'wheel') return;
    setWheelPresentation(presentation);
    prepareNextRoundSettings();
  };

  const completeDraw = () => {
    const presentation = activePresentation;
    const activeRound = currentRound;
    if (!spinning || !presentation || !activeRound) {
      setSpinning(false);
      return;
    }

    const chosen = presentation.options[presentation.winnerIndex];
    if (!chosen) {
      setSpinning(false);
      return;
    }

    const hasAnotherArrowShot =
      activeRound.mode === 'wheel' &&
      activeRound.wheelPresentation === 'dart' &&
      activeRound.results.length + 1 < activeRound.winnerGoal;

    const result: DrawRecord = {
      id: createId('result'),
      createdAt: presentation.selectedAt,
      revealedAt: new Date().toISOString(),
      roundId: activeRound.id,
      roundOrder: activeRound.results.length + 1,
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
    // A following arrow uses a new click-time snapshot. Clear the previous
    // wheel now so the audience sees the exact next-shot candidate pool.
    if (hasAnotherArrowShot) clearStagePresentation();
  };

  const startDraw = () => {
    if (isStageLocked) return;
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
    launchPresentation(firstPresentation);
    setQueuedPresentations(freezeWholeRound ? presentations.slice(1) : []);
  };

  const startNextArrow = () => {
    if (
      isDrawing ||
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
    launchPresentation(nextPresentation);
  };

  const reshufflePool = () => {
    if (isStageLocked || poolLimit === 0) return;
    const count = Math.min(poolLimit, eligibleParticipants.length);
    setPoolIds(sampleWithoutReplacement(eligibleParticipants, count).map((participant) => participant.id));
    prepareNextRoundSettings();
    showToast(`후보 ${count}명을 새로 골랐어요.`);
  };

  const openParticipantEditor = (returnPhase: SetupReturnPhase = 'live') => {
    if (isStageLocked) return;
    setSetupStartStep('edit');
    setSetupReturnPhase(returnPhase);
    setSetupSession((value) => value + 1);
    setToolsOpen(false);
    setBroadcastPhase('roster');
  };

  const saveParticipants = (nextParticipants: Participant[]) => {
    const nextIds = new Set(nextParticipants.map((participant) => participant.id));
    setParticipants(nextParticipants);
    setExcludedParticipantIds((ids) => ids.filter((id) => nextIds.has(id)));
    setPoolIds([]);
    clearCurrentRound();
    setToolsOpen(false);
    setBroadcastPhase('preflight');
    showToast(`${nextParticipants.length}명의 참여자 명단을 준비했어요.`);
  };

  const startBroadcast = () => {
    if (drawOptions.length === 0) {
      showToast(drawTarget === 'people' ? '먼저 참여자 명단을 준비해 주세요.' : '먼저 상품을 추가해 주세요.');
      return;
    }
    setToolsOpen(false);
    setBroadcastPhase('live');
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
    clearCurrentRound();
    showToast('당첨 제외 상태를 초기화했어요. 기록은 그대로예요.');
  };

  const startPrizeForWinner = (winner: string) => {
    if (isStageLocked) return;
    if (availablePrizeCount === 0) {
      setSideTab('prizes');
      setToolsOpen(true);
      showToast('먼저 상품을 추가해 주세요.');
      return;
    }
    setRecipient(winner);
    setWinnerCount(1);
    setDrawTarget('prizes');
    setSideTab('prizes');
    prepareNextRoundSettings();
    setToolsOpen(false);
    showToast(`${winner}님에게 드릴 상품을 뽑아 주세요.`);
  };

  const updateParticipantWeight = (id: string, weight: number) => {
    if (isStageLocked) return;
    setParticipants((items) => items.map((participant) => (
      participant.id === id
        ? { ...participant, weight: Math.max(0, Math.min(99, Math.floor(weight) || 0)) }
        : participant
    )));
    prepareNextRoundSettings();
  };

  const updatePrize = (id: string, patch: Partial<Prize>) => {
    if (isStageLocked) return;
    setPrizes((items) => items.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)));
    prepareNextRoundSettings();
  };

  const updatePrizeWeight = (id: string, weight: number) => {
    if (isStageLocked) return;
    setPrizes((items) => items.map((prize) => (
      prize.id === id
        ? { ...prize, weight: Math.max(0, Math.min(99, Math.floor(weight) || 0)) }
        : prize
    )));
    prepareNextRoundSettings();
  };

  const addPrize = () => {
    if (isStageLocked) return;
    setPrizes((items) => [...items, { id: createId('prize'), name: '새 선물', quantity: 1, weight: 1 }]);
    prepareNextRoundSettings();
  };

  const removePrize = (id: string, name: string) => {
    if (isStageLocked) return;
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
      item.mode === 'wheel' ? item.presentation === 'dart' ? '양궁' : '자동' : '마블',
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
      ? roundWheelPresentation === 'dart' ? '룰렛 · 양궁 피니시' : '룰렛 · 자동 회전'
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
  const isArrowRound = roundMode === 'wheel' && roundWheelPresentation === 'dart';
  const isArrowWaiting = isArrowRound && isRoundInProgress && !spinning;
  const drawActionDisabled = toolsOpen || spinning || (isRoundInProgress && !isArrowWaiting);
  const upcomingDrawLabel = drawMode === 'wheel' && wheelPresentation === 'dart'
    ? '화살 쏘기'
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
        ? '진행 도구에서 당첨 제외를 초기화하면 새 회차를 시작할 수 있습니다.'
        : useWeights && candidateParticipants.length > 0
          ? '진행 도구에서 가중치를 조정하면 바로 추첨을 시작할 수 있습니다.'
          : '진행 도구에서 추첨 후보를 준비하면 바로 추첨을 시작할 수 있습니다.'
    : availablePrizeCount === 0
      ? '상품 재고를 추가하면 바로 추첨을 시작할 수 있습니다.'
      : '진행 도구에서 상품 가중치를 조정하면 바로 추첨을 시작할 수 있습니다.';
  const drawButtonLabel = spinning
    ? `${currentRoundResults.length} / ${roundGoal}${roundUnit} 추첨 중…`
    : isArrowWaiting
      ? noAvailableDrawOptions
        ? unavailableDrawLabel
        : `다음 화살 쏘기 (${currentRoundResults.length + 1}/${roundGoal})`
      : noAvailableDrawOptions
        ? unavailableDrawLabel
      : isCompletedRound
        ? `새 회차 시작 · ${upcomingDrawLabel}`
        : upcomingDrawLabel;
  const broadcastVisualClassName = [
    'broadcast-focus__visual',
    isArrowRound && spinning ? 'is-arrow-throwing' : '',
    roundMode === 'wheel' && roundWheelPresentation === 'spin' && spinning ? 'is-auto-spinning' : '',
  ].filter(Boolean).join(' ');

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
        onSpinEnd={preview ? () => undefined : completeDraw}
      />
    ) : (
      <MarbleRace
        participants={names}
        itemType={target === 'prizes' ? 'prize' : 'participant'}
        winnerIndex={activeWinnerIndex}
        racing={activeSpin}
        raceKey={spinKey}
        onRaceEnd={preview ? () => undefined : completeDraw}
      />
    );
  };

  const renderRoundSettings = (location: 'preflight' | 'drawer') => (
    <section className={`broadcast-settings broadcast-settings--${location}`} aria-label={location === 'preflight' ? '방송 시작 설정' : '다음 추첨 설정'}>
      <div className="broadcast-settings__heading">
        <div>
          <p>{location === 'preflight' ? '이번 방송 규칙' : '다음 추첨 설정'}</p>
          <h2>{drawTarget === 'people' ? '사람을 뽑을게요' : '상품을 뽑을게요'}</h2>
        </div>
        <span>{drawOptions.length}{drawTarget === 'people' ? '명 후보' : '개 준비'}</span>
      </div>

      <div className="broadcast-settings__grid">
        <fieldset className="settings-choice">
          <legend>무엇을 뽑을까요?</legend>
          <button type="button" aria-pressed={drawTarget === 'people'} disabled={isStageLocked} onClick={() => changeTarget('people')}>사람</button>
          <button type="button" aria-pressed={drawTarget === 'prizes'} disabled={isStageLocked} onClick={() => changeTarget('prizes')}>상품</button>
        </fieldset>

        <label className="settings-number">
          <span>이번 당첨</span>
          <input
            type="number"
            min="1"
            max={maximumWinnerCount}
            value={winnerCount}
            disabled={isStageLocked}
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
              disabled={isStageLocked}
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
              disabled={isStageLocked}
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
          <button type="button" aria-pressed={drawMode === 'wheel'} disabled={isStageLocked} onClick={() => changeMode('wheel')}>룰렛</button>
          <button type="button" aria-pressed={drawMode === 'marble'} disabled={isStageLocked} onClick={() => changeMode('marble')}>마블</button>
        </fieldset>

        {drawMode === 'wheel' && (
          <fieldset className="settings-choice settings-choice--presentation">
            <legend>룰렛 연출</legend>
            <button type="button" aria-pressed={wheelPresentation === 'spin'} disabled={isStageLocked} onClick={() => changeWheelPresentation('spin')}>자동</button>
            <button type="button" aria-pressed={wheelPresentation === 'dart'} disabled={isStageLocked} onClick={() => changeWheelPresentation('dart')}>양궁</button>
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
            disabled={isStageLocked}
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
              disabled={isStageLocked}
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
                      disabled={isStageLocked}
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
                      disabled={isStageLocked}
                      onChange={(event) => updatePrizeWeight(prize.id, Number(event.target.value))}
                    />
                  </label>
                ))}
          </div>
        )}
      </details>
    </section>
  );

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

      {renderRoundSettings('drawer')}

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
            <button className="compact-button" type="button" disabled={isStageLocked} onClick={() => openParticipantEditor('live')}>편집</button>
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
            <button className="compact-button" type="button" disabled={isStageLocked} onClick={addPrize}>+ 상품</button>
          </div>
          <div className="live-prize-list">
            {prizes.length === 0 && <p className="live-panel__empty">아직 상품이 없어요. 선물을 추가해 주세요.</p>}
            {prizes.map((prize) => (
              <div className="live-prize-row" key={prize.id}>
                <input value={prize.name} disabled={isStageLocked} onChange={(event) => updatePrize(prize.id, { name: event.target.value })} aria-label={`${prize.name} 상품 이름`} />
                <label>
                  <span>수량</span>
                  <input type="number" min="0" disabled={isStageLocked} value={prize.quantity} onChange={(event) => updatePrize(prize.id, { quantity: Math.max(0, Number(event.target.value) || 0) })} aria-label={`${prize.name} 수량`} />
                </label>
                <button type="button" disabled={isStageLocked} onClick={() => removePrize(prize.id, prize.name)} aria-label={`${prize.name} 삭제`}>×</button>
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
                        ? item.presentation === 'dart' ? '양궁 룰렛' : '자동 룰렛'
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

  if (broadcastPhase === 'roster') {
    return (
      <main className="app-shell app-shell--setup">
        <header className="brand-header">
          <a className="brand" href="./" aria-label="Retto Roulette 홈">
            <span className="brand__mark" aria-hidden="true">🍸 💝</span>
            <strong>Retto Roulette</strong>
          </a>
          <span className="header-pill">v0.5.1</span>
        </header>
        <ParticipantSetup
          key={setupSession}
          initialParticipants={participants}
          initialStep={setupStartStep}
          onCancel={participants.length > 0 ? () => setBroadcastPhase(setupReturnPhase) : undefined}
          onStart={saveParticipants}
        />
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    );
  }

  if (broadcastPhase === 'preflight') {
    return (
      <main className="app-shell app-shell--preflight">
        <header className="brand-header">
          <a className="brand" href="./" aria-label="Retto Roulette 홈">
            <span className="brand__mark" aria-hidden="true">🍸 💝</span>
            <strong>Retto Roulette</strong>
          </a>
          <span className="header-pill">방송 준비</span>
        </header>

        <section className="preflight-layout" aria-label="방송 준비">
          <section className="preflight-setup">
            <p className="preflight-setup__eyebrow">방송 준비</p>
            <h1>명단과 방식만 정하면 끝</h1>
            <p className="preflight-setup__copy">명단을 확인하면서 오른쪽에서 실제 방송 화면을 바로 볼 수 있어요.</p>

            <section className="preflight-roster" aria-labelledby="preflight-roster-title">
              <div>
                <p>참여자</p>
                <h2 id="preflight-roster-title">{participants.length}명 준비됨</h2>
              </div>
              <button className="compact-button" type="button" onClick={() => openParticipantEditor('preflight')}>명단 다듬기</button>
              <ol>
                {participants.slice(0, 5).map((participant, index) => (
                  <li key={participant.id}><span>{index + 1}</span><strong>{participant.name}</strong></li>
                ))}
                {participants.length > 5 && <li className="preflight-roster__more">+{participants.length - 5}명</li>}
              </ol>
            </section>

            {renderRoundSettings('preflight')}

            <button className="primary-button preflight-setup__start" type="button" disabled={drawOptions.length === 0} onClick={startBroadcast}>이 설정으로 방송 시작</button>
          </section>

          <aside className="preflight-preview" aria-label="방송 화면 미리보기">
            <div className="preflight-preview__heading">
              <div>
                <p>방송 화면 미리보기</p>
                <h2>{drawMode === 'wheel' ? wheelPresentation === 'dart' ? '양궁 피니시 룰렛' : '자동 룰렛으로 진행' : '마블 레이스로 진행'}</h2>
              </div>
              <span>{drawTarget === 'people' ? `사람 ${effectiveWinnerCount}명` : `상품 ${effectiveWinnerCount}개`}</span>
            </div>
            <div className="preflight-preview__visual">{renderDrawVisual('preview')}</div>
            <p className="preflight-preview__note">방송을 시작하면 준비 화면은 접히고, 룰렛과 당첨자 목록만 크게 남습니다.</p>
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
            disabled={isDrawing}
            aria-expanded={toolsOpen}
            aria-controls="broadcast-tools-drawer"
            onClick={() => {
              if (toolsOpen) closeTools(true);
              else setToolsOpen(true);
            }}
          >진행 도구</button>
        </div>
      </header>

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

      <section className="broadcast-focus" aria-label="방송 집중 화면" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
        <section className="broadcast-focus__stage" aria-labelledby="stage-title">
          <div className="broadcast-focus__heading">
            <div>
              <p>{isDrawing ? '이번 추첨 진행 중' : isArrowWaiting ? '다음 화살 대기' : isCompletedRound ? '직전 추첨 결과' : currentRoundResults.length > 0 ? '이번 추첨 결과' : '추첨 준비'}</p>
              <h1 id="stage-title">{isRoundInProgress ? `${currentRoundResults.length} / ${roundGoal}${roundUnit} 확정` : currentRoundResults.length > 0 ? `${resultTitle} ${currentRoundResults.length}${roundUnit}` : stageTitle}</h1>
            </div>
            <span>
              {roundMode === 'wheel' ? roundWheelPresentation === 'dart' ? '룰렛 · 양궁' : '룰렛 · 자동' : '마블'}
              {' · '}{isWholeRoundPlan ? '시작 후보' : '후보'} {isWholeRoundPlan ? roundInitialCandidateCount : roundCandidateCount}{roundUnit}
            </span>
          </div>

          <p className="broadcast-focus__fairness">{fairnessLabel}</p>

          <div className={broadcastVisualClassName}>
            <div className="broadcast-focus__camera">{renderDrawVisual('live')}</div>
          </div>

          <p className="broadcast-focus__prompt">
            {isArrowWaiting
              ? noAvailableDrawOptions
                  ? `${unavailableDrawHint}가 없어 다음 화살을 시작할 수 없습니다. 진행 도구에서 조정해 주세요.`
                : `${currentRoundResults.length + 1}번째 화살은 버튼을 누르는 순간 그 한 결과가 확정되고, 바로 화살 연출이 시작됩니다.`
              : isDrawing
              ? isArrowRound
                ? `${currentRoundResults.length + 1}번째 화살의 결과와 후보 규칙은 발사 버튼을 누른 순간 고정되었습니다. 지금은 화살 연출 중이에요.`
                : `첫 버튼을 누른 순간 이번 회차 ${roundGoal}${roundUnit}의 결과와 후보 규칙이 고정되었습니다. 지금은 ${currentRoundResults.length}${roundUnit} 공개 중이에요.`
              : isCompletedRound
                ? '오른쪽 보드는 직전 회차의 전체 당첨자입니다. 진행 도구에서 정한 다음 설정은 아래 새 회차 시작 버튼을 누를 때 적용됩니다.'
              : noAvailableDrawOptions
                ? unavailableDrawPrompt
              : currentRoundResults.length > 0
                ? '당첨자 목록은 다음 추첨을 시작할 때까지 이 자리에 남습니다.'
                : roundTarget === 'prizes' && roundRecipient
                  ? `${roundRecipient}님에게 드릴 상품을 뽑아 주세요.`
                  : '추첨 버튼을 누르면 당첨자 보드에 한 명씩 기록됩니다.'}
          </p>

          <div className="broadcast-focus__action">
            <button
              className="primary-button"
              type="button"
              onClick={isArrowWaiting ? startNextArrow : startDraw}
              disabled={drawActionDisabled || drawOptions.length === 0}
            >{drawButtonLabel}</button>
            {drawTarget === 'people' && poolLimit > 0 && (
              <button className="stage-link" type="button" disabled={isStageLocked || toolsOpen} onClick={reshufflePool}>후보 다시 섞기</button>
            )}
          </div>
        </section>

        <aside className="broadcast-focus__results" aria-label="이번 추첨 결과">
          <CurrentRoundWinners
            winners={currentRoundResults.map((result) => ({
              id: result.id,
              name: result.winner,
              detail: result.target === 'prizes' && result.recipient ? `${result.recipient}님에게 전달` : undefined,
            }))}
            drawCount={roundGoal}
            unit={roundUnit}
            latestWinnerId={latestRoundResult?.id}
            title={resultTitle}
            announcement={currentRoundResults.length > 0
              ? spinning
                ? `${resultTitle} ${currentRoundResults.length}${roundUnit}${roundUnitSubjectParticle} 확정되었습니다.`
                : `${resultTitle} ${currentRoundResults.length}${roundUnit}${roundUnitSubjectParticle} 발표되었습니다.`
              : undefined}
            removalMessage={currentRoundResults.length > 0 ? resultRemovalMessage : undefined}
          />
          {currentRound?.target === 'people' && currentRoundResults.length > 0 && (
            <button className="broadcast-focus__prize-link" type="button" disabled={isStageLocked} onClick={() => {
              setSideTab('prizes');
              setToolsOpen(true);
            }}>당첨자별 상품 뽑기</button>
          )}
        </aside>
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

export default App;
