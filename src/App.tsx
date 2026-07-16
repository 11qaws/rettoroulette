import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import MarbleRace from './components/MarbleRace';
import RouletteWheel from './components/RouletteWheel';
import { demoParticipants, demoPrizes } from './data/demo';
import { pickWeightedIndex, sampleWithoutReplacement } from './lib/draw';
import {
  buildCollectorBookmarklet,
  parseImportHash,
  parseNaverCafeArticle,
} from './lib/naverCollector';
import type { NaverCafeImport } from './lib/naverCollector';
import type { DrawMode, DrawRecord, DrawTarget, Participant, Prize } from './types';

import './App.css';

type DrawOption = {
  id: string;
  name: string;
  weight: number;
};

const DEFAULT_CAFE_URL =
  'https://cafe.naver.com/f-e/cafes/31662960/articles/1105?boardtype=L&referrerAllArticles=true';

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function parseManualNames(value: string) {
  const timePattern = /^(?:\d{4}[./-]\d{1,2}[./-]\d{1,2}|\d{1,2}:\d{2}|답글쓰기|더보기|등록)$/;

  return value
    .split(/\r?\n/)
    .map((line) => line.split('\t')[0].trim())
    .map((line) => line.replace(/^[-•·]\s*/, '').trim())
    .filter((line) => line.length > 0 && line.length <= 40 && !timePattern.test(line));
}

function uniqueNames(names: string[]) {
  const seen = new Set<string>();

  return names.filter((name) => {
    const key = name.replace(/\s+/g, ' ').trim().toLocaleLowerCase('ko-KR');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function makeParticipants(names: string[]): Participant[] {
  return uniqueNames(names).map((name, index) => ({
    id: `import-${Date.now()}-${index}`,
    name,
    weight: 1,
    commentCount: 1,
  }));
}

function App() {
  const [drawMode, setDrawMode] = useState<DrawMode>('wheel');
  const [drawTarget, setDrawTarget] = useState<DrawTarget>('people');
  const [participants, setParticipants] = useState<Participant[]>(demoParticipants);
  const [prizes, setPrizes] = useState<Prize[]>(demoPrizes);
  const [excludedParticipantIds, setExcludedParticipantIds] = useState<string[]>([]);
  const [poolLimit, setPoolLimit] = useState(0);
  const [poolIds, setPoolIds] = useState<string[]>([]);
  const [winnerCount, setWinnerCount] = useState(1);
  const [removeAfterDraw, setRemoveAfterDraw] = useState(true);
  const [useWeights, setUseWeights] = useState(false);
  const [linkPrizeDraw, setLinkPrizeDraw] = useState(false);
  const [recipient, setRecipient] = useState('');
  const [pendingDraws, setPendingDraws] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winnerIndex, setWinnerIndex] = useState<number | null>(null);
  const [spinKey, setSpinKey] = useState(0);
  const [presentedOptions, setPresentedOptions] = useState<DrawOption[]>([]);
  const [drawTargetSnapshot, setDrawTargetSnapshot] = useState<DrawTarget>('people');
  const [latestResult, setLatestResult] = useState<DrawRecord | null>(null);
  const [history, setHistory] = useState<DrawRecord[]>([]);
  const [showImporter, setShowImporter] = useState(false);
  const [manualNames, setManualNames] = useState('');
  const [articleUrl, setArticleUrl] = useState(DEFAULT_CAFE_URL);
  const [includeReplies, setIncludeReplies] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const collectorLinkRef = useRef<HTMLAnchorElement>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }, []);

  const collectorHref = useMemo(() => {
    const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).toString();
    return buildCollectorBookmarklet(appUrl);
  }, []);

  useEffect(() => {
    collectorLinkRef.current?.setAttribute('href', collectorHref);
  }, [collectorHref, showImporter]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('retto-roulette-history');
      if (saved) {
        const parsed = JSON.parse(saved) as DrawRecord[];
        if (Array.isArray(parsed)) setHistory(parsed.slice(0, 100));
      }
    } catch {
      // A history failure should never prevent a live giveaway from working.
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('retto-roulette-history', JSON.stringify(history.slice(0, 100)));
  }, [history]);

  const acceptNaverImport = useCallback((payload: NaverCafeImport) => {
    const byNickname = new Map<string, Participant>();

    for (const candidate of payload.candidates) {
      if (!includeReplies && candidate.reply) continue;

      const normalizedName = candidate.nick.replace(/\s+/g, ' ').trim();
      const nameKey = normalizedName.toLocaleLowerCase('ko-KR');
      if (!normalizedName || !nameKey) continue;

      const current = byNickname.get(nameKey);
      if (current) {
        current.commentCount = (current.commentCount ?? 1) + 1;
      } else {
        byNickname.set(nameKey, {
          id: candidate.id || createId('naver'),
          name: normalizedName,
          weight: 1,
          commentCount: 1,
        });
      }
    }

    const imported = [...byNickname.values()];
    if (imported.length === 0) {
      showToast('가져올 댓글 참여자가 없어요. 답글 포함 설정을 확인해 주세요.');
      return;
    }

    setParticipants(imported);
    setExcludedParticipantIds([]);
    setPoolIds([]);
    setPoolLimit(0);
    setWinnerIndex(null);
    setPresentedOptions([]);
    setShowImporter(false);
    showToast(`${imported.length}명의 카페 댓글 참여자를 담았어요!`);
  }, [includeReplies, showToast]);

  useEffect(() => {
    const imported = parseImportHash(window.location.hash);
    if (!imported) return;

    acceptNaverImport(imported);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
  }, [acceptNaverImport]);

  useEffect(() => {
    const onMessage = (event: MessageEvent<unknown>) => {
      if (event.origin !== 'https://cafe.naver.com') return;
      const imported = parseImportHash(`#import=${encodeURIComponent(JSON.stringify(event.data))}`);
      if (imported) acceptNaverImport(imported);
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [acceptNaverImport]);

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
    const eligibleIdSet = new Set(eligibleParticipants.map((participant) => participant.id));
    const stillAvailable = poolIds.filter((id) => eligibleIdSet.has(id)).slice(0, limit);

    if (stillAvailable.length === limit) {
      if (stillAvailable.join('|') !== poolIds.join('|')) setPoolIds(stillAvailable);
      return;
    }

    const rest = eligibleParticipants.filter((participant) => !stillAvailable.includes(participant.id));
    const fillers = sampleWithoutReplacement(rest, limit - stillAvailable.length).map(
      (participant) => participant.id,
    );
    setPoolIds([...stillAvailable, ...fillers]);
  }, [eligibleParticipants, poolIds, poolLimit]);

  const candidateParticipants = useMemo(() => {
    if (poolLimit === 0) return eligibleParticipants;
    const selected = new Set(poolIds);
    return eligibleParticipants.filter((participant) => selected.has(participant.id));
  }, [eligibleParticipants, poolIds, poolLimit]);

  const drawOptions = useMemo<DrawOption[]>(() => {
    if (drawTarget === 'people') {
      return candidateParticipants.map((participant) => ({
        id: participant.id,
        name: participant.name,
        weight: useWeights ? participant.weight : 1,
      }));
    }

    return prizes
      .filter((prize) => prize.quantity > 0)
      .map((prize) => ({
        id: prize.id,
        name: prize.name,
        weight: useWeights ? prize.weight : 1,
      }));
  }, [candidateParticipants, drawTarget, prizes, useWeights]);

  const displayOptions = spinning || winnerIndex !== null ? presentedOptions : drawOptions;
  const displayNames = displayOptions.map((option) => option.name);

  useEffect(() => {
    if (pendingDraws === 0 || spinning) return;
    if (drawOptions.length === 0) {
      setPendingDraws(0);
      showToast('추첨할 대상이 없어요. 후보나 상품을 먼저 채워 주세요.');
      return;
    }

    const snapshot = drawOptions;
    const nextWinner = pickWeightedIndex(snapshot);
    setPresentedOptions(snapshot);
    setDrawTargetSnapshot(drawTarget);
    setWinnerIndex(nextWinner);
    setSpinning(true);
    setSpinKey((value) => value + 1);
    setPendingDraws((value) => Math.max(0, value - 1));
  }, [drawOptions, drawTarget, pendingDraws, showToast, spinning]);

  const reshufflePool = () => {
    if (poolLimit === 0) {
      showToast('현재는 전체 참여자를 사용 중이에요. 후보 수를 먼저 정해 주세요.');
      return;
    }

    const count = Math.min(poolLimit, eligibleParticipants.length);
    setPoolIds(sampleWithoutReplacement(eligibleParticipants, count).map((participant) => participant.id));
    setWinnerIndex(null);
    setPresentedOptions([]);
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

    const record: DrawRecord = {
      id: createId('result'),
      createdAt: new Date().toISOString(),
      mode: drawMode,
      target: drawTargetSnapshot,
      winner: chosen.name,
      recipient: drawTargetSnapshot === 'prizes' ? recipient.trim() || undefined : undefined,
    };

    setHistory((items) => [record, ...items].slice(0, 100));
    setLatestResult(record);

    if (drawTargetSnapshot === 'people' && removeAfterDraw) {
      setExcludedParticipantIds((ids) => [...ids, chosen.id]);
    }

    if (drawTargetSnapshot === 'prizes') {
      setPrizes((items) =>
        items.map((prize) =>
          prize.id === chosen.id
            ? { ...prize, quantity: Math.max(0, prize.quantity - 1) }
            : prize,
        ),
      );
    }

    setSpinning(false);

    if (drawTargetSnapshot === 'people' && linkPrizeDraw) {
      setRecipient(chosen.name);
      setDrawTarget('prizes');
      showToast(`${chosen.name}님 당첨! 이제 상품 룰렛을 돌려 주세요. ✦`);
    }
  };

  const startDraw = () => {
    if (spinning || pendingDraws > 0) return;

    const possibleCount = Math.min(winnerCount, drawOptions.length);
    if (possibleCount < 1) {
      showToast('추첨할 대상이 없어요.');
      return;
    }

    setLatestResult(null);
    setWinnerIndex(null);
    setPendingDraws(possibleCount);
  };

  const resetSession = () => {
    setExcludedParticipantIds([]);
    setPoolIds([]);
    setPoolLimit(0);
    setWinnerIndex(null);
    setPresentedOptions([]);
    setLatestResult(null);
    setPendingDraws(0);
    setSpinning(false);
    showToast('새 방송 세션을 준비했어요. 참여자는 그대로 보관됩니다.');
  };

  const importManualNames = () => {
    const possibleJson = manualNames.trim().startsWith('{')
      ? parseImportHash(`#import=${encodeURIComponent(manualNames.trim())}`)
      : null;

    if (possibleJson) {
      acceptNaverImport(possibleJson);
      return;
    }

    const names = parseManualNames(manualNames);
    const imported = makeParticipants(names);

    if (imported.length === 0) {
      showToast('가져올 닉네임을 찾지 못했어요. 한 줄에 한 명씩 붙여 넣어 주세요.');
      return;
    }

    setParticipants(imported);
    setExcludedParticipantIds([]);
    setPoolIds([]);
    setPoolLimit(0);
    setManualNames('');
    setShowImporter(false);
    showToast(`${imported.length}명의 참여자를 담았어요. 룰렛 준비 완료!`);
  };

  const updateParticipantWeight = (id: string, weight: number) => {
    setParticipants((items) =>
      items.map((participant) =>
        participant.id === id
          ? { ...participant, weight: Math.max(0, Math.min(weight, 99)) }
          : participant,
      ),
    );
  };

  const updatePrize = (id: string, patch: Partial<Prize>) => {
    setPrizes((items) =>
      items.map((prize) => (prize.id === id ? { ...prize, ...patch } : prize)),
    );
  };

  const addPrize = () => {
    setPrizes((items) => [
      ...items,
      { id: createId('prize'), name: '새 선물', quantity: 1, weight: 1 },
    ]);
  };

  const exportHistory = () => {
    if (history.length === 0) {
      showToast('아직 저장할 당첨 결과가 없어요.');
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
    setHistory([]);
    showToast('당첨 기록을 비웠어요.');
  };

  const candidateLabel = drawTarget === 'people' ? '참여자' : '상품';
  const articleInfo = useMemo(() => parseNaverCafeArticle(articleUrl), [articleUrl]);

  const copyCollector = async () => {
    try {
      await navigator.clipboard.writeText(collectorHref);
      showToast('수집 도우미 코드를 복사했어요. 북마크 URL에 붙여넣어도 됩니다.');
    } catch {
      showToast('복사 권한을 허용한 뒤 다시 시도해 주세요.');
    }
  };
  const drawButtonLabel =
    pendingDraws > 0 || spinning
      ? '추첨 진행 중…'
      : drawMode === 'wheel'
        ? `${winnerCount}명 룰렛 돌리기 ✦`
        : `${winnerCount}명 마블 굴리기 ●`;

  return (
    <main className="app-shell">
      <header className="brand-header">
        <a className="brand" href="./" aria-label="Retto Roulette 홈">
          <span className="brand__mark" aria-hidden="true">R</span>
          <span>
            <strong>Retto Roulette</strong>
            <small>댓글이 선물이 되는 순간</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="header-pill">STREAMER GIFT DRAW</span>
          <button className="ghost-button" type="button" onClick={resetSession}>
            새 방송
          </button>
        </div>
      </header>

      <section className="hero-strip" aria-labelledby="hero-title">
        <div>
          <p className="eyebrow">COMMENT → CONFETTI → GIFT</p>
          <h1 id="hero-title">오늘의 행운, 레또가 쏜다!</h1>
          <p>
            네이버 카페 댓글을 가져와 사람도, 상품도, 굴러가는 마블도 귀엽게 뽑아보세요.
          </p>
        </div>
        <div className="hero-strip__mascot" aria-hidden="true">🎀</div>
      </section>

      <div className="dashboard-grid">
        <aside className="control-panel" aria-label="추첨 설정">
          <div className="panel-title-row">
            <h2>방송 부스 설정</h2>
            <span className="panel-kicker">빠르게, 귀엽게</span>
          </div>

          <section className="import-card" aria-labelledby="import-title">
            <h3 className="import-card__title" id="import-title">네이버 카페 댓글 가져오기</h3>
            <p className="import-card__hint">카페 글에서 수집 도우미를 한 번 누르면 닉네임이 바로 들어와요.</p>
            <div className="url-row">
              <input
                className="text-field"
                value={articleUrl}
                onChange={(event) => setArticleUrl(event.target.value)}
                aria-label="네이버 카페 글 주소"
              />
              <button className="compact-button" type="button" onClick={() => setShowImporter(true)}>
                댓글 수집하기
              </button>
            </div>
          </section>

          <div className="draw-mode-tabs" aria-label="추첨 연출 모드">
            <button
              className="draw-mode-button"
              type="button"
              aria-pressed={drawMode === 'wheel'}
              disabled={spinning}
              onClick={() => setDrawMode('wheel')}
            >
              룰렛
              <small>팡! 하고 멈추는</small>
            </button>
            <button
              className="draw-mode-button"
              type="button"
              aria-pressed={drawMode === 'marble'}
              disabled={spinning}
              onClick={() => setDrawMode('marble')}
            >
              마블 레이스
              <small>구슬이 먼저 골인!</small>
            </button>
          </div>

          <div className="settings-heading">
            <h2>무엇을 뽑을까요?</h2>
          </div>
          <div className="target-tabs" aria-label="추첨 대상">
            <button
              className="target-button"
              type="button"
              aria-pressed={drawTarget === 'people'}
              disabled={spinning}
              onClick={() => {
                setDrawTarget('people');
                setWinnerIndex(null);
              }}
            >
              사람 뽑기
              <small>{eligibleParticipants.length}명 남음</small>
            </button>
            <button
              className="target-button"
              type="button"
              aria-pressed={drawTarget === 'prizes'}
              disabled={spinning}
              onClick={() => {
                setDrawTarget('prizes');
                setWinnerIndex(null);
              }}
            >
              상품 뽑기
              <small>{prizes.reduce((sum, prize) => sum + prize.quantity, 0)}개 남음</small>
            </button>
          </div>

          <div className="settings-heading">
            <h2>이번 라운드</h2>
            <span className="panel-kicker">전체 중 원하는 만큼</span>
          </div>
          <div className="settings-grid">
            <section className="setting-card">
              <label htmlFor="pool-limit">후보 N명 담기</label>
              <input
                className="number-field"
                id="pool-limit"
                min="0"
                max={eligibleParticipants.length}
                type="number"
                value={poolLimit}
                onChange={(event) => setPoolLimit(Math.max(0, Number(event.target.value) || 0))}
                disabled={drawTarget === 'prizes' || spinning}
              />
              <small>0이면 전체</small>
            </section>
            <section className="setting-card">
              <label htmlFor="winner-count">당첨 N명 뽑기</label>
              <input
                className="number-field"
                id="winner-count"
                min="1"
                max={Math.max(1, drawOptions.length)}
                type="number"
                value={winnerCount}
                onChange={(event) => setWinnerCount(Math.max(1, Number(event.target.value) || 1))}
                disabled={spinning}
              />
              <small>한 명씩 연출</small>
            </section>

            {drawTarget === 'prizes' && (
              <section className="setting-card setting-card--wide">
                <label htmlFor="recipient">이번 상품을 받을 사람</label>
                <input
                  className="text-field"
                  id="recipient"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  placeholder="예: 말랑콩"
                />
              </section>
            )}
          </div>

          {drawTarget === 'people' && (
            <>
              <div className="pool-summary">
                <strong>현재 룰렛 후보</strong>
                <span>{candidateParticipants.length}명</span>
              </div>
              <div className="name-chips" aria-label="현재 후보 이름">
                {candidateParticipants.slice(0, 10).map((participant) => (
                  <span className="name-chip" key={participant.id}>{participant.name}</span>
                ))}
                {candidateParticipants.length > 10 && (
                  <span className="name-chip name-chip--more">+{candidateParticipants.length - 10}</span>
                )}
              </div>
              {poolLimit > 0 && (
                <button className="compact-button" type="button" onClick={reshufflePool} disabled={spinning}>
                  후보 다시 섞기
                </button>
              )}
            </>
          )}

          <label className="switch-row">
            <input
              type="checkbox"
              checked={removeAfterDraw}
              onChange={(event) => setRemoveAfterDraw(event.target.checked)}
              disabled={drawTarget === 'prizes'}
            />
            <span>
              당첨되면 후보에서 빼기
              <small>켜 두면 중복 당첨 없이 순서대로 뽑아요.</small>
            </span>
          </label>

          <label className="switch-row">
            <input
              type="checkbox"
              checked={linkPrizeDraw}
              onChange={(event) => setLinkPrizeDraw(event.target.checked)}
              disabled={drawTarget === 'prizes'}
            />
            <span>
              사람 당첨 후 상품 룰렛으로 이어가기
              <small>당첨자의 이름을 자동으로 상품 추첨에 넘겨요.</small>
            </span>
          </label>

          <section className="prize-card" aria-labelledby="prize-title">
            <div className="panel-title-row">
              <h2 id="prize-title">상품 지정</h2>
              <button className="compact-button" type="button" onClick={addPrize}>+ 선물</button>
            </div>
            <div className="prize-list">
              {prizes.map((prize) => (
                <div className="prize-row" key={prize.id}>
                  <input
                    className="prize-name-input"
                    aria-label={`${prize.name} 상품 이름`}
                    value={prize.name}
                    onChange={(event) => updatePrize(prize.id, { name: event.target.value })}
                  />
                  <input
                    className="prize-quantity-input"
                    aria-label={`${prize.name} 수량`}
                    min="0"
                    type="number"
                    value={prize.quantity}
                    onChange={(event) => updatePrize(prize.id, { quantity: Math.max(0, Number(event.target.value) || 0) })}
                  />
                  <span className="count-badge">{prize.quantity}개</span>
                </div>
              ))}
            </div>
          </section>

          <details className="advanced-options">
            <summary>확률 · 고급 설정</summary>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={useWeights}
                onChange={(event) => setUseWeights(event.target.checked)}
              />
              <span>
                가중 추첨 사용
                <small>켜면 아래 숫자가 높을수록 당첨 확률이 커져요. 방송 화면에도 가중 추첨임을 표시합니다.</small>
              </span>
            </label>
            <div className="weight-editor">
              {(drawTarget === 'people' ? candidateParticipants : prizes).slice(0, 10).map((item) => (
                <label className="weight-editor__row" key={item.id}>
                  <span>{item.name}</span>
                  <input
                    className="weight-input"
                    min="0"
                    max="99"
                    type="number"
                    value={item.weight}
                    onChange={(event) => {
                      const nextWeight = Math.max(0, Number(event.target.value) || 0);
                      if (drawTarget === 'people') updateParticipantWeight(item.id, nextWeight);
                      else updatePrize(item.id, { weight: nextWeight });
                    }}
                  />
                </label>
              ))}
            </div>
            <p>기본값 1은 같은 확률입니다. 0은 이번 추첨에서 제외됩니다.</p>
          </details>
        </aside>

        <section className="stage-panel" aria-labelledby="stage-title">
          <div className="stage-heading">
            <div className="stage-title-row">
              <h2 id="stage-title">
                {drawTarget === 'people' ? '누가 행운의 주인공?' : '어떤 선물이 주인공?'}
              </h2>
              <span className="mode-chip">
                {drawMode === 'wheel' ? '✦ 룰렛' : '● 마블'} · {useWeights ? '가중 추첨' : '공정 추첨'}
              </span>
            </div>
            <p className="stage-subtitle">
              {candidateLabel} {drawOptions.length}개 · {winnerCount}명씩 · {removeAfterDraw && drawTarget === 'people' ? '중복 없음' : '재당첨 가능'}
            </p>
          </div>

          <div className="visual-stage">
            {drawMode === 'wheel' ? (
              <RouletteWheel
                participants={displayNames}
                winnerIndex={winnerIndex}
                spinning={spinning}
                spinKey={spinKey}
                onSpinEnd={completeDraw}
              />
            ) : (
              <MarbleRace
                participants={displayNames}
                winnerIndex={winnerIndex}
                racing={spinning}
                raceKey={spinKey}
                onRaceEnd={completeDraw}
              />
            )}
          </div>

          <div className="result-ribbon" aria-live="polite">
            <div>
              <span className="result-ribbon__label">{latestResult ? '방금 당첨' : 'READY TO SPIN'}</span>
              <strong>
                {latestResult
                  ? latestResult.target === 'prizes' && latestResult.recipient
                    ? `${latestResult.recipient}님 · ${latestResult.winner}`
                    : latestResult.winner
                  : drawTarget === 'people'
                    ? '참여자들의 심장이 두근두근'
                    : '선물 상자가 기다려요'}
              </strong>
            </div>
            <span className="result-ribbon__emoji" aria-hidden="true">{latestResult ? '🎉' : '🍀'}</span>
          </div>

          <div className="stage-action">
            <button
              className="primary-button"
              type="button"
              onClick={startDraw}
              disabled={spinning || pendingDraws > 0 || drawOptions.length === 0}
            >
              {drawButtonLabel}
            </button>
          </div>
        </section>

        <section className="history-panel" aria-labelledby="history-title">
          <div className="history-header">
            <div>
              <p className="eyebrow">SAVED WINNERS</p>
              <h2 id="history-title">당첨 기록</h2>
            </div>
            <div className="header-actions">
              <button className="compact-button" type="button" onClick={exportHistory}>CSV 저장</button>
              <button className="compact-button" type="button" onClick={clearHistory}>비우기</button>
            </div>
          </div>
          {history.length > 0 ? (
            <div className="history-list">
              {history.slice(0, 6).map((item) => (
                <article className="history-item" key={item.id}>
                  <small>{formatTime(item.createdAt)} · {item.mode === 'wheel' ? '룰렛' : '마블'}</small>
                  <strong>{item.winner}</strong>
                  <span>
                    {item.target === 'prizes'
                      ? item.recipient ? `${item.recipient}님에게 전달` : '상품 추첨'
                      : '사람 당첨'}
                  </span>
                </article>
              ))}
            </div>
          ) : (
            <p className="history-empty">첫 번째 행운의 주인공을 기다리고 있어요. ✦</p>
          )}
        </section>
      </div>

      {showImporter && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowImporter(false)}>
          <section
            className="import-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="import-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <p className="eyebrow">NAVER CAFE COMMENT HELPER</p>
                <h2 id="import-modal-title">댓글 닉네임을 가져와요</h2>
              </div>
              <button className="icon-button" type="button" aria-label="닫기" onClick={() => setShowImporter(false)}>×</button>
            </div>
            <ol className="helper-steps">
              <li>아래 수집 버튼을 북마크바에 끌어다 놓습니다.</li>
              <li>네이버 카페 글을 열고, 북마크바의 버튼을 한 번 누릅니다.</li>
              <li>로그인된 카페 댓글 닉네임만 이 룰렛으로 가져옵니다.</li>
            </ol>
            <div className="bookmarklet-row">
              <a
                className="bookmarklet"
                href="#bookmarklet"
                ref={collectorLinkRef}
                onClick={(event) => event.preventDefault()}
                draggable
              >
                🍓 Retto 댓글수집기
              </a>
              <button className="compact-button" type="button" onClick={copyCollector}>코드 복사</button>
              <small>버튼을 북마크바로 끌어 놓거나, 코드를 새 북마크의 URL에 붙여 넣어 주세요.</small>
            </div>
            <p className="helper-note">
              {articleInfo
                ? `카페 ${articleInfo.cafeId} · 글 ${articleInfo.articleId} 주소를 확인했어요. 수집 버튼은 이 글을 열어 둔 네이버 카페 탭에서 실행하세요.`
                : '주소가 카페 글 링크인지 확인해 주세요. 수집 버튼은 네이버 카페 글 탭에서 실행합니다.'}
            </p>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={includeReplies}
                onChange={(event) => setIncludeReplies(event.target.checked)}
              />
              <span>
                답글도 참여자로 포함
                <small>기본은 최상위 댓글만 한 사람당 한 표로 정리합니다.</small>
              </span>
            </label>
            <hr className="modal-divider" />
            <div className="field-stack">
              <label htmlFor="manual-names">닉네임 목록 붙여넣기</label>
              <textarea
                className="textarea-field"
                id="manual-names"
                value={manualNames}
                onChange={(event) => setManualNames(event.target.value)}
                placeholder={'말랑콩\n구름냥\n딸기우유'}
              />
              <span className="input-help">한 줄에 한 명씩 넣거나, 수집기가 복사한 JSON 전체를 붙여 넣어도 됩니다. 중복 닉네임은 하나만 남겨요.</span>
            </div>
            <div className="manual-import-actions">
              <button className="ghost-button" type="button" onClick={() => setShowImporter(false)}>취소</button>
              <button className="compact-button" type="button" onClick={importManualNames}>참여자 담기</button>
            </div>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}

export default App;
