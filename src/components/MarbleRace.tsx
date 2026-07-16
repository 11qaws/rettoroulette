import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import './MarbleRace.css';

export interface MarbleRaceProps {
  participants: string[];
  winnerIndex: number | null;
  racing: boolean;
  raceKey: number;
  onRaceEnd: () => void;
}

type RaceEntry = {
  index: number;
  lane: number;
  name: string;
  color: string;
};

type Lane = {
  startY: number;
  controlOneY: number;
  controlTwoY: number;
  finishY: number;
};

const MAX_VISIBLE_MARBLES = 10;
const TRACK_START_X = 132;
const TRACK_FINISH_X = 846;

const MARBLE_COLORS = [
  'var(--hot-pink, #ffb6c1)',
  'var(--lemon, #ffd166)',
  'var(--mint, #34e0a8)',
  'var(--sky, #4ea9f0)',
  'var(--lavender, #7e57c2)',
  'var(--orange, #ff9d54)',
];

const CHECKERS = Array.from({ length: 12 }, (_, index) => ({
  x: 855 + (index % 2) * 13,
  y: 130 + Math.floor(index / 2) * 58,
  isDark: (index + Math.floor(index / 2)) % 2 === 0,
}));

function clamp(value: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function seededUnit(seed: number) {
  const value = Math.sin((seed + 1) * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function cubicPoint(
  t: number,
  startX: number,
  startY: number,
  controlOneX: number,
  controlOneY: number,
  controlTwoX: number,
  controlTwoY: number,
  endX: number,
  endY: number,
) {
  const inverse = 1 - t;

  return {
    x:
      inverse ** 3 * startX +
      3 * inverse ** 2 * t * controlOneX +
      3 * inverse * t ** 2 * controlTwoX +
      t ** 3 * endX,
    y:
      inverse ** 3 * startY +
      3 * inverse ** 2 * t * controlOneY +
      3 * inverse * t ** 2 * controlTwoY +
      t ** 3 * endY,
  };
}

function laneFor(laneIndex: number, laneCount: number): Lane {
  const laneGap = laneCount < 2 ? 0 : Math.min(42, 352 / (laneCount - 1));
  const firstY = 310 - (laneGap * (laneCount - 1)) / 2;
  const startY = firstY + laneIndex * laneGap;
  const bend = 38 + seededUnit(laneIndex + 20) * 23;
  const direction = laneIndex % 2 === 0 ? -1 : 1;
  const finishY = startY + Math.sin((laneIndex + 1) * 1.7) * 11;

  return {
    startY,
    controlOneY: startY + bend * direction,
    controlTwoY: finishY - bend * direction,
    finishY,
  };
}

function lanePath(lane: Lane) {
  return [
    `M ${TRACK_START_X} ${lane.startY.toFixed(2)}`,
    `C 332 ${lane.controlOneY.toFixed(2)}, 625 ${lane.controlTwoY.toFixed(2)}, ${TRACK_FINISH_X} ${lane.finishY.toFixed(2)}`,
  ].join(' ');
}

function compactName(name: string) {
  const cleaned = name.trim() || '이름 없음';
  const characters = Array.from(cleaned);

  return characters.length > 8 ? `${characters.slice(0, 7).join('')}…` : cleaned;
}

function makeFeaturedEntries(participants: string[], winnerIndex: number | null): RaceEntry[] {
  const allIndexes = participants.map((_, index) => index);
  let featuredIndexes = allIndexes.slice(0, MAX_VISIBLE_MARBLES);

  if (
    winnerIndex !== null &&
    winnerIndex >= 0 &&
    winnerIndex < participants.length &&
    !featuredIndexes.includes(winnerIndex)
  ) {
    featuredIndexes = [...featuredIndexes.slice(0, MAX_VISIBLE_MARBLES - 1), winnerIndex];
  }

  return featuredIndexes.map((index, lane) => ({
    index,
    lane,
    name: participants[index].trim() || `마블 ${index + 1}`,
    color: MARBLE_COLORS[index % MARBLE_COLORS.length],
  }));
}

function raceDistance(progress: number, entry: RaceEntry, isWinner: boolean) {
  const startDelay = Math.min(0.16, (entry.lane % 6) * 0.025);
  const started = clamp((progress - startDelay) / (1 - startDelay));

  if (isWinner) {
    if (started < 0.64) return started * 0.78;
    return 0.4992 + ((started - 0.64) / 0.36) * 0.5008;
  }

  const pace = 0.76 + seededUnit(entry.index + 6) * 0.16;
  return clamp(started * pace, 0, 0.94);
}

export default function MarbleRace({
  participants,
  winnerIndex,
  racing,
  raceKey,
  onRaceEnd,
}: MarbleRaceProps) {
  const validWinner =
    winnerIndex !== null && winnerIndex >= 0 && winnerIndex < participants.length;
  const [progress, setProgress] = useState(0);
  const onRaceEndRef = useRef(onRaceEnd);

  const entries = useMemo(
    () => makeFeaturedEntries(participants, winnerIndex),
    [participants, winnerIndex],
  );

  useEffect(() => {
    onRaceEndRef.current = onRaceEnd;
  }, [onRaceEnd]);

  useEffect(() => {
    if (!racing) setProgress(validWinner ? 1 : 0);
  }, [racing, validWinner]);

  useEffect(() => {
    if (!racing) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 80 : 4400 + (Math.abs(raceKey) % 3) * 220;
    let frameId = 0;
    let ended = false;
    const startAt = performance.now();

    const finish = () => {
      if (ended) return;
      ended = true;
      setProgress(1);
      onRaceEndRef.current();
    };

    const animate = (now: number) => {
      const elapsed = clamp((now - startAt) / duration);
      setProgress(1 - (1 - elapsed) ** 3);

      if (elapsed >= 1) {
        finish();
        return;
      }

      frameId = window.requestAnimationFrame(animate);
    };

    setProgress(0);
    frameId = window.requestAnimationFrame(animate);

    return () => window.cancelAnimationFrame(frameId);
  }, [raceKey, racing]);

  const winnerName = validWinner && winnerIndex !== null ? participants[winnerIndex] : '';
  const displayCount = entries.length;
  const hiddenCount = Math.max(0, participants.length - displayCount);
  const laneStroke = displayCount > 8 ? 24 : 31;
  const marbleRadius = displayCount > 8 ? 13 : 16;
  const rootClassName = [
    'marble-race',
    racing ? 'is-racing' : '',
    validWinner && !racing ? 'has-winner' : '',
    participants.length === 0 ? 'is-empty' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={rootClassName} aria-label="Retto 마블 레이스">
      <div className="marble-race__header">
        <div>
          <p className="marble-race__eyebrow">RETTO SPECIAL MODE</p>
          <h2 className="marble-race__title">마블 대시 룰렛</h2>
        </div>
        <div className="marble-race__badge" aria-hidden="true">
          <span className="marble-race__badge-dot" />
          {racing ? '달리는 중!' : validWinner ? '우승 마블!' : '출발 대기'}
        </div>
      </div>

      <div className="marble-race__board">
        <svg
          className="marble-race__svg"
          viewBox="0 0 1000 620"
          role="img"
          aria-label={
            racing
              ? `${participants.length}명의 마블이 결승선을 향해 달리고 있습니다.`
              : validWinner
                ? `${winnerName} 마블이 우승했습니다.`
                : participants.length > 0
                  ? `${participants.length}명의 마블이 출발을 기다리고 있습니다.`
                  : '참가자 마블을 기다리고 있습니다.'
          }
        >
          <title>Retto Marble Dash</title>
          <rect className="marble-race__backdrop" x="16" y="16" width="968" height="588" rx="52" />
          <path className="marble-race__cloud marble-race__cloud--one" d="M 66 128 C 89 92, 133 94, 146 125 C 174 103, 208 121, 207 151 L 63 151 C 47 146, 51 133, 66 128 Z" />
          <path className="marble-race__cloud marble-race__cloud--two" d="M 734 94 C 753 67, 791 72, 801 99 C 827 78, 861 94, 861 122 L 729 122 C 716 115, 721 102, 734 94 Z" />

          <g className="marble-race__confetti" aria-hidden="true">
            <path d="M 158 89 l 12 -17 l 10 12 l -11 17 Z" />
            <circle cx="222" cy="102" r="6" />
            <path d="M 685 134 l 7 -16 l 14 6 l -7 16 Z" />
            <path d="M 769 470 l 15 3 l -4 15 l -15 -3 Z" />
            <circle cx="89" cy="477" r="7" />
          </g>

          <g aria-hidden="true">
            <path className="marble-race__start-line" d="M 115 130 V 490" />
            <path className="marble-race__start-flag" d="M 83 132 H 141 L 128 163 H 83 Z" />
            <text className="marble-race__start-copy" x="112" y="110" textAnchor="middle">START!</text>
            <path className="marble-race__finish-post" d="M 881 121 V 498" />
            <text className="marble-race__finish-copy" x="866" y="107" textAnchor="middle">FINISH</text>
            {CHECKERS.map((checker) => (
              <rect
                key={`${checker.x}-${checker.y}`}
                className={checker.isDark ? 'marble-race__checker is-dark' : 'marble-race__checker'}
                x={checker.x}
                y={checker.y}
                width="13"
                height="58"
              />
            ))}
          </g>

          <g className="marble-race__lanes" aria-hidden="true">
            {entries.map((entry) => {
              const lane = laneFor(entry.lane, displayCount);
              const path = lanePath(lane);

              return (
                <g key={`track-${entry.index}`}>
                  <path className="marble-race__lane-shadow" d={path} strokeWidth={laneStroke + 8} />
                  <path className="marble-race__lane-track" d={path} strokeWidth={laneStroke} />
                  <path className="marble-race__lane-dashes" d={path} />
                </g>
              );
            })}
          </g>

          {entries.map((entry) => {
            const lane = laneFor(entry.lane, displayCount);
            const isWinner = validWinner && entry.index === winnerIndex;
            const distance = raceDistance(progress, entry, isWinner);
            const point = cubicPoint(
              distance,
              TRACK_START_X,
              lane.startY,
              332,
              lane.controlOneY,
              625,
              lane.controlTwoY,
              TRACK_FINISH_X,
              lane.finishY,
            );
            const showWinner = isWinner && progress > 0.985;
            const labelOnLeft = point.x > 690;
            const marbleStyle: CSSProperties = {
              animationDelay: `${-(entry.lane % 5) * 80}ms`,
            };

            return (
              <g
                key={`${entry.index}-${entry.name}`}
                className={`marble-race__runner${showWinner ? ' marble-race__runner--winner' : ''}`}
                transform={`translate(${point.x.toFixed(2)} ${point.y.toFixed(2)})`}
              >
                <title>{entry.name}</title>
                {showWinner && <circle className="marble-race__winner-ring" r={marbleRadius + 12} />}
                <g className="marble-race__marble-motion" style={marbleStyle}>
                  <ellipse className="marble-race__marble-shadow" cy={marbleRadius + 8} rx={marbleRadius - 2} ry="4" />
                  <circle className="marble-race__marble-outline" r={marbleRadius + 2.5} />
                  <circle className="marble-race__marble" r={marbleRadius} fill={entry.color} />
                  <circle className="marble-race__marble-shine" cx={-marbleRadius * 0.32} cy={-marbleRadius * 0.34} r={marbleRadius * 0.3} />
                  <path className="marble-race__marble-swoop" d={`M ${-marbleRadius * 0.46} ${marbleRadius * 0.4} Q 0 ${marbleRadius * 0.74} ${marbleRadius * 0.52} ${marbleRadius * 0.21}`} />
                </g>
                {showWinner && <text className="marble-race__crown" y={-marbleRadius - 15} textAnchor="middle">♛</text>}
                <text
                  className="marble-race__runner-name"
                  x={labelOnLeft ? -marbleRadius - 8 : marbleRadius + 8}
                  y="4"
                  textAnchor={labelOnLeft ? 'end' : 'start'}
                >
                  {compactName(entry.name)}
                </text>
              </g>
            );
          })}

          {participants.length === 0 && (
            <g className="marble-race__empty-copy">
              <text x="500" y="278" textAnchor="middle">댓글 마블을 불러오면</text>
              <text x="500" y="326" textAnchor="middle">여기서 신나게 달려요!</text>
              <text x="500" y="372" textAnchor="middle">● ● ●</text>
            </g>
          )}
        </svg>

        {hiddenCount > 0 && (
          <p className="marble-race__overflow" aria-label={`총 ${hiddenCount}명의 추가 참가자`}>
            +{hiddenCount}명의 마블도 같이 달리는 중
          </p>
        )}
      </div>

      <div className="marble-race__footer">
        <span className="marble-race__count">● {participants.length.toLocaleString('ko-KR')} MARBLES</span>
        <span className="marble-race__status" aria-live="polite">
          {racing
            ? '마블들이 결승선을 향해 질주 중이에요!'
            : validWinner
              ? `오늘의 행운 마블은 ${winnerName}님!`
              : participants.length > 0
                ? '버튼을 누르면 마블 대시가 시작돼요.'
                : '네이버 카페 댓글을 불러와 주세요.'}
        </span>
      </div>
    </section>
  );
}
