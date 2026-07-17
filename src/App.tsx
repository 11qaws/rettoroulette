import { useCallback, useEffect, useMemo, useState } from 'react';

import MarbleRace from './components/MarbleRace';
import ParticipantSetup from './components/ParticipantSetup';
import RouletteWheel from './components/RouletteWheel';
import { pickWeightedIndex, sampleWithoutReplacement } from './lib/draw';
import type { DrawMode, DrawRecord, DrawTarget, Participant, Prize } from './types';

import './App.css';

type DrawOption = {
  id: string;
  name: string;
  weight: number;
};

type SideTab = 'participants' | 'prizes' | 'history';
type SetupStartStep = 'paste' | 'edit';

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function clampInteger(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.floor(value) || min));
}

function prizeTotal(prizes: Prize[]) {
  return prizes.reduce((sum, prize) => sum + Math.max(0, prize.quantity), 0);
}

function App() {
  const [drawMode, setDrawMode] = useState<DrawMode>('wheel');
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
  const [pendingDraws, setPendingDraws] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [presentedOptions, setPresentedOptions] = useState<DrawOption[]>([]);
  const [drawTargetSnapshot, setDrawTargetSnapshot] = useState<DrawTarget>('people');
  const [latestResult, setLatestResult] = useState<DrawRecord | null>(null);
  const [history, setHistory] = useState<DrawRecord[]>([]);
  const [sideTab, setSideTab] = useState<SideTab>('participants');
  const [setupOpen, setSetupOpen] = useState(true);
  const [setupSession, setSetupSession] = useState(0);
  const [setupStartStep, setSetupStartStep] = useState<SetupStartStep>('paste');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

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
    if (!setupOpen) window.scrollTo(0, 0);
  }, [setupOpen]);

  const eligibleParticipants = useMemo(
    () => participants.filter((participant) => !excludedParticipantIds.includes(participant.id)),
    [excludedParticipantIds, participants],
  );

  useEffect(() => {
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
  }, [eligibleParticipants, poolIds, poolLimit]);

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
          .filter((prize) => prize.quantity > 0)
          .map((prize) => ({
            id: prize.id,
            name: prize.name,
            weight: useWeights ? prize.weight : 1,
          }));

    return useWeights ? options.filter((option) => option.weight > 0) : options;
  }, [candidateParticipants, drawTarget, prizes, useWeights]);

  const displayOptions = spinning || winnerIndex !== null ? presentedOptions : drawOptions;
  const displayNames = displayOptions.map((option) => option.name);
  const availablePrizeCount = prizeTotal(prizes);

  useEffect(() => {
    if (pendingDraws === 0 || spinning) return;
    if (drawOptions.length === 0) {
      setPendingDraws(0);
      showToast(drawTarget === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }

    const snapshot = drawOptions;
    setPresentedOptions(snapshot);
    setDrawTargetSnapshot(drawTarget);
    setWinnerIndex(pickWeightedIndex(snapshot));
    setSpinning(true);
    setSpinKey((value) => value + 1);
    setPendingDraws((value) => Math.max(0, value - 1));
  }, [drawOptions, drawTarget, pendingDraws, showToast, spinning]);

  const clearStageResult = () => {
    setWinnerIndex(null);
    setPresentedOptions([]);
    setLatestResult(null);
  };

  const changeTarget = (target: DrawTarget) => {
    if (spinning) return;
    setDrawTarget(target);
    clearStageResult();
  };

  const completeDraw = () => {
    if (winnerIndex === null) {
      setSpinning(false);
      return;
    }

    const chosen = presentedOptions[winnerIndex];
    if (!chosen) {
      setSpinning(false);
      return;
    }

    const result: DrawRecord = {
      id: createId('result'),
      createdAt: new Date().toISOString(),
      mode: drawMode,
      target: drawTargetSnapshot,
      winner: chosen.name,
      recipient: drawTargetSnapshot === 'prizes' ? recipient.trim() || undefined : undefined,
    };

    setHistory((items) => [result, ...items].slice(0, 100));
    setLatestResult(result);

    if (drawTargetSnapshot === 'people' && removeAfterDraw) {
      setExcludedParticipantIds((ids) => (ids.includes(chosen.id) ? ids : [...ids, chosen.id]));
    }

    if (drawTargetSnapshot === 'prizes') {
      setPrizes((items) => items.map((prize) => (
        prize.id === chosen.id
          ? { ...prize, quantity: Math.max(0, prize.quantity - 1) }
          : prize
      )));
      setSideTab('history');
    }

    setSpinning(false);
  };

  const startDraw = () => {
    if (spinning || pendingDraws > 0) return;
    const possibleCount = Math.min(winnerCount, drawOptions.length);
    if (possibleCount < 1) {
      showToast(drawTarget === 'people' ? '추첨할 참여자가 없어요.' : '추첨할 상품이 없어요.');
      return;
    }
    clearStageResult();
    setPendingDraws(possibleCount);
  };

  const reshufflePool = () => {
    if (poolLimit === 0) return;
    const count = Math.min(poolLimit, eligibleParticipants.length);
    setPoolIds(sampleWithoutReplacement(eligibleParticipants, count).map((participant) => participant.id));
    clearStageResult();
    showToast(`후보 ${count}명을 새로 골랐어요.`);
  };

  const openParticipantEditor = () => {
    setSetupStartStep('edit');
    setSetupSession((value) => value + 1);
    setSetupOpen(true);
  };

  const saveParticipants = (nextParticipants: Participant[]) => {
    const nextIds = new Set(nextParticipants.map((participant) => participant.id));
    setParticipants(nextParticipants);
    setExcludedParticipantIds((ids) => ids.filter((id) => nextIds.has(id)));
    setPoolIds([]);
    setSetupOpen(false);
    clearStageResult();
    showToast(`${nextParticipants.length}명의 참여자 명단을 준비했어요.`);
  };

  const restoreParticipant = (id: string, name: string) => {
    setExcludedParticipantIds((ids) => ids.filter((excludedId) => excludedId !== id));
    showToast(`${name}님을 다시 추첨 명단에 넣었어요.`);
  };

  const resetWinnerState = () => {
    if (excludedParticipantIds.length === 0) {
      showToast('초기화할 당첨 제외 인원이 없어요.');
      return;
    }
    if (!window.confirm(`당첨 제외 ${excludedParticipantIds.length}명을 다시 명단에 넣을까요? 당첨 기록은 유지됩니다.`)) return;
    setExcludedParticipantIds([]);
    setPoolIds([]);
    clearStageResult();
    showToast('당첨 제외 상태를 초기화했어요. 기록은 그대로예요.');
  };

  const startPrizeForLatestWinner = () => {
    if (!latestResult || latestResult.target !== 'people') return;
    if (availablePrizeCount === 0) {
      setSideTab('prizes');
      showToast('먼저 상품을 추가해 주세요.');
      return;
    }
    setRecipient(latestResult.winner);
    setWinnerCount(1);
    setDrawTarget('prizes');
    setSideTab('prizes');
    clearStageResult();
    showToast(`${latestResult.winner}님에게 드릴 상품을 뽑아 주세요.`);
  };

  const updateParticipantWeight = (id: string, weight: number) => {
    setParticipants((items) => items.map((participant) => (
      participant.id === id
        ? { ...participant, weight: Math.max(0, Math.min(99, Math.floor(weight) || 0)) }
        : participant
    )));
  };

  const updatePrize = (id: string, patch: Partial<Prize>) => {
    setPrizes((items) => items.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)));
  };

  const addPrize = () => {
    setPrizes((items) => [...items, { id: createId('prize'), name: '새 선물', quantity: 1, weight: 1 }]);
  };

  const removePrize = (id: string, name: string) => {
    if (!window.confirm(`${name} 상품을 목록에서 지울까요?`)) return;
    setPrizes((items) => items.filter((prize) => prize.id !== id));
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
    const header = ['시간', '모드', '추첨 대상', '결과', '수령자'];
    const rows = history.map((item) => [
      new Date(item.createdAt).toLocaleString('ko-KR'),
      item.mode === 'wheel' ? '룰렛' : '마블',
      item.target === 'people' ? '사람' : '상품',
      item.winner,
      item.recipient ?? '',
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(','))
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

  const stageResult = latestResult && latestResult.target === drawTarget ? latestResult : null;
  const drawButtonLabel = spinning || pendingDraws > 0
    ? '추첨 진행 중…'
    : drawTarget === 'people'
      ? `${winnerCount}명 추첨하기`
      : `${winnerCount}개 상품 뽑기`;

  if (setupOpen) {
    return (
      <main className="app-shell app-shell--setup">
        <header className="brand-header">
          <a className="brand" href="./" aria-label="Retto Roulette 홈">
            <span className="brand__mark" aria-hidden="true">🍸 💝</span>
            <strong>Retto Roulette</strong>
          </a>
          <span className="header-pill">v0.2.0</span>
        </header>
        <ParticipantSetup
          key={setupSession}
          initialParticipants={participants}
          initialStep={setupStartStep}
          onCancel={participants.length > 0 ? () => setSetupOpen(false) : undefined}
          onStart={saveParticipants}
        />
        {toast && <div className="toast" role="status">{toast}</div>}
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="brand-header">
        <a className="brand" href="./" aria-label="Retto Roulette 홈">
          <span className="brand__mark" aria-hidden="true">🍸 💝</span>
          <strong>Retto Roulette</strong>
        </a>
        <div className="header-actions">
          <span className="header-pill">남은 참여자 {eligibleParticipants.length}명</span>
          <button className="compact-button" type="button" onClick={openParticipantEditor}>명단 조정</button>
          <button className="ghost-button" type="button" onClick={resetWinnerState}>당첨 상태 초기화</button>
        </div>
      </header>

      <section className="round-bar" aria-label="이번 추첨 설정">
        <div className="round-toggle" aria-label="추첨 대상">
          <button type="button" aria-pressed={drawTarget === 'people'} disabled={spinning} onClick={() => changeTarget('people')}>사람 추첨</button>
          <button type="button" aria-pressed={drawTarget === 'prizes'} disabled={spinning} onClick={() => changeTarget('prizes')}>상품 추첨</button>
        </div>

        <label className="round-number">
          <span>이번 당첨</span>
          <input
            type="number"
            min="1"
            max={Math.max(1, drawOptions.length)}
            value={winnerCount}
            disabled={spinning}
            onChange={(event) => setWinnerCount(clampInteger(Number(event.target.value), 1, Math.max(1, drawOptions.length)))}
          />
          <em>{drawTarget === 'people' ? '명' : '개'}</em>
        </label>

        {drawTarget === 'people' ? (
          <label className="round-number">
            <span>이번 후보</span>
            <input
              type="number"
              min="0"
              max={eligibleParticipants.length}
              value={poolLimit}
              disabled={spinning}
              onChange={(event) => setPoolLimit(Math.max(0, Math.min(eligibleParticipants.length, Number(event.target.value) || 0)))}
            />
            <em>명 · 0은 전체</em>
          </label>
        ) : (
          <label className="round-recipient">
            <span>받을 사람</span>
            <input value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="선택 입력" />
          </label>
        )}

        <div className="round-toggle round-toggle--mode" aria-label="추첨 연출">
          <button type="button" aria-pressed={drawMode === 'wheel'} disabled={spinning} onClick={() => setDrawMode('wheel')}>룰렛</button>
          <button type="button" aria-pressed={drawMode === 'marble'} disabled={spinning} onClick={() => setDrawMode('marble')}>마블</button>
        </div>
        <span className="round-status">{removeAfterDraw && drawTarget === 'people' ? '중복 당첨 방지 중' : useWeights ? '가중치 적용 중' : '동일 확률'}</span>
      </section>

      <div className="broadcast-grid">
        <section className="broadcast-stage" aria-labelledby="stage-title">
          <div className="broadcast-stage__heading">
            <div>
              <p className="broadcast-stage__eyebrow">이번 라운드</p>
              <h1 id="stage-title">
                {drawTarget === 'people'
                  ? '참여자 추첨'
                  : recipient.trim() ? `${recipient.trim()}님 상품 추첨` : '상품 추첨'}
              </h1>
            </div>
            <span className="mode-chip">{drawMode === 'wheel' ? '룰렛' : '마블'} · 후보 {drawOptions.length}{drawTarget === 'people' ? '명' : '개'}</span>
          </div>

          <div className="visual-stage visual-stage--broadcast">
            {drawMode === 'wheel' ? (
              <RouletteWheel
                participants={displayNames}
                itemType={drawTarget === 'prizes' ? 'prize' : 'participant'}
                winnerIndex={winnerIndex}
                spinning={spinning}
                spinKey={spinKey}
                onSpinEnd={completeDraw}
              />
            ) : (
              <MarbleRace
                participants={displayNames}
                itemType={drawTarget === 'prizes' ? 'prize' : 'participant'}
                winnerIndex={winnerIndex}
                racing={spinning}
                raceKey={spinKey}
                onRaceEnd={completeDraw}
              />
            )}
          </div>

          <div className={`live-result${stageResult ? ' has-result' : ''}`} aria-live="polite">
            <div>
              <span>{stageResult ? '방금 당첨' : drawTarget === 'prizes' && recipient.trim() ? '상품을 받을 사람' : '추첨 준비'}</span>
              <strong>
                {stageResult
                  ? stageResult.target === 'prizes' && stageResult.recipient
                    ? `${stageResult.recipient}님 · ${stageResult.winner}`
                    : stageResult.winner
                  : drawTarget === 'prizes' && recipient.trim()
                    ? `${recipient.trim()}님에게 드릴 상품을 뽑아 주세요`
                    : '추첨 버튼을 누르세요'}
              </strong>
            </div>
            {stageResult?.target === 'people' && (
              <button className="result-prize-button" type="button" onClick={startPrizeForLatestWinner}>이분 상품 뽑기</button>
            )}
            <span className="live-result__emoji" aria-hidden="true">{stageResult ? '💝' : '🍸'}</span>
          </div>

          <div className="stage-action">
            <button className="primary-button" type="button" onClick={startDraw} disabled={spinning || pendingDraws > 0 || drawOptions.length === 0}>
              {drawButtonLabel}
            </button>
            {drawTarget === 'people' && poolLimit > 0 && (
              <button className="stage-link" type="button" disabled={spinning} onClick={reshufflePool}>후보 다시 섞기</button>
            )}
          </div>
        </section>

        <aside className="live-sidebar" aria-label="방송 진행 정보">
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
                <button className="compact-button" type="button" onClick={openParticipantEditor}>편집</button>
              </div>
              <ol className="live-participant-list">
                {participants.slice(0, 18).map((participant, index) => {
                  const excluded = excludedParticipantIds.includes(participant.id);
                  return (
                    <li key={participant.id} className={excluded ? 'is-excluded' : ''}>
                      <span>{index + 1}</span>
                      <strong>{participant.name}</strong>
                      {excluded ? <button type="button" onClick={() => restoreParticipant(participant.id, participant.name)}>복귀</button> : <em>참여 중</em>}
                    </li>
                  );
                })}
              </ol>
              {participants.length > 18 && <p className="live-panel__note">+{participants.length - 18}명은 명단 조정에서 확인할 수 있어요.</p>}
              <button className="panel-wide-button" type="button" onClick={copyParticipantList}>번호가 붙은 명단 복사</button>

              <details className="live-advanced">
                <summary>고급 추첨 설정</summary>
                <label>
                  <input type="checkbox" checked={useWeights} onChange={(event) => setUseWeights(event.target.checked)} />
                  가중치 추첨 사용
                </label>
                <label>
                  <input type="checkbox" checked={!removeAfterDraw} onChange={(event) => setRemoveAfterDraw(!event.target.checked)} />
                  중복 당첨 허용
                </label>
                {useWeights && (
                  <div className="weight-editor">
                    {candidateParticipants.slice(0, 12).map((participant) => (
                      <label className="weight-editor__row" key={participant.id}>
                        <span>{participant.name}</span>
                        <input type="number" min="0" max="99" value={participant.weight} onChange={(event) => updateParticipantWeight(participant.id, Number(event.target.value))} />
                      </label>
                    ))}
                  </div>
                )}
              </details>
            </section>
          )}

          {sideTab === 'prizes' && (
            <section className="live-panel" aria-labelledby="prize-panel-title">
              <div className="live-panel__heading">
                <div>
                  <h2 id="prize-panel-title">상품 수량</h2>
                  <p>남은 상품 {availablePrizeCount}개</p>
                </div>
                <button className="compact-button" type="button" onClick={addPrize}>+ 상품</button>
              </div>
              <div className="live-prize-list">
                {prizes.length === 0 && <p className="live-panel__empty">아직 상품이 없어요. 선물을 추가해 주세요.</p>}
                {prizes.map((prize) => (
                  <div className="live-prize-row" key={prize.id}>
                    <input value={prize.name} onChange={(event) => updatePrize(prize.id, { name: event.target.value })} aria-label={`${prize.name} 상품 이름`} />
                    <label>
                      <span>수량</span>
                      <input type="number" min="0" value={prize.quantity} onChange={(event) => updatePrize(prize.id, { quantity: Math.max(0, Number(event.target.value) || 0) })} aria-label={`${prize.name} 수량`} />
                    </label>
                    <button type="button" onClick={() => removePrize(prize.id, prize.name)} aria-label={`${prize.name} 삭제`}>×</button>
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
                      <small>{formatTime(item.createdAt)} · {item.target === 'people' ? '사람' : '상품'}</small>
                      <strong>{item.winner}</strong>
                      <span>{item.target === 'prizes' && item.recipient ? `${item.recipient}님에게 전달` : item.mode === 'wheel' ? '룰렛' : '마블'}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          )}
        </aside>
      </div>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

export default App;
