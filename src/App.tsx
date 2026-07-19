import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import BroadcastActionDock, { type BroadcastDockAction } from './components/BroadcastActionDock';
import BroadcastCandidateRoster from './components/BroadcastCandidateRoster';
import CurrentRoundWinners from './components/CurrentRoundWinners';
import DrawPreviewDirector from './components/DrawPreviewDirector';
import MarbleRace from './components/MarbleRace';
import ParticipantSetup from './components/ParticipantSetup';
import RouletteWheel, {
  type RouletteRevealEvent,
  type RouletteRevealPhase,
  type RouletteWheelHandle,
} from './components/RouletteWheel';
import RoundSetupPanel from './components/RoundSetupPanel';
import WinnerHero from './components/WinnerHero';
import {
  appendBroadcastSessionResult,
  createBroadcastSession,
  type BroadcastSession,
} from './lib/broadcastSession';
import { sampleWithoutReplacement } from './lib/draw';
import { createHistoryCsv } from './lib/historyCsv';
import { createPrizeDrawOptions } from './lib/prizeDraw';
import {
  appendPrizeAssignmentResult,
  arePrizeRecipientPlansEqual,
  countAssignedPrizeRecipients,
  createLinkedPrizeRecipients,
  findLatestPeopleWinnerResults,
  findNextPrizeRecipient,
  reconcileManualPrizeRecipients,
  retainAssignedPrizeRecipientIds,
  retainPrizeAssignmentResults,
} from './lib/prizeRecipients';
import {
  getRaffleTransition,
  isRaffleActive,
  RAFFLE_STATUS_META,
  type RaffleEvent,
  type RaffleStatus,
} from './lib/raffleLifecycle';
import {
  consumePendingRecord,
  mergeRecoveredHistory,
  parsePendingRaffleLock,
  PENDING_RAFFLE_KEY,
} from './lib/pendingRaffle';
import { derivePreparationReadiness } from './lib/preparation';
import {
  createStoredPrizeAssignment,
  mergePrizeAssignmentResults,
  parseStoredPrizeAssignment,
  PRIZE_ASSIGNMENT_KEY,
} from './lib/prizeAssignmentStorage';
import {
  isCurrentPresentationCompletion,
  type PresentationRunToken,
} from './lib/presentationRun';
import {
  createDartAimSession,
  createDartPhysicalCommit,
  createRouletteGeometrySignature,
  createSpinPhysicalCommit,
  resolveDartImpactPoint,
  type DartAimSession,
  type DartPhysicalCommit,
  type DartShotPlan,
  type RouletteFinishLanding,
  type SpinPhysicalCommit,
} from './lib/roulette';
import type {
  DrawMode,
  DrawRecord,
  DrawTarget,
  Participant,
  Prize,
  PrizeRecipient,
  PrizeRecipientSource,
  WheelPresentation,
} from './types';

import './App.css';
import './styles/rettoRoulette.cinematic.css';
import './styles/rettoRoulette.flow.css';
import './styles/rettoRoulette.preparation.css';
import './styles/rettoRoulette.viewport.css';
import './styles/rettoRoulette.liveInfo.css';

type DrawOption = {
  id: string;
  /** Inventory source for a product sector; participant options use their own id. */
  sourceId?: string;
  name: string;
  weight: number;
};

type SideTab = 'participants' | 'prizes' | 'history';
type SetupStartStep = 'paste' | 'edit';
type SetupReturnStatus = Extract<RaffleStatus, 'configuring' | 'ready' | 'completed'>;

type CurrentRound = {
  id: string;
  sessionId: string;
  /** Optional broadcaster-supplied context shown throughout the live result. */
  label?: string;
  /** Optional reward/event separated from the on-air title. */
  rewardLabel?: string;
  target: DrawTarget;
  mode: DrawMode;
  wheelPresentation: WheelPresentation;
  candidateCount: number;
  /** A limited people pool stays fixed for the whole active round. */
  poolLimit: number;
  removeAfterDraw: boolean;
  useWeights: boolean;
  recipientId?: string;
  recipient?: string;
  prizeAssignmentBatchId?: string;
  results: DrawRecord[];
};

type PlannedPresentation = {
  options: DrawOption[];
  winnerIndex: number;
  target: DrawTarget;
  selectedAt: string;
  candidateFingerprint: string;
  candidateTotalWeight: number;
  /** Physical coordinate inside the slice that selected this result. */
  landing: RouletteFinishLanding;
  /** Click-time rotor coordinate that physically selected an automatic winner. */
  spinCommit?: SpinPhysicalCommit;
  /** Result-neutral physical coordinates fixed once for a dart reveal. */
  dartShot?: DartShotPlan;
  /** Rotor/aim impact that physically selected a dart winner at click time. */
  dartCommit?: DartPhysicalCommit;
  recipientId?: string;
  recipient?: string;
};

type CommittedPresentation = PlannedPresentation & {
  /** Click-time audit record persisted before the reveal starts. */
  lockedResult: DrawRecord;
};

type ActivePresentation = CommittedPresentation & {
  /** Rejects an animation callback from an older result or abandoned round. */
  revealId: number;
};

type PresentationBeat = 'idle' | 'motion' | 'hero' | 'dock';
type CinematicRevealPhase = 'idle' | 'result-committed' | 'motion-started' | RouletteRevealPhase;
type PresentationCompletion = PresentationRunToken;

type CinematicCameraStyle = CSSProperties & {
  '--cinematic-impact-x': string;
  '--cinematic-impact-y': string;
  '--cinematic-final-x': string;
  '--cinematic-final-y': string;
};

type WinnerHeroState = {
  revealId: number;
  result: DrawRecord;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit' });
const TIME_WITH_SECONDS_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function formatTime(iso: string, includeSeconds = false) {
  return (includeSeconds ? TIME_WITH_SECONDS_FORMATTER : TIME_FORMATTER).format(new Date(iso));
}

function prizeTotal(prizes: Prize[]) {
  return prizes.reduce((sum, prize) => (
    prize.name.trim() ? sum + Math.max(0, prize.quantity) : sum
  ), 0);
}

function totalEffectiveWeight(options: readonly DrawOption[]) {
  return options.reduce((sum, option) => sum + Math.max(0, option.weight), 0);
}

function isStoredDrawRecord(value: unknown): value is DrawRecord {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<DrawRecord>;
  return typeof item.id === 'string'
    && typeof item.createdAt === 'string'
    && (item.mode === 'wheel' || item.mode === 'marble')
    && (item.target === 'people' || item.target === 'prizes')
    && typeof item.winner === 'string';
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

function attachLockedResult(
  presentation: PlannedPresentation,
  round: CurrentRound,
  roundOrder: number,
): CommittedPresentation | null {
  const chosen = presentation.options[presentation.winnerIndex];
  if (!chosen) return null;

  return {
    ...presentation,
    lockedResult: {
      id: createId('result'),
      sessionId: round.sessionId,
      createdAt: presentation.selectedAt,
      roundId: round.id,
      roundLabel: round.label,
      rewardLabel: round.rewardLabel,
      roundOrder,
      mode: round.mode,
      presentation: round.mode === 'wheel' ? round.wheelPresentation : undefined,
      candidateCount: presentation.options.length,
      candidateFingerprint: presentation.candidateFingerprint,
      candidateTotalWeight: presentation.candidateTotalWeight,
      useWeights: round.useWeights,
      removeAfterDraw: round.removeAfterDraw,
      target: presentation.target,
      winner: chosen.name,
      prize: presentation.target === 'prizes' ? chosen.name : undefined,
      prizeId: presentation.target === 'prizes' ? chosen.sourceId ?? chosen.id : undefined,
      prizeUnitId: presentation.target === 'prizes' ? `${chosen.id}::${round.id}` : undefined,
      prizeProbabilityModel: presentation.target === 'prizes' ? 'quantity-ratio' : undefined,
      recipientId: presentation.target === 'prizes' ? presentation.recipientId : undefined,
      recipient: presentation.target === 'prizes' ? presentation.recipient : undefined,
      prizeAssignmentBatchId: presentation.target === 'prizes'
        ? round.prizeAssignmentBatchId
        : undefined,
    },
  };
}

function App() {
  const [drawMode] = useState<DrawMode>('wheel');
  const [wheelPresentation, setWheelPresentation] = useState<WheelPresentation>('spin');
  const [drawTarget, setDrawTarget] = useState<DrawTarget>('people');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [prizes, setPrizes] = useState<Prize[]>([]);
  const [excludedParticipantIds, setExcludedParticipantIds] = useState<string[]>([]);
  const [poolLimit, setPoolLimit] = useState(0);
  const [poolIds, setPoolIds] = useState<string[]>([]);
  const [drawLabel, setDrawLabel] = useState('');
  const [rewardLabel, setRewardLabel] = useState('');
  const [removeAfterDraw, setRemoveAfterDraw] = useState(true);
  const [weightModes, setWeightModes] = useState<Record<DrawTarget, boolean>>({ people: false, prizes: false });
  const [prizeRecipients, setPrizeRecipients] = useState<PrizeRecipient[]>([]);
  const [prizeRecipientText, setPrizeRecipientText] = useState('');
  const [prizeRecipientSource, setPrizeRecipientSource] = useState<PrizeRecipientSource>('manual');
  const [assignedPrizeRecipientIds, setAssignedPrizeRecipientIds] = useState<string[]>([]);
  const [prizeAssignmentResults, setPrizeAssignmentResults] = useState<DrawRecord[]>([]);
  const [prizeAssignmentBatchId, setPrizeAssignmentBatchId] = useState<string | null>(null);
  const [prizeAssignmentHydrated, setPrizeAssignmentHydrated] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [presentedOptions, setPresentedOptions] = useState<DrawOption[]>([]);
  const [activePresentation, setActivePresentation] = useState<ActivePresentation | null>(null);
  const [presentationBeat, setPresentationBeat] = useState<PresentationBeat>('idle');
  const [cinematicRevealPhase, setCinematicRevealPhase] = useState<CinematicRevealPhase>('idle');
  const [winnerHero, setWinnerHero] = useState<WinnerHeroState | null>(null);
  const [currentRound, setCurrentRound] = useState<CurrentRound | null>(null);
  const [broadcastSession, setBroadcastSession] = useState<BroadcastSession | null>(null);
  const [rotorReady, setRotorReady] = useState(false);
  const [dartAimSession, setDartAimSession] = useState<DartAimSession | null>(null);
  const [history, setHistory] = useState<DrawRecord[]>([]);
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const [sideTab, setSideTab] = useState<SideTab>('participants');
  const [raffleStatus, setRaffleStatus] = useState<RaffleStatus>('configuring');
  const [setupReturnStatus, setSetupReturnStatus] = useState<SetupReturnStatus>('configuring');
  const [setupSession, setSetupSession] = useState(0);
  const [setupStartStep, setSetupStartStep] = useState<SetupStartStep>('paste');
  const [participantPreviewDraft, setParticipantPreviewDraft] = useState<Participant[]>([]);
  const [rosterEditorDirty, setRosterEditorDirty] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toolsTriggerRef = useRef<HTMLButtonElement>(null);
  const toolsCloseRef = useRef<HTMLButtonElement>(null);
  const toolsDrawerRef = useRef<HTMLElement>(null);
  const rosterTriggerRef = useRef<HTMLElement | null>(null);
  const raffleStatusRef = useRef<RaffleStatus>('configuring');
  const presentationRunRef = useRef(0);
  const spinKeyRef = useRef(0);
  const presentationStartTimerRef = useRef<number | null>(null);
  const winnerHeroTimerRef = useRef<number | null>(null);
  const winnerDockTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const dartAimSequenceRef = useRef(0);
  const dartAimContextRef = useRef<string | null>(null);
  const liveWheelRef = useRef<RouletteWheelHandle>(null);
  const historyStorageWarningShownRef = useRef(false);
  const prizeAssignmentStorageWarningShownRef = useRef(false);
  const pendingRecoveryNeedsCleanupRef = useRef(false);
  const resolvedRevealIdsRef = useRef(new Set<number>());
  const useWeights = drawTarget === 'people' ? weightModes.people : false;

  const setUseWeights = useCallback((value: boolean) => {
    if (drawTarget !== 'people') return;
    setWeightModes((modes) => ({ ...modes, [drawTarget]: value }));
  }, [drawTarget]);

  const primeDartAim = useCallback(() => {
    const id = dartAimSequenceRef.current + 1;
    dartAimSequenceRef.current = id;
    const startedAt = typeof performance === 'undefined' ? Date.now() : performance.now();
    setDartAimSession(createDartAimSession(id, startedAt));
  }, []);

  useEffect(() => {
    const aimContext = raffleStatus === 'ready' && wheelPresentation === 'dart'
      ? `ready:${currentRound?.id ?? 'first'}`
      : null;
    if (aimContext) {
      if (dartAimContextRef.current !== aimContext) {
        dartAimContextRef.current = aimContext;
        primeDartAim();
      }
      return;
    }
    if (raffleStatus === 'configuring' || raffleStatus === 'completed') {
      dartAimContextRef.current = null;
      setDartAimSession(null);
    }
  }, [currentRound?.id, currentRound?.results.length, currentRound?.wheelPresentation, primeDartAim, raffleStatus, wheelPresentation]);

  const handleRouletteRevealPhase = useCallback((event: RouletteRevealEvent) => {
    // Animation callbacks can arrive after a round was reset. Only the wheel
    // run that is currently on air may move the cinematic camera/state.
    if (
      event.spinKey !== spinKeyRef.current ||
      event.revealId !== presentationRunRef.current
    ) return;
    setCinematicRevealPhase(event.phase);
  }, []);

  const transitionRaffle = useCallback((event: RaffleEvent) => {
    const nextStatus = getRaffleTransition(raffleStatusRef.current, event);
    if (!nextStatus) return false;
    raffleStatusRef.current = nextStatus;
    if (nextStatus === 'ready') setRotorReady(false);
    setRaffleStatus(nextStatus);
    return true;
  }, []);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToast(null);
    }, 3200);
  }, []);

  const persistPendingResults = useCallback((roundId: string, records: DrawRecord[]) => {
    try {
      localStorage.setItem(PENDING_RAFFLE_KEY, JSON.stringify({
        version: 1,
        roundId,
        savedAt: new Date().toISOString(),
        records,
      }));
      return true;
    } catch {
      showToast('결과는 고정됐지만 복구용 기록을 저장하지 못했어요. 이 탭을 닫지 마세요.');
      return false;
    }
  }, [showToast]);

  const cancelWinnerRevealTimers = useCallback(() => {
    if (presentationStartTimerRef.current !== null) {
      window.clearTimeout(presentationStartTimerRef.current);
      presentationStartTimerRef.current = null;
    }
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
    let storedHistory: DrawRecord[] = [];
    try {
      const saved = localStorage.getItem('retto-roulette-history');
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) storedHistory = parsed.filter(isStoredDrawRecord).slice(0, 100);
      }
    } catch {
      // A history failure should never prevent a live giveaway from working.
    }

    try {
      const pending = parsePendingRaffleLock(localStorage.getItem(PENDING_RAFFLE_KEY));
      if (pending) {
        const knownIds = new Set(storedHistory.map((record) => record.id));
        const recoveredCount = pending.records.filter((record) => !knownIds.has(record.id)).length;
        storedHistory = mergeRecoveredHistory(storedHistory, pending);
        pendingRecoveryNeedsCleanupRef.current = true;
        if (recoveredCount > 0) {
          showToast(`이전 회차에서 확정된 결과 ${recoveredCount}건을 당첨 기록에 복구했어요.`);
        }
      }
    } catch {
      // Invalid recovery data is ignored without blocking a fresh raffle.
    }

    setHistory(storedHistory);
    setHistoryHydrated(true);
  }, [showToast]);

  useEffect(() => {
    if (!historyHydrated) return;
    try {
      localStorage.setItem('retto-roulette-history', JSON.stringify(history.slice(0, 100)));
      if (pendingRecoveryNeedsCleanupRef.current) {
        localStorage.removeItem(PENDING_RAFFLE_KEY);
        pendingRecoveryNeedsCleanupRef.current = false;
      } else {
        const pending = parsePendingRaffleLock(localStorage.getItem(PENDING_RAFFLE_KEY));
        if (pending) {
          const nextPending = history.reduce(
            (remaining, record) => (
              remaining && record.revealedAt ? consumePendingRecord(remaining, record.id) : remaining
            ),
            pending as ReturnType<typeof parsePendingRaffleLock>,
          );
          if (nextPending) localStorage.setItem(PENDING_RAFFLE_KEY, JSON.stringify(nextPending));
          else localStorage.removeItem(PENDING_RAFFLE_KEY);
        }
      }
    } catch {
      if (history.length === 0 || historyStorageWarningShownRef.current) return;
      historyStorageWarningShownRef.current = true;
      showToast('당첨 기록을 브라우저에 저장하지 못했어요. CSV로 내려받아 보관해 주세요.');
    }
  }, [history, historyHydrated, showToast]);

  useEffect(() => {
    try {
      const stored = parseStoredPrizeAssignment(localStorage.getItem(PRIZE_ASSIGNMENT_KEY));
      if (stored) {
        setPrizeRecipients(stored.recipients);
        setPrizeRecipientText(stored.recipients.map((recipient) => recipient.name).join('\n'));
        setPrizeRecipientSource(stored.source);
        setAssignedPrizeRecipientIds(stored.assignedRecipientIds);
        setPrizeAssignmentResults(stored.results);
        setPrizeAssignmentBatchId(stored.batchId);
      }
    } catch {
      // An unavailable browser store must not block a live draw.
    } finally {
      setPrizeAssignmentHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!prizeAssignmentHydrated) return;
    try {
      if (prizeRecipients.length === 0) {
        localStorage.removeItem(PRIZE_ASSIGNMENT_KEY);
        return;
      }
      if (!prizeAssignmentBatchId) return;
      localStorage.setItem(PRIZE_ASSIGNMENT_KEY, JSON.stringify(createStoredPrizeAssignment(
        prizeAssignmentBatchId,
        prizeRecipientSource,
        prizeRecipients,
        prizeAssignmentResults,
      )));
    } catch {
      if (prizeAssignmentStorageWarningShownRef.current) return;
      prizeAssignmentStorageWarningShownRef.current = true;
      showToast('상품 배정 진행을 브라우저에 저장하지 못했어요. 이 탭을 닫기 전에 배정을 마쳐 주세요.');
    }
  }, [
    assignedPrizeRecipientIds,
    prizeAssignmentBatchId,
    prizeAssignmentHydrated,
    prizeAssignmentResults,
    prizeRecipientSource,
    prizeRecipients,
    showToast,
  ]);

  useEffect(() => {
    if (!historyHydrated || !prizeAssignmentHydrated || !prizeAssignmentBatchId) return;
    const reconciledResults = mergePrizeAssignmentResults(
      prizeAssignmentBatchId,
      prizeRecipients,
      prizeAssignmentResults,
      history,
    );
    const reconciledAssignedIds = reconciledResults.map((result) => result.recipientId as string);
    if (reconciledResults.map((result) => result.id).join('|') !== prizeAssignmentResults.map((result) => result.id).join('|')) {
      setPrizeAssignmentResults(reconciledResults);
    }
    if (reconciledAssignedIds.join('|') !== assignedPrizeRecipientIds.join('|')) {
      setAssignedPrizeRecipientIds(reconciledAssignedIds);
    }
  }, [
    assignedPrizeRecipientIds,
    history,
    historyHydrated,
    prizeAssignmentBatchId,
    prizeAssignmentHydrated,
    prizeAssignmentResults,
    prizeRecipients,
  ]);

  useEffect(() => {
    if (!isRaffleActive(raffleStatus)) return undefined;

    const protectActiveRound = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectActiveRound);
    return () => window.removeEventListener('beforeunload', protectActiveRound);
  }, [raffleStatus]);

  useEffect(() => {
    if (!window.location.hash.startsWith('#import=')) return;
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    showToast('네이버 URL 자동 가져오기는 종료됐어요. 카페 페이지를 붙여넣어 주세요.');
  }, [showToast]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [raffleStatus]);

  useEffect(() => () => {
    // Ignore a late browser animation callback after this app has gone away.
    presentationRunRef.current += 1;
    cancelWinnerRevealTimers();
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
  }, [cancelWinnerRevealTimers]);

  const excludedParticipantIdSet = useMemo(
    () => new Set(excludedParticipantIds),
    [excludedParticipantIds],
  );
  const eligibleParticipants = useMemo(
    () => participants.filter((participant) => !excludedParticipantIdSet.has(participant.id)),
    [excludedParticipantIdSet, participants],
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
      : createPrizeDrawOptions(prizes);

    return useWeights ? options.filter((option) => option.weight > 0) : options;
  }, [candidateParticipants, drawTarget, prizes, useWeights]);


  const drawOptionNames = useMemo(() => drawOptions.map((option) => option.name), [drawOptions]);
  const drawOptionWeights = useMemo(() => drawOptions.map((option) => option.weight), [drawOptions]);
  const displayOptions = useMemo(
    () => spinning || winnerIndex !== null ? presentedOptions : drawOptions,
    [drawOptions, presentedOptions, spinning, winnerIndex],
  );
  const displayNames = useMemo(() => displayOptions.map((option) => option.name), [displayOptions]);
  const displayWeights = useMemo(() => displayOptions.map((option) => option.weight), [displayOptions]);
  const availablePrizeCount = prizeTotal(prizes);
  const recentPeopleWinnerResults = useMemo(
    () => findLatestPeopleWinnerResults(history),
    [history],
  );
  const recentLinkedPrizeRecipients = useMemo(
    () => createLinkedPrizeRecipients(recentPeopleWinnerResults),
    [recentPeopleWinnerResults],
  );
  const recentWinnersAlreadyLoaded = prizeRecipientSource === 'linked'
    && arePrizeRecipientPlansEqual(prizeRecipients, recentLinkedPrizeRecipients);
  const nextPrizeRecipient = useMemo(
    () => findNextPrizeRecipient(prizeRecipients, assignedPrizeRecipientIds),
    [assignedPrizeRecipientIds, prizeRecipients],
  );
  const assignedPrizeRecipientCount = useMemo(
    () => countAssignedPrizeRecipients(prizeRecipients, assignedPrizeRecipientIds),
    [assignedPrizeRecipientIds, prizeRecipients],
  );
  const isPresentationLocked = raffleStatus === 'locking' || raffleStatus === 'presenting';
  const isStageLocked = isRaffleActive(raffleStatus);
  const isConfigurationEditable = raffleStatus === 'configuring';

  const buildPresentationPlan = useCallback((
    snapshot: readonly DrawOption[],
    target: DrawTarget,
    recipientIdSnapshot: string | undefined,
    recipientSnapshot: string | undefined,
    wheelReveal: WheelPresentation,
    spinPhysicalCommit?: SpinPhysicalCommit,
    dartPhysicalCommit?: DartPhysicalCommit,
  ) => {
    const options = [...snapshot];
    const selectedAt = new Date().toISOString();

    if (wheelReveal === 'dart') {
      if (
        !dartPhysicalCommit
        || dartPhysicalCommit.winnerIndex < 0
        || dartPhysicalCommit.winnerIndex >= options.length
        || dartPhysicalCommit.geometrySignature !== createRouletteGeometrySignature(
          options.length,
          options.map((option) => option.weight),
        )
      ) return [];

      return [{
        options,
        winnerIndex: dartPhysicalCommit.winnerIndex,
        target,
        selectedAt,
        recipientId: recipientIdSnapshot,
        recipient: recipientSnapshot,
        candidateFingerprint: fingerprintOptions(options),
        candidateTotalWeight: totalEffectiveWeight(options),
        landing: dartPhysicalCommit.landing,
        dartShot: dartPhysicalCommit.shot,
        dartCommit: dartPhysicalCommit,
      }];
    }

    if (
      !spinPhysicalCommit
      || spinPhysicalCommit.winnerIndex < 0
      || spinPhysicalCommit.winnerIndex >= options.length
      || spinPhysicalCommit.geometrySignature !== createRouletteGeometrySignature(
        options.length,
        options.map((option) => option.weight),
      )
    ) return [];

    return [{
      options,
      winnerIndex: spinPhysicalCommit.winnerIndex,
      target,
      selectedAt,
      recipientId: recipientIdSnapshot,
      recipient: recipientSnapshot,
      candidateFingerprint: fingerprintOptions(options),
      candidateTotalWeight: totalEffectiveWeight(options),
      landing: spinPhysicalCommit.landing,
      spinCommit: spinPhysicalCommit,
    }];
  }, []);

  /**
   * Starts an already-committed reveal. Selection happened before this call;
   * the short locking beat makes that boundary visible on the broadcast.
   */
  const launchCommittedPresentation = useCallback((presentation: CommittedPresentation) => {
    if (!transitionRaffle('lock-result')) return false;

    cancelWinnerRevealTimers();
    setWinnerHero(null);
    const revealId = presentationRunRef.current + 1;
    presentationRunRef.current = revealId;
    setActivePresentation({ ...presentation, revealId });
    setPresentedOptions(presentation.options);
    // Keep the committed winner out of the visual component until motion
    // begins. This preserves the high-speed ready wheel during the lock badge
    // and prevents a one-frame winner highlight before the reveal.
    setWinnerIndex(null);
    setSpinning(false);
    setPresentationBeat('motion');
    setCinematicRevealPhase('result-committed');

    // Keep one short, visible frame between "the result is fixed" and the
    // presentation. The wheel continues its idle high-speed rotation in this
    // phase, so the pause proves ordering without killing momentum.
    const beginPresentation = () => {
      if (presentationRunRef.current !== revealId) return;
      presentationStartTimerRef.current = null;
      if (!transitionRaffle('start-presentation')) return;
      const nextSpinKey = spinKeyRef.current + 1;
      spinKeyRef.current = nextSpinKey;
      setSpinKey(nextSpinKey);
      setWinnerIndex(presentation.winnerIndex);
      setCinematicRevealPhase('motion-started');
      setSpinning(true);
    };

    if (presentation.dartCommit) beginPresentation();
    else presentationStartTimerRef.current = window.setTimeout(beginPresentation, 140);

    return true;
  }, [cancelWinnerRevealTimers, transitionRaffle]);

  const clearStagePresentation = () => {
    cancelWinnerRevealTimers();
    setWinnerIndex(null);
    setPresentedOptions([]);
    setActivePresentation(null);
    setWinnerHero(null);
    setPresentationBeat('idle');
    setCinematicRevealPhase('idle');
  };

  const clearCurrentRound = () => {
    presentationRunRef.current += 1;
    clearStagePresentation();
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

  const changeWheelPresentation = (presentation: WheelPresentation) => {
    if (!isConfigurationEditable) return;
    setWheelPresentation(presentation);
    prepareNextRoundSettings();
  };

  const completeDraw = (completion: PresentationCompletion) => {
    const presentation = activePresentation;
    const activeRound = currentRound;
    if (
      raffleStatusRef.current !== 'presenting' ||
      !spinning ||
      !presentation ||
      !activeRound ||
      !isCurrentPresentationCompletion(
        completion,
        spinKeyRef.current,
        presentationRunRef.current,
        presentation.revealId,
      )
    ) {
      return;
    }

    const chosen = presentation.options[presentation.winnerIndex];
    if (!chosen) {
      setSpinning(false);
      return;
    }

    if (resolvedRevealIdsRef.current.has(presentation.revealId)) return;
    resolvedRevealIdsRef.current.add(presentation.revealId);
    if (resolvedRevealIdsRef.current.size > 200) {
      const oldestRevealId = resolvedRevealIdsRef.current.values().next().value;
      if (typeof oldestRevealId === 'number') resolvedRevealIdsRef.current.delete(oldestRevealId);
    }

    const result: DrawRecord = {
      ...presentation.lockedResult,
      revealedAt: new Date().toISOString(),
    };

    setHistory((items) => [result, ...items].slice(0, 100));
    setCurrentRound((round) => {
      if (!round) return { ...activeRound, results: [...activeRound.results, result] };
      return { ...round, results: [...round.results, result] };
    });
    setBroadcastSession((session) => (
      session ? appendBroadcastSessionResult(session, result) : session
    ));

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
      if (result.recipientId) {
        const completedRecipientId = result.recipientId;
        setAssignedPrizeRecipientIds((ids) => (
          ids.includes(completedRecipientId) ? ids : [...ids, completedRecipientId]
        ));
        setPrizeAssignmentResults((items) => appendPrizeAssignmentResult(items, result));
      }
      setSideTab('history');
    }

    setSpinning(false);
    cancelWinnerRevealTimers();
    setPresentationBeat('hero');
    setWinnerHero({
      revealId: presentation.revealId,
      result,
    });

    winnerHeroTimerRef.current = window.setTimeout(() => {
      if (presentationRunRef.current !== presentation.revealId) return;

      winnerHeroTimerRef.current = null;
      setPresentationBeat('dock');
      winnerDockTimerRef.current = window.setTimeout(() => {
        if (presentationRunRef.current !== presentation.revealId) return;

        winnerDockTimerRef.current = null;
        setWinnerHero(null);
        setPresentationBeat('idle');
        setCinematicRevealPhase('idle');
        transitionRaffle('complete-round');
      }, 760);
    }, 2_200);
  };

  const freezePhysicalDart = () => {
    const capture = liveWheelRef.current?.freezeDartAim();
    if (!capture) return null;
    return createDartPhysicalCommit(
      capture.rotation,
      capture.angularVelocity,
      drawOptions.length,
      drawOptionWeights,
      capture.shot,
    );
  };

  const capturePhysicalSpin = () => {
    const capture = liveWheelRef.current?.captureRotor();
    if (!capture) return null;
    return createSpinPhysicalCommit(
      capture.rotation,
      capture.angularVelocity,
      drawOptions.length,
      drawOptionWeights,
      undefined,
      capture.selectionGeometry,
    );
  };

  const startDraw = () => {
    if (raffleStatusRef.current !== 'ready') return;
    if (!rotorReady) return;
    if (!broadcastSession || broadcastSession.target !== drawTarget) {
      showToast('방송 세션을 다시 열어 주세요.');
      return;
    }
    if (drawOptions.length === 0) {
      showToast(drawTarget === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }
    if (drawTarget === 'prizes' && prizeRecipients.length > 0 && !nextPrizeRecipient) {
      showToast('받을 사람 전원의 상품 배정이 끝났어요. 설계 화면에서 배정을 다시 시작해 주세요.');
      return;
    }

    const spinCommit = wheelPresentation === 'spin' ? capturePhysicalSpin() : undefined;
    const dartCommit = wheelPresentation === 'dart' ? freezePhysicalDart() : undefined;
    if (wheelPresentation === 'spin' && !spinCommit) {
      showToast('원판 위치가 준비될 때까지 잠시 기다려 주세요.');
      return;
    }
    if (wheelPresentation === 'dart' && !dartCommit) {
      showToast('다트 조준점이 준비될 때까지 잠시 기다려 주세요.');
      return;
    }

    clearStagePresentation();
    const recipientIdSnapshot = drawTarget === 'prizes' ? nextPrizeRecipient?.id : undefined;
    const recipientSnapshot = drawTarget === 'prizes' ? nextPrizeRecipient?.name : undefined;
    const presentations = buildPresentationPlan(
      drawOptions,
      drawTarget,
      recipientIdSnapshot,
      recipientSnapshot,
      wheelPresentation,
      spinCommit ?? undefined,
      dartCommit ?? undefined,
    );
    if (presentations.length === 0) {
      if (dartCommit) primeDartAim();
      showToast(drawTarget === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }

    const nextRound: CurrentRound = {
      id: createId('round'),
      sessionId: broadcastSession.id,
      label: drawLabel.trim() || undefined,
      rewardLabel: drawTarget === 'people' ? rewardLabel.trim() || undefined : undefined,
      target: drawTarget,
      mode: drawMode,
      wheelPresentation,
      candidateCount: drawOptions.length,
      poolLimit,
      removeAfterDraw,
      useWeights,
      recipientId: recipientIdSnapshot,
      recipient: recipientSnapshot,
      prizeAssignmentBatchId: drawTarget === 'prizes' && recipientIdSnapshot
        ? prizeAssignmentBatchId ?? undefined
        : undefined,
      results: [],
    };
    const committedPresentations = presentations.flatMap((presentation, index) => {
      const committed = attachLockedResult(presentation, nextRound, index + 1);
      return committed ? [committed] : [];
    });
    const firstPresentation = committedPresentations[0];
    if (!firstPresentation || committedPresentations.length !== presentations.length) {
      if (dartCommit) primeDartAim();
      return;
    }

    const pendingSaved = persistPendingResults(
      nextRound.id,
      committedPresentations.map((presentation) => presentation.lockedResult),
    );
    if (!launchCommittedPresentation(firstPresentation)) {
      if (pendingSaved) {
        try { localStorage.removeItem(PENDING_RAFFLE_KEY); } catch { /* ignored */ }
      }
      if (dartCommit) primeDartAim();
      return;
    }

    setCurrentRound(nextRound);
    setToolsOpen(false);
  };

  const reshufflePool = () => {
    if ((raffleStatus !== 'configuring' && raffleStatus !== 'ready') || poolLimit === 0) return;
    const count = Math.min(poolLimit, eligibleParticipants.length);
    setPoolIds(sampleWithoutReplacement(eligibleParticipants, count).map((participant) => participant.id));
    showToast(`후보 ${count}명을 새로 골랐어요.`);
  };

  const restoreRosterFocus = (returnStatus: SetupReturnStatus) => {
    window.requestAnimationFrame(() => {
      const previousTrigger = rosterTriggerRef.current;
      if (previousTrigger?.isConnected && !previousTrigger.closest('[inert]')) {
        previousTrigger.focus();
        return;
      }

      const fallbackSelector = returnStatus === 'configuring'
        ? '.preparation-preview__primary'
        : '.broadcast-focus__action button, .broadcast-header__actions button';
      document.querySelector<HTMLElement>(fallbackSelector)?.focus();
    });
  };

  const openParticipantEditor = (returnStatus: SetupReturnStatus, startStep: SetupStartStep = 'edit') => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!transitionRaffle('open-roster')) return;
    rosterTriggerRef.current = trigger;
    setParticipantPreviewDraft(participants);
    setRosterEditorDirty(false);
    setSetupStartStep(startStep);
    setSetupReturnStatus(returnStatus);
    setSetupSession((value) => value + 1);
    setToolsOpen(false);
  };

  const clearParticipantRoster = () => {
    if (raffleStatus !== 'roster' || participants.length === 0) return;
    if (!window.confirm(`현재 명단 ${participants.length}명을 비울까요? 당첨 기록과 상품 설정은 유지됩니다.`)) return;

    setParticipants([]);
    setParticipantPreviewDraft([]);
    setExcludedParticipantIds([]);
    setPoolIds([]);
    setPoolLimit(0);
    clearCurrentRound();
    setSetupReturnStatus('configuring');
    setSetupStartStep('paste');
    setSetupSession((value) => value + 1);
    setRosterEditorDirty(false);
    showToast('명단을 비웠어요. 새 명단을 붙여넣거나 직접 입력해 주세요.');
  };

  const cancelParticipantEditor = () => {
    if (rosterEditorDirty && !window.confirm('저장하지 않은 명단 변경을 버리고 닫을까요?')) return;
    const event = setupReturnStatus === 'configuring'
      ? 'cancel-roster-configuring'
      : setupReturnStatus === 'completed'
        ? 'cancel-roster-completed'
        : 'cancel-roster-ready';
    setParticipantPreviewDraft([]);
    setRosterEditorDirty(false);
    if (transitionRaffle(event)) {
      restoreRosterFocus(setupReturnStatus);
    }
  };

  const saveParticipants = (nextParticipants: Participant[]) => {
    const nextIds = new Set(nextParticipants.map((participant) => participant.id));
    setParticipants(nextParticipants);
    setParticipantPreviewDraft([]);
    setRosterEditorDirty(false);
    setExcludedParticipantIds((ids) => ids.filter((id) => nextIds.has(id)));
    setPoolLimit((limit) => Math.min(limit, nextParticipants.length));
    clearCurrentRound();
    setToolsOpen(false);
    if (transitionRaffle('save-roster')) {
      restoreRosterFocus('configuring');
    }
    showToast(`${nextParticipants.length}명의 참여자 명단을 준비했어요.`);
  };

  const startBroadcast = () => {
    if (raffleStatus !== 'configuring') return;
    if (drawOptions.length === 0) {
      showToast(drawTarget === 'people' ? '먼저 참여자 명단을 준비해 주세요.' : '먼저 상품을 추가해 주세요.');
      return;
    }
    if (drawTarget === 'prizes' && prizeRecipients.length > 0 && !nextPrizeRecipient) {
      showToast('받을 사람 전원의 상품 배정이 끝났어요. 먼저 배정을 다시 시작해 주세요.');
      return;
    }
    if (drawTarget === 'prizes' && prizeRecipients.length > 0 && !prizeAssignmentBatchId) {
      setPrizeAssignmentBatchId(createId('prize-assignment'));
    }
    setToolsOpen(false);
    clearCurrentRound();
    if (transitionRaffle('open-stage')) {
      setBroadcastSession(createBroadcastSession(createId('session'), drawTarget));
    }
  };

  const finishBroadcast = () => {
    if (!transitionRaffle('end-broadcast')) return false;
    clearCurrentRound();
    setBroadcastSession(null);
    setRotorReady(false);
    setToolsOpen(false);
    return true;
  };

  const resetEverything = () => {
    if (isStageLocked) return;
    if (!window.confirm('명단, 상품, 당첨 제외, 당첨 기록과 추첨 설정을 모두 초기화할까요? 이 작업은 되돌릴 수 없어요.')) return;

    if (raffleStatusRef.current === 'ready' || raffleStatusRef.current === 'completed') {
      transitionRaffle('end-broadcast');
    }
    clearCurrentRound();
    setBroadcastSession(null);
    setRotorReady(false);
    setParticipants([]);
    setPrizes([]);
    setExcludedParticipantIds([]);
    setPoolLimit(0);
    setPoolIds([]);
    setDrawTarget('people');
    setWheelPresentation('spin');
    setDrawLabel('');
    setRewardLabel('');
    setPrizeRecipients([]);
    setPrizeRecipientText('');
    setPrizeRecipientSource('manual');
    setAssignedPrizeRecipientIds([]);
    setPrizeAssignmentResults([]);
    setPrizeAssignmentBatchId(null);
    setRemoveAfterDraw(true);
    setWeightModes({ people: false, prizes: false });
    setHistory([]);
    setSideTab('participants');
    setToolsOpen(false);
    showToast('모든 데이터를 초기화했어요. 새 추첨을 설계해 주세요.');
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
    showToast('당첨 제외를 초기화했어요. 이전 결과와 당첨 기록은 그대로예요.');
  };

  const recoverReadyDraw = () => {
    if (drawTarget === 'people') {
      if (participants.length === 0) {
        openParticipantEditor('ready', 'paste');
        return;
      }
      if (eligibleParticipants.length === 0 && excludedParticipantIds.length > 0) {
        resetWinnerState();
        return;
      }
    }
    finishBroadcast();
  };

  const continueCompletedRound = () => {
    if (drawTarget === 'prizes' && prizeRecipients.length > 0) {
      if (!nextPrizeRecipient) {
        const completedCount = prizeRecipients.length;
        if (finishBroadcast()) showToast(`${completedCount}명의 상품 배정을 마쳤어요.`);
        return;
      }
      if (drawOptions.length > 0) {
        beginNextRound();
        return;
      }
      if (finishBroadcast()) showToast(`${nextPrizeRecipient.name}님부터 이어서 배정할 수 있어요. 상품을 보충해 주세요.`);
      return;
    }

    if (drawOptions.length > 0) {
      beginNextRound();
      return;
    }

    if (drawTarget === 'people' && eligibleParticipants.length === 0 && excludedParticipantIds.length > 0) {
      if (!window.confirm(`당첨 제외 ${excludedParticipantIds.length}명을 다시 명단에 넣고 다음 회차를 시작할까요? 당첨 기록은 유지됩니다.`)) return;
      setExcludedParticipantIds([]);
      beginNextRound();
      showToast('당첨 제외를 초기화하고 다음 회차를 준비했어요.');
      return;
    }

    if (drawTarget === 'people' && participants.length === 0) {
      openParticipantEditor('completed', 'paste');
      return;
    }

    finishBroadcast();
  };

  const applyLinkedPrizeRecipients = (
    linkedRecipients: readonly PrizeRecipient[],
    preserveMatchingProgress: boolean,
  ) => {
    if (linkedRecipients.length === 0) {
      showToast('불러올 공개 당첨자가 없어요. 받을 사람을 직접 입력해 주세요.');
      return 0;
    }

    const retainedAssignedIds = preserveMatchingProgress
      ? retainAssignedPrizeRecipientIds(linkedRecipients, assignedPrizeRecipientIds)
      : [];
    const currentRecipientIds = new Set(prizeRecipients.map((recipient) => recipient.id));
    const sharesCurrentSlot = linkedRecipients.some((recipient) => currentRecipientIds.has(recipient.id));
    setPrizeRecipients([...linkedRecipients]);
    setPrizeRecipientText(linkedRecipients.map((item) => item.name).join('\n'));
    setPrizeRecipientSource('linked');
    setAssignedPrizeRecipientIds(retainedAssignedIds);
    setPrizeAssignmentResults((items) => (
      preserveMatchingProgress ? retainPrizeAssignmentResults(items, linkedRecipients) : []
    ));
    setPrizeAssignmentBatchId((currentBatchId) => (
      preserveMatchingProgress && sharesCurrentSlot && currentBatchId
        ? currentBatchId
        : createId('prize-assignment')
    ));
    prepareNextRoundSettings();
    return retainedAssignedIds.length;
  };

  const updatePrizeRecipientText = (value: string) => {
    if (!isConfigurationEditable) return;
    if (assignedPrizeRecipientCount > 0) {
      showToast('배정이 시작된 명단은 잠겨 있어요. 같은 명단으로 새 배정을 시작한 뒤 편집해 주세요.');
      return;
    }
    const manualRecipients = reconcileManualPrizeRecipients(
      value,
      prizeRecipients,
      createId,
      assignedPrizeRecipientIds,
    );
    const retainedIds = new Set(manualRecipients.map((recipient) => recipient.id));
    const sharesCurrentSlot = prizeRecipients.some((recipient) => retainedIds.has(recipient.id));
    setPrizeRecipientText(value);
    setPrizeRecipients(manualRecipients);
    setPrizeRecipientSource(
      arePrizeRecipientPlansEqual(manualRecipients, recentLinkedPrizeRecipients) ? 'linked' : 'manual',
    );
    setAssignedPrizeRecipientIds((ids) => ids.filter((id) => retainedIds.has(id)));
    setPrizeAssignmentResults((items) => retainPrizeAssignmentResults(items, manualRecipients));
    setPrizeAssignmentBatchId((currentBatchId) => {
      if (manualRecipients.length === 0) return null;
      return sharesCurrentSlot && currentBatchId ? currentBatchId : createId('prize-assignment');
    });
    prepareNextRoundSettings();
  };

  const loadRecentPeopleWinners = () => {
    if (!isConfigurationEditable) return;
    if (assignedPrizeRecipientCount > 0) {
      showToast('배정이 시작된 명단은 잠겨 있어요. 새 배정을 시작한 뒤 이전 당첨자를 불러와 주세요.');
      return;
    }
    if (recentLinkedPrizeRecipients.length === 0) {
      showToast('불러올 공개 당첨자가 없어요. 받을 사람을 직접 입력해 주세요.');
      return;
    }
    if (recentWinnersAlreadyLoaded) {
      showToast('이전 당첨자 명단이 이미 연결되어 있어요. 배정 진행도 그대로 유지됩니다.');
      return;
    }
    if (
      prizeRecipients.length > 0
      && !window.confirm(
        `현재 받을 사람 ${prizeRecipients.length}명을 이전 당첨자 ${recentLinkedPrizeRecipients.length}명으로 교체할까요? 전체 당첨 기록은 유지됩니다.`,
      )
    ) return;

    const retainedCount = applyLinkedPrizeRecipients(recentLinkedPrizeRecipients, true);
    showToast(retainedCount > 0
      ? `이전 당첨자 ${recentLinkedPrizeRecipients.length}명으로 교체했어요. 같은 당첨자 ${retainedCount}명의 배정은 유지했어요.`
      : `이전 당첨자 ${recentLinkedPrizeRecipients.length}명을 받을 사람으로 불러왔어요.`);
  };

  const restartPrizeRecipientAssignments = () => {
    if (!isConfigurationEditable || prizeRecipients.length === 0) return;
    if (
      assignedPrizeRecipientCount > 0
      && !window.confirm(
        `같은 ${prizeRecipients.length}명에게 상품을 새로 배정할까요? 이전 당첨 기록은 유지되고, 이 화면의 배정 진행만 0명부터 다시 시작합니다.`,
      )
    ) return;
    setAssignedPrizeRecipientIds([]);
    setPrizeAssignmentResults([]);
    setPrizeAssignmentBatchId(createId('prize-assignment'));
    showToast(`같은 ${prizeRecipients.length}명에게 새 상품 배정을 시작해요.`);
  };

  const handoffWinnersToPrizeDraw = () => {
    const revealedWinners = [...sessionResults];
    const linkedRecipients = createLinkedPrizeRecipients(revealedWinners);
    if (linkedRecipients.length === 0) {
      showToast('상품 추첨으로 넘길 공개 당첨자가 없어요.');
      return;
    }
    if (
      assignedPrizeRecipientCount > 0
      && !window.confirm(
        `기존 상품 배정 ${assignedPrizeRecipientCount}명을 이번 당첨자 ${linkedRecipients.length}명으로 교체할까요? 이전 당첨 기록은 유지됩니다.`,
      )
    ) return;
    if (!finishBroadcast()) return;

    applyLinkedPrizeRecipients(linkedRecipients, false);
    setDrawLabel('');
    setRewardLabel('');
    setDrawTarget('prizes');
    setSideTab('prizes');
    showToast(availablePrizeCount === 0
      ? `당첨자 ${linkedRecipients.length}명을 연결했어요. 상품을 추가해 주세요.`
      : `당첨자 ${linkedRecipients.length}명을 받을 사람으로 연결했어요.`);
  };

  const openPrizeSetup = () => {
    if (broadcastSession?.target === 'people' && sessionResults.length > 0) {
      handoffWinnersToPrizeDraw();
      return;
    }
    if (!finishBroadcast()) return;
    setDrawTarget('prizes');
    setSideTab('prizes');
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
    setPrizes((items) => [...items, { id: createId('prize'), name: '', quantity: 1, weight: 1 }]);
    prepareNextRoundSettings();
    window.requestAnimationFrame(() => {
      const inputs = document.querySelectorAll<HTMLInputElement>('.prize-editor__name input');
      inputs[inputs.length - 1]?.focus();
    });
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
    const csv = createHistoryCsv(history);
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

  const sessionResults = broadcastSession?.results ?? [];
  const roundTarget = currentRound?.target ?? drawTarget;
  const visibleSessionResults = roundTarget === 'prizes' && prizeRecipients.length > 0
    ? prizeAssignmentResults
    : sessionResults;
  const latestVisibleSessionResult = visibleSessionResults[visibleSessionResults.length - 1] ?? null;
  const roundMode = currentRound?.mode ?? drawMode;
  const roundWheelPresentation = currentRound?.wheelPresentation ?? wheelPresentation;
  const roundPoolLimit = currentRound?.poolLimit ?? poolLimit;
  const roundPresentationOptions = activePresentation?.options ?? drawOptions;
  const roundCandidateCount = roundPresentationOptions.length || currentRound?.candidateCount || 0;
  const roundTotalWeight = totalEffectiveWeight(roundPresentationOptions);
  const roundRemovesWinners = currentRound?.removeAfterDraw ?? removeAfterDraw;
  const roundUsesWeights = currentRound?.useWeights ?? useWeights;
  const roundRecipientId = currentRound?.recipientId ?? nextPrizeRecipient?.id;
  const roundRecipient = currentRound?.recipient ?? nextPrizeRecipient?.name;
  const roundRecipientPosition = roundRecipientId
    ? prizeRecipients.findIndex((item) => item.id === roundRecipientId) + 1
    : 0;
  const roundRewardLabel = currentRound?.rewardLabel ?? (rewardLabel.trim() || undefined);
  const roundUnit = roundTarget === 'people' ? '명' : '개';
  const roundCandidateUnit = roundTarget === 'people' ? '명' : '종';
  const resultUnit = roundTarget === 'prizes' && prizeRecipients.length > 0 ? '명' : roundUnit;
  const resultUnitSubjectParticle = resultUnit === '명' ? '이' : '가';
  const targetLabel = roundTarget === 'people' ? '사람' : '상품';
  const defaultStageTitle = roundTarget === 'people'
    ? '참여자 추첨'
    : roundRecipient
      ? `${roundRecipientPosition}/${prizeRecipients.length} · ${roundRecipient}의 상품 추첨`
      : '상품 추첨';
  const roundLabel = currentRound?.label ?? (drawLabel.trim() || undefined);
  const stageTitle = roundTarget === 'prizes' && roundRecipient
    ? [defaultStageTitle, roundLabel].filter(Boolean).join(' · ')
    : roundLabel
      ?? (roundTarget === 'people' && roundRewardLabel ? `${roundRewardLabel} 당첨자 추첨` : defaultStageTitle);
  const resultTitle = roundTarget === 'people'
    ? '전체 당첨자'
    : prizeRecipients.length > 0 ? '전체 상품 배정' : '뽑힌 상품';
  const dynamicFairnessLabel = roundTarget === 'prizes'
    ? `재고 수량 비율 · ${roundCandidateCount}종 · 남은 재고 ${availablePrizeCount}개`
    : roundUsesWeights
      ? `가중치 적용 · 총 ${roundTotalWeight} 추첨권 · ${roundMode === 'wheel' ? '조각 크기는 확률에 비례' : '결과 확률은 가중치에 비례'}`
      : '동일 확률 · 후보마다 한 번씩 표시';
  const fairnessLabel = dynamicFairnessLabel;
  const ruleSummary = [
    roundMode === 'wheel'
      ? roundWheelPresentation === 'dart' ? '룰렛 · 다트 복권' : '룰렛 · 자동 회전'
      : '마블',
    `한 번에 1${roundUnit}`,
    roundTarget === 'people' && roundRewardLabel ? `선물 ${roundRewardLabel}` : null,
    `후보 ${roundCandidateCount}${roundCandidateUnit}`,
    roundTarget === 'prizes' ? '남은 수량만큼 칸 넓이' : null,
    roundTarget === 'people' && roundPoolLimit > 0 ? '후보 풀 회차 고정' : null,
    roundTarget === 'people' && roundRemovesWinners ? '중복 당첨 방지' : null,
    roundUsesWeights ? '가중치 적용' : null,
  ].filter(Boolean).join(' · ');
  const resultRemovalMessage = roundTarget === 'people'
    ? roundRemovesWinners
      ? excludedParticipantIds.length > 0
        ? `중복 당첨 방지 · 현재 ${excludedParticipantIds.length}명이 다음 추첨 후보에서 제외되어 있습니다.`
        : '중복 당첨 방지 · 당첨 기록은 유지되며 현재는 제외 없이 전원 다시 추첨할 수 있습니다.'
      : '중복 당첨 허용: 이번 회차와 다음 추첨에도 같은 사람이 다시 뽑힐 수 있습니다.'
    : '상품은 재고 단위로 한 개씩 차감됩니다.';
  const isDartRound = roundMode === 'wheel' && roundWheelPresentation === 'dart';
  const statusMeta = RAFFLE_STATUS_META[raffleStatus];
  const upcomingDrawLabel = drawMode === 'wheel' && wheelPresentation === 'dart'
    ? '다트 발사'
    : drawMode === 'wheel'
      ? '룰렛 멈추기'
      : '레이스 시작';
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
      : '상품 목록을 확인해 주세요';
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
      : '설정 바꾸기에서 상품 이름과 수량을 확인해 주세요.';
  const drawButtonLabel = raffleStatus === 'locking'
    ? '결과 고정 중…'
    : raffleStatus === 'presenting'
      ? '결과 공개 중…'
    : noAvailableDrawOptions
      ? unavailableDrawLabel
      : upcomingDrawLabel;
  const isStageOnly =
    raffleStatus === 'locking' || presentationBeat === 'motion';
  const showWinnerHeroPanel = presentationBeat === 'hero' && winnerHero !== null;
  const showResultsPanel = !isStageOnly && !showWinnerHeroPanel && (
    visibleSessionResults.length > 0 ||
    raffleStatus === 'completed' ||
    presentationBeat === 'dock'
  );
  const broadcastVisualClassName = [
    'broadcast-focus__visual',
    `reveal-phase--${cinematicRevealPhase}`,
    isDartRound && spinning ? 'is-dart-flying' : '',
    roundMode === 'wheel' && roundWheelPresentation === 'spin' && spinning ? 'is-auto-spinning' : '',
    presentationBeat === 'hero' ? 'is-winner-hero' : '',
    presentationBeat === 'dock' ? 'is-result-docking' : '',
    raffleStatus === 'completed' ? 'is-round-complete' : '',
  ].filter(Boolean).join(' ');
  const cinematicImpactPoint = resolveDartImpactPoint(
    roundWheelPresentation === 'dart' ? activePresentation?.dartShot : undefined,
  );
  const cinematicCameraStyle: CinematicCameraStyle = {
    '--cinematic-impact-x': `${cinematicImpactPoint.xPercent}%`,
    '--cinematic-impact-y': `${cinematicImpactPoint.yPercent}%`,
    '--cinematic-final-x': `${cinematicImpactPoint.finalXPercent}%`,
    '--cinematic-final-y': `${cinematicImpactPoint.finalYPercent}%`,
  };
  const broadcastFocusClassName = [
    'broadcast-focus',
    `reveal-phase--${cinematicRevealPhase}`,
    isStageOnly ? 'is-stage-only' : '',
    showResultsPanel || showWinnerHeroPanel ? 'has-results-panel' : 'has-no-results-panel',
    showWinnerHeroPanel ? 'has-hero-panel' : '',
    presentationBeat === 'hero' ? 'is-winner-hero' : '',
    presentationBeat === 'dock' ? 'is-result-docking' : '',
    raffleStatus === 'completed' ? 'is-completed' : '',
  ].filter(Boolean).join(' ');
  const actionNote = raffleStatus === 'completed'
    ? roundTarget === 'prizes' && prizeRecipients.length > 0
      ? nextPrizeRecipient
        ? `${assignedPrizeRecipientCount}/${prizeRecipients.length}명 배정 완료 · 다음은 ${nextPrizeRecipient.name}입니다.`
        : `${prizeRecipients.length}명 전원의 상품 배정이 완료되었습니다.`
      : '방금 결과가 저장되었습니다. 계속 뽑거나 이번 추첨을 끝내세요.'
    : !rotorReady && raffleStatus === 'ready' && !noAvailableDrawOptions
      ? '원판이 추첨 속도까지 올라가는 중입니다.'
    : noAvailableDrawOptions
        ? unavailableDrawPrompt
        : drawMode === 'wheel' && wheelPresentation === 'dart'
          ? `발사 순간 후보 ${drawOptions.length}${drawTarget === 'people' ? '명' : '종'} 중 한 결과가 고정됩니다.`
          : drawMode === 'wheel'
            ? '멈추기를 누르는 순간 한 결과가 고정되고 원판이 감속합니다.'
            : '시작을 누르는 순간 한 결과가 고정됩니다.';
  const readyRecoveryLabel = drawTarget === 'people'
    ? participants.length === 0
      ? '명단 준비하기'
      : eligibleParticipants.length === 0 && excludedParticipantIds.length > 0
        ? '당첨 제외 초기화'
        : useWeights ? '가중치 조정하기' : '추첨 설정 확인하기'
    : availablePrizeCount === 0 ? '상품 추가하기' : '상품 확인하기';
  const readyPrimaryAction: BroadcastDockAction = {
    id: noAvailableDrawOptions ? 'recover-ready' : 'start-draw',
    label: noAvailableDrawOptions
      ? readyRecoveryLabel
      : rotorReady ? drawButtonLabel : '원판 가속 중…',
    onClick: noAvailableDrawOptions ? recoverReadyDraw : startDraw,
    disabled: toolsOpen || (!noAvailableDrawOptions && !rotorReady),
  };
  const completedPrimaryLabel = roundTarget === 'prizes' && prizeRecipients.length > 0 && !nextPrizeRecipient
    ? '상품 배정 마치기'
    : noAvailableDrawOptions
      ? drawTarget === 'people'
        ? eligibleParticipants.length === 0 && excludedParticipantIds.length > 0
          ? '당첨 제외 초기화 후 다음 추첨'
          : participants.length === 0 ? '명단 준비하고 다음 추첨' : '규칙 조정하고 다음 추첨'
        : '상품 보충하고 다음 추첨'
      : roundTarget === 'people'
        ? '한 명 더 뽑기'
        : prizeRecipients.length > 0 && nextPrizeRecipient
          ? `다음: ${nextPrizeRecipient.name}의 상품 추첨`
          : '하나 더 뽑기';
  const stagePrompt = raffleStatus === 'locking'
    ? '방금 누른 버튼의 후보와 결과를 고정했습니다. 곧 방송 연출을 시작합니다.'
    : raffleStatus === 'presenting'
      ? isDartRound
        ? '발사 순간 고정된 결과를 공개하고 있습니다.'
        : '멈추기를 누른 순간 고정된 결과를 공개하고 있습니다.'
        : raffleStatus === 'completed'
          ? '오른쪽 보드에 이번 방송의 전체 당첨자가 남아 있습니다.'
          : noAvailableDrawOptions
            ? unavailableDrawPrompt
            : roundMode === 'wheel' && !rotorReady
              ? '원판이 추첨 속도까지 올라가고 있습니다.'
            : roundTarget === 'prizes' && roundRecipient
              ? `${roundRecipient}님에게 드릴 상품을 뽑아 주세요.`
              : roundMode === 'wheel'
                ? roundWheelPresentation === 'dart'
                  ? '움직이는 조준점과 원판 위치가 클릭 순간 함께 고정되고 다트가 바로 날아갑니다.'
                  : '원판은 이미 고속 회전 중입니다. 결과 고정 버튼을 누르면 그 순간 결과가 정해지고 원판이 감속합니다.'
                : '레이스 시작을 누르는 순간 후보와 결과가 고정되고, 그 다음에 방송 연출이 시작됩니다.';

  const renderDrawVisual = (variant: 'preview' | 'live') => {
    const preview = variant === 'preview';
    const names = preview ? drawOptionNames : displayNames;
    const mode = preview ? drawMode : roundMode;
    const target = preview ? drawTarget : roundTarget;
    const activeWinnerIndex = preview ? null : winnerIndex;
    const activeSpin = preview ? false : spinning;
    const presentation = preview ? wheelPresentation : roundWheelPresentation;
    const sliceWeights = preview ? drawOptionWeights : displayWeights;

    return mode === 'wheel' ? (
      <RouletteWheel
        ref={preview ? undefined : liveWheelRef}
        participants={names}
        weights={sliceWeights}
        itemType={target === 'prizes' ? 'prize' : 'participant'}
        winnerIndex={activeWinnerIndex}
        spinning={activeSpin}
        idleSpinning={!preview && (
          raffleStatus === 'ready' ||
          raffleStatus === 'locking' ||
          (raffleStatus === 'presenting' && presentationBeat === 'idle')
        )}
        spinKey={spinKey}
        presentation={presentation}
        revealId={preview ? undefined : activePresentation?.revealId}
        landing={preview ? undefined : activePresentation?.landing}
        spinCommit={preview ? undefined : activePresentation?.spinCommit}
        dartShot={preview ? undefined : activePresentation?.dartShot}
        dartAim={preview ? undefined : dartAimSession ?? undefined}
        dartCommit={preview ? undefined : activePresentation?.dartCommit}
        onRevealPhase={preview ? undefined : handleRouletteRevealPhase}
        onIdleCruise={preview ? undefined : () => setRotorReady(true)}
        onSpinEnd={preview ? () => undefined : completeDraw}
      />
    ) : (
      <MarbleRace
        participants={names}
        itemType={target === 'prizes' ? 'prize' : 'participant'}
        winnerIndex={activeWinnerIndex}
        racing={activeSpin}
        raceKey={spinKey}
        onRaceEnd={preview ? () => undefined : () => {
          if (activePresentation) {
            completeDraw({ spinKey, revealId: activePresentation.revealId });
          }
        }}
      />
    );
  };

  const renderRoundSettings = () => (
    <RoundSetupPanel
      target={drawTarget}
      wheelPresentation={wheelPresentation}
      participantTotal={participants.length}
      eligibleParticipants={eligibleParticipants}
      candidateParticipants={candidateParticipants}
      drawOptionCount={drawOptions.length}
      excludedCount={participants.length - eligibleParticipants.length}
      poolLimit={poolLimit}
      prizes={prizes}
      rewardLabel={rewardLabel}
      drawLabel={drawLabel}
      prizeRecipientText={prizeRecipientText}
      prizeRecipientCount={prizeRecipients.length}
      assignedPrizeRecipientCount={assignedPrizeRecipientCount}
      prizeRecipientSource={prizeRecipientSource}
      recentWinnerCount={recentPeopleWinnerResults.length}
      recentWinnersAlreadyLoaded={recentWinnersAlreadyLoaded}
      recentWinnerLabel={recentPeopleWinnerResults[0]?.roundLabel || '최근 당첨자 추첨'}
      removeAfterDraw={removeAfterDraw}
      useWeights={useWeights}
      disabled={!isConfigurationEditable}
      onTargetChange={changeTarget}
      onRewardLabelChange={(value) => {
        setRewardLabel(value);
        prepareNextRoundSettings();
      }}
      onDrawLabelChange={(value) => {
        setDrawLabel(value);
        prepareNextRoundSettings();
      }}
      onPrizeRecipientTextChange={updatePrizeRecipientText}
      onLoadRecentWinners={loadRecentPeopleWinners}
      onRestartPrizeRecipients={restartPrizeRecipientAssignments}
      onPoolLimitChange={(value) => {
        setPoolLimit(Math.max(0, Math.min(eligibleParticipants.length, value)));
        setPoolIds([]);
        prepareNextRoundSettings();
      }}
      onReshufflePool={reshufflePool}
      onPresentationChange={(choice) => {
        if (!isConfigurationEditable) return;
        changeWheelPresentation(choice);
      }}
      onRemoveAfterDrawChange={(value) => {
        setRemoveAfterDraw(value);
        prepareNextRoundSettings();
      }}
      onUseWeightsChange={(value) => {
        setUseWeights(value);
        prepareNextRoundSettings();
      }}
      onParticipantWeightChange={updateParticipantWeight}
      onEditRoster={() => openParticipantEditor('configuring', participants.length === 0 ? 'paste' : 'edit')}
      onRestoreExcluded={resetWinnerState}
      onAddPrize={addPrize}
      onUpdatePrize={updatePrize}
      onPrizeWeightChange={updatePrizeWeight}
      onRemovePrize={removePrize}
    />
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
              const excluded = excludedParticipantIdSet.has(participant.id);
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
          {broadcastSession?.target === 'people' && sessionResults.length > 0 && (
            <section className="winner-prize-choices" aria-labelledby="winner-prize-choices-title">
              <h3 id="winner-prize-choices-title">당첨자에게 상품 뽑기</h3>
              <p>공개된 순서대로 한 명씩 상품을 배정합니다.</p>
              <div>
                <button type="button" disabled={isStageLocked} onClick={handoffWinnersToPrizeDraw}>
                  당첨자 {sessionResults.length}명 모두 연결
                </button>
              </div>
            </section>
          )}
          <div className="live-panel__heading">
            <div>
              <h2 id="prize-panel-title">상품 수량</h2>
              <p>남은 상품 {availablePrizeCount}개</p>
            </div>
            <button className="compact-button" type="button" disabled={isStageLocked} onClick={openPrizeSetup}>상품 설정</button>
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
              <button className="compact-button compact-button--danger" type="button" disabled={isStageLocked} onClick={clearHistory}>기록 비우기</button>
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
                    {item.revealedAt
                      ? ` · 공개 ${formatTime(item.revealedAt, true)}`
                      : ' · 공개 전 확정 복구'}
                    {' · '}{item.target === 'people' ? '사람' : '상품'}
                  </small>
                  {(item.roundLabel || item.rewardLabel) && (
                    <p className="live-history-list__round">
                      {[item.roundLabel, item.rewardLabel ? `선물 ${item.rewardLabel}` : undefined].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  <strong>{item.winner}</strong>
                  <span>
                    {item.target === 'prizes' && item.recipient
                      ? `${item.recipient}님에게 전달`
                      : item.mode === 'wheel'
                        ? item.presentation === 'dart' ? '다트 복권' : '자동 룰렛'
                        : '마블'}
                    {item.candidateCount
                      ? ` · 후보 ${item.candidateCount}${item.target === 'people'
                        ? '명'
                        : item.prizeProbabilityModel === 'quantity-ratio' ? '종' : '개'}`
                      : ''}
                    {item.candidateTotalWeight
                      ? item.target === 'prizes' && item.prizeProbabilityModel === 'quantity-ratio'
                        ? ` · 재고 비율 합계 ${item.candidateTotalWeight}`
                        : ` · 총 ${item.candidateTotalWeight}추첨권`
                      : ''}
                    {item.candidateFingerprint ? ` · 검증 ${item.candidateFingerprint}` : ''}
                    {item.target === 'prizes'
                      ? item.prizeProbabilityModel === 'quantity-ratio'
                        ? ' · 수량 비율'
                        : typeof item.useWeights === 'boolean'
                          ? item.useWeights ? ' · 가중치 적용' : ' · 동일 확률'
                          : ''
                      : typeof item.useWeights === 'boolean'
                        ? item.useWeights ? ' · 가중치 적용' : ' · 동일 확률'
                        : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      <footer className="broadcast-tools-drawer__reset">
        <button
          className="panel-wide-button panel-wide-button--soft compact-button--danger"
          type="button"
          disabled={isStageLocked}
          onClick={resetEverything}
        >명단·상품·기록 모두 초기화</button>
      </footer>
    </aside>
  );

  if (raffleStatus === 'configuring' || raffleStatus === 'roster') {
    const editorOpen = raffleStatus === 'roster';
    const preparation = derivePreparationReadiness({
      target: drawTarget,
      participantTotal: participants.length,
      eligibleParticipantCount: eligibleParticipants.length,
      candidateParticipantCount: candidateParticipants.length,
      excludedParticipantCount: excludedParticipantIds.length,
      poolLimit,
      prizeInventoryCount: availablePrizeCount,
      prizeRecipientCount: prizeRecipients.length,
      assignedPrizeRecipientCount,
      drawOptionCount: drawOptions.length,
      useWeights,
    });
    const preparationReady = preparation.state === 'ready';
    const preparationUnit = drawTarget === 'people' ? '명' : '종';
    const presentationLabel = wheelPresentation === 'dart' ? '다트 복권' : '회전 룰렛';
    const ruleLabel = drawTarget === 'prizes' ? '수량 비율' : useWeights ? '확률 지정' : '동일 확률';
    const duplicateLabel = drawTarget === 'people'
      ? removeAfterDraw ? '당첨 후 제외' : '중복 허용'
      : '재고 차감';
    const previewNames = editorOpen && drawTarget === 'people'
      ? participantPreviewDraft.map((participant) => participant.name).filter(Boolean)
      : drawOptionNames;
    const previewWeights = editorOpen && drawTarget === 'people'
      ? useWeights ? participantPreviewDraft.map((participant) => participant.weight) : undefined
      : drawOptionWeights;
    const runPreparationAction = () => {
      if (preparation.state === 'ready') {
        startBroadcast();
        return;
      }
      switch (preparation.recovery) {
        case 'open-roster':
          openParticipantEditor('configuring', participants.length === 0 ? 'paste' : 'edit');
          break;
        case 'restore-excluded':
          resetWinnerState();
          break;
        case 'use-whole-roster':
          setPoolLimit(0);
          setPoolIds([]);
          break;
        case 'use-equal-probability':
          setUseWeights(false);
          break;
        case 'add-prize':
          addPrize();
          break;
        case 'restart-prize-recipients':
          restartPrizeRecipientAssignments();
          break;
      }
    };

    return (
      <main className="app-shell app-shell--preparation">
        <header className="brand-header">
          <div className="brand brand--static" aria-label="Retto Roulette">
            <span className="brand__mark" aria-hidden="true">🍸 💝</span>
            <strong>Retto Roulette</strong>
          </div>
          <nav className="preparation-phase" aria-label="추첨 진행">
            <strong aria-current="step">준비</strong>
            <span>방송</span>
            <span>결과</span>
          </nav>
        </header>

        <section className="preparation-workspace" aria-label="새 추첨 준비" inert={editorOpen} aria-hidden={editorOpen || undefined}>
          <section className="preparation-rail" aria-labelledby="preparation-title">
            <header className="preparation-rail__heading">
              <div>
                <p>새 추첨</p>
                <h1 id="preparation-title">{drawTarget === 'people' ? '당첨자 추첨' : '상품 추첨'}</h1>
              </div>
            </header>
            <div className="preparation-rail__controls">
              {renderRoundSettings()}
            </div>
          </section>

          <section className="preparation-preview" aria-labelledby="preparation-preview-title">
            <header className="preparation-preview__heading">
              <div>
                <p>방송 캔버스</p>
                <h2 id="preparation-preview-title">{presentationLabel} 미리보기</h2>
              </div>
              <span>{previewNames.length > 0 ? `${previewNames.length}${preparationUnit}` : '샘플'}</span>
            </header>

            <div className="preparation-preview__stage">
              <DrawPreviewDirector
                names={previewNames}
                weights={previewWeights}
                target={drawTarget}
                mode={drawMode}
                presentation={wheelPresentation}
                title={stageTitle}
              />
            </div>

            <footer className="preparation-preview__footer">
              <div className="preparation-preview__summary">
                <strong>
                  {preparationReady
                    ? drawTarget === 'people'
                      ? `${drawOptions.length}명 · 한 번에 1명`
                      : `${drawOptions.length}종 · 재고 ${availablePrizeCount}개 · 한 번에 1개`
                    : drawTarget === 'people' && participants.length === 0
                      ? '명단 없음'
                      : drawTarget === 'prizes' && availablePrizeCount === 0
                        ? '상품 없음'
                        : '설정 확인 필요'}
                </strong>
                <span>{presentationLabel} · {ruleLabel} · {duplicateLabel}</span>
              </div>
              <div className={`preparation-preview__status${preparationReady ? ' is-ready' : ' is-blocked'}`} role="status">
                <span aria-hidden="true" />
                <strong>{preparation.statusLabel}</strong>
              </div>
              <button
                className="preparation-preview__primary"
                type="button"
                onClick={runPreparationAction}
              >
                {preparationReady ? '방송 화면 열기' : preparation.ctaLabel}
              </button>
            </footer>
          </section>
        </section>

        {editorOpen && (
          <div className="roster-drawer" role="dialog" aria-modal="true" aria-label="명단 편집">
            <button className="roster-drawer__scrim" type="button" aria-label="명단 편집 닫기" onClick={cancelParticipantEditor} />
            <ParticipantSetup
              key={setupSession}
              initialParticipants={participants}
              initialStep={setupStartStep}
              onClear={participants.length > 0 ? clearParticipantRoster : undefined}
              onCancel={cancelParticipantEditor}
              onDraftChange={setParticipantPreviewDraft}
              onDirtyChange={setRosterEditorDirty}
              onStart={saveParticipants}
            />
          </div>
        )}

        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    );
  }

  return (
    <main className="app-shell app-shell--live">
      <header className="brand-header broadcast-header" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
        <div className="brand brand--static" aria-label="Retto Roulette">
          <span className="brand__mark" aria-hidden="true">🍸 💝</span>
          <strong>Retto Roulette</strong>
        </div>
        <div className="broadcast-header__actions">
          {isPresentationLocked ? (
            <span className="broadcast-tools-lock" role="status">연출 중 · 도구 잠김</span>
          ) : (
            <button
              ref={toolsTriggerRef}
              className="compact-button"
              type="button"
              aria-expanded={toolsOpen}
              aria-controls="broadcast-tools-drawer"
              onClick={() => {
                if (toolsOpen) closeTools(true);
                else setToolsOpen(true);
              }}
            >명단 · 기록</button>
          )}
        </div>
      </header>

      <div className="broadcast-phase-bar" inert={toolsOpen} aria-hidden={toolsOpen || undefined}>
        <div className="broadcast-phase-bar__status">
          <span>{statusMeta.liveLabel}</span>
          <strong id="stage-title">{stageTitle}</strong>
        </div>
        <p>{ruleSummary}</p>
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
        <BroadcastCandidateRoster
          items={displayNames}
          title={roundTarget === 'people' ? '참여자 명단' : '추첨 상품'}
          unit={roundCandidateUnit}
        />

        <section className="broadcast-focus__stage" aria-labelledby="stage-title">
          <p className="broadcast-focus__fairness">{fairnessLabel}</p>

          <div className={broadcastVisualClassName}>
            <div className="broadcast-focus__camera" style={cinematicCameraStyle}>
              {renderDrawVisual('live')}
            </div>
          </div>

          <p className="broadcast-focus__prompt">{stagePrompt}</p>
        </section>

        {showWinnerHeroPanel && winnerHero && (
          <aside className="broadcast-focus__hero" aria-label="이번 당첨 결과">
            <WinnerHero
              key={winnerHero.revealId}
              className="broadcast-focus__hero-card"
              winnerName={winnerHero.result.winner}
              targetLabel={winnerHero.result.target === 'people' ? '당첨자' : '당첨 상품'}
              recipient={winnerHero.result.recipient}
              product={winnerHero.result.target === 'people' ? winnerHero.result.rewardLabel : undefined}
            />
          </aside>
        )}

        {showResultsPanel && (
          <aside className={`broadcast-focus__results${visibleSessionResults.length === 0 ? ' is-empty' : ''}`} aria-label="이 방송의 전체 추첨 결과">
            <CurrentRoundWinners
              winners={visibleSessionResults.map((result) => ({
                id: result.id,
                name: result.target === 'prizes' && result.recipient ? result.recipient : result.winner,
                detail: result.target === 'prizes'
                  ? result.recipient ? `${result.winner} 배정` : undefined
                  : result.rewardLabel ? `${result.rewardLabel} 당첨` : undefined,
              }))}
              pendingCount={0}
              unit={resultUnit}
              latestWinnerId={latestVisibleSessionResult?.id}
              title={resultTitle}
              announcement={visibleSessionResults.length > 0
                ? raffleStatus === 'presenting'
                  ? `${resultTitle} 누적 ${visibleSessionResults.length}${resultUnit}${resultUnitSubjectParticle} 확정되었습니다.`
                  : `${resultTitle} 누적 ${visibleSessionResults.length}${resultUnit}${resultUnitSubjectParticle} 발표되었습니다.`
                : undefined}
              removalMessage={visibleSessionResults.length > 0 ? resultRemovalMessage : undefined}
            />
            {raffleStatus === 'completed' && broadcastSession?.target === 'people' && sessionResults.length > 0 && (
              <button className="broadcast-focus__prize-link" type="button" disabled={isStageLocked} onClick={handoffWinnersToPrizeDraw}>
                당첨자 {sessionResults.length}명에게 상품 뽑기
              </button>
            )}
          </aside>
        )}

        {(raffleStatus === 'ready' || raffleStatus === 'completed') && (
          <div className="broadcast-focus__action">
            {raffleStatus === 'ready' && (
              <BroadcastActionDock
                phase="ready"
                note={actionNote}
                primaryAction={readyPrimaryAction}
                secondaryActions={[
                  {
                    id: 'finish-stage',
                    label: '추첨 종료 · 새로 설계',
                    onClick: finishBroadcast,
                    tone: 'quiet',
                    title: '현재 방송 화면을 닫고 설계 화면으로 돌아갑니다. 명단과 기록은 유지됩니다.',
                  },
                ]}
              />
            )}
            {raffleStatus === 'completed' && (
              <BroadcastActionDock
                phase="completed"
                note={actionNote}
                primaryAction={{ id: 'next-round', label: completedPrimaryLabel, onClick: continueCompletedRound }}
                secondaryActions={roundTarget === 'prizes' && prizeRecipients.length > 0 && !nextPrizeRecipient
                  ? []
                  : [
                    {
                      id: 'finish-draw',
                      label: '이번 추첨 끝내기 · 설계로',
                      onClick: finishBroadcast,
                      tone: 'quiet',
                      title: '전체 당첨 기록은 유지하고 새 추첨 설계로 돌아갑니다.',
                    },
                  ]}
              />
            )}
          </div>
        )}
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

export default App;
