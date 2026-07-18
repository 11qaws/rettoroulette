import { useId } from 'react';

import type { DrawMode, DrawTarget, Participant, Prize, WheelPresentation } from '../types';
import PrizeEditor from './PrizeEditor';
import './RoundSetupPanel.css';

type PrizePatch = Partial<Pick<Prize, 'name' | 'quantity'>>;
type PresentationChoice = 'spin' | 'dart' | 'marble';

export interface RoundSetupPanelProps {
  target: DrawTarget;
  drawMode: DrawMode;
  wheelPresentation: WheelPresentation;
  participantTotal: number;
  eligibleParticipants: Participant[];
  candidateParticipants: Participant[];
  excludedCount: number;
  poolLimit: number;
  winnerCount: number;
  maximumWinnerCount: number;
  drawOptionCount: number;
  prizes: Prize[];
  rewardLabel: string;
  drawLabel: string;
  recipient: string;
  removeAfterDraw: boolean;
  useWeights: boolean;
  disabled?: boolean;
  onTargetChange: (target: DrawTarget) => void;
  onRewardLabelChange: (value: string) => void;
  onDrawLabelChange: (value: string) => void;
  onRecipientChange: (value: string) => void;
  onPoolLimitChange: (value: number) => void;
  onReshufflePool: () => void;
  onWinnerCountChange: (value: number) => void;
  onPresentationChange: (choice: PresentationChoice) => void;
  onRemoveAfterDrawChange: (value: boolean) => void;
  onUseWeightsChange: (value: boolean) => void;
  onParticipantWeightChange: (id: string, weight: number) => void;
  onEditRoster: () => void;
  onAddPrize: () => void;
  onUpdatePrize: (id: string, patch: PrizePatch) => void;
  onPrizeWeightChange: (id: string, weight: number) => void;
  onRemovePrize: (id: string, name: string) => void;
}

function clampWholeNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function StepHeading({ number, title, description }: {
  number: number;
  title: string;
  description: string;
}) {
  return (
    <header className="round-setup__step-heading">
      <span aria-hidden="true">{number}</span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </header>
  );
}

export default function RoundSetupPanel({
  target,
  drawMode,
  wheelPresentation,
  participantTotal,
  eligibleParticipants,
  candidateParticipants,
  excludedCount,
  poolLimit,
  winnerCount,
  maximumWinnerCount,
  drawOptionCount,
  prizes,
  rewardLabel,
  drawLabel,
  recipient,
  removeAfterDraw,
  useWeights,
  disabled = false,
  onTargetChange,
  onRewardLabelChange,
  onDrawLabelChange,
  onRecipientChange,
  onPoolLimitChange,
  onReshufflePool,
  onWinnerCountChange,
  onPresentationChange,
  onRemoveAfterDrawChange,
  onUseWeightsChange,
  onParticipantWeightChange,
  onEditRoster,
  onAddPrize,
  onUpdatePrize,
  onPrizeWeightChange,
  onRemovePrize,
}: RoundSetupPanelProps) {
  const countInputId = useId();
  const sampleInputId = useId();
  const presentationChoice: PresentationChoice = drawMode === 'marble' ? 'marble' : wheelPresentation;
  const countUnit = target === 'people' ? '명' : '개';
  const quickCounts = [1, 3, 5, 10].filter((value) => value <= maximumWinnerCount);
  const sampleSize = poolLimit > 0 ? poolLimit : Math.min(10, eligibleParticipants.length);

  return (
    <section className="round-setup" aria-label="이번 추첨 설계">
      <header className="round-setup__header">
        <div>
          <p>한 화면에서 순서대로 정해요</p>
          <h2>이번 추첨 설계</h2>
        </div>
        <strong>{drawOptionCount}{countUnit} 추첨 가능</strong>
      </header>

      <ol className="round-setup__steps">
        <li className="round-setup__step">
          <StepHeading
            number={1}
            title="이번에는 무엇을 뽑나요?"
            description="사람을 뽑는 추첨과 한 사람에게 줄 상품을 뽑는 추첨은 따로 설정합니다."
          />

          <div className="round-setup__choice-grid round-setup__choice-grid--two">
            <button
              type="button"
              className="round-setup__choice-card"
              aria-pressed={target === 'people'}
              disabled={disabled}
              onClick={() => onTargetChange('people')}
            >
              <span>당첨자 뽑기</span>
              <strong>명단에서 사람을 뽑아요</strong>
              <small>선물을 받을 시청자를 정할 때</small>
            </button>
            <button
              type="button"
              className="round-setup__choice-card"
              aria-pressed={target === 'prizes'}
              disabled={disabled}
              onClick={() => onTargetChange('prizes')}
            >
              <span>상품 뽑기</span>
              <strong>재고에서 선물을 뽑아요</strong>
              <small>이미 정한 당첨자에게 상품을 줄 때</small>
            </button>
          </div>

          {target === 'people' ? (
            <label className="round-setup__text-field">
              <span>선물 또는 이벤트 <em>선택</em></span>
              <input
                value={rewardLabel}
                maxLength={40}
                disabled={disabled}
                placeholder="예: 버거 기프티콘"
                onChange={(event) => onRewardLabelChange(event.target.value)}
              />
              <small>결과 화면에서 당첨자가 무엇에 당첨됐는지 함께 보여 줍니다.</small>
            </label>
          ) : (
            <PrizeEditor
              prizes={prizes}
              useWeights={useWeights}
              showWeightFields={false}
              disabled={disabled}
              onAdd={onAddPrize}
              onUpdate={onUpdatePrize}
              onWeightChange={onPrizeWeightChange}
              onRemove={onRemovePrize}
            />
          )}
        </li>

        <li className="round-setup__step">
          <StepHeading
            number={2}
            title={target === 'people' ? '누구 중에서 뽑나요?' : '누구에게 줄까요?'}
            description={target === 'people'
              ? '전체 명단과 실제 추첨 후보를 구분해 확인합니다.'
              : '받을 사람이 정해졌다면 이름을 남겨 결과와 기록에 함께 표시합니다.'}
          />

          {target === 'people' ? (
            <>
              <dl className="round-setup__metrics">
                <div><dt>전체 명단</dt><dd>{participantTotal}명</dd></div>
                <div><dt>추첨 가능</dt><dd>{eligibleParticipants.length}명</dd></div>
                <div><dt>이전 당첨 제외</dt><dd>{excludedCount}명</dd></div>
              </dl>

              <div className="round-setup__inline-actions">
                <div className="round-setup__segmented" role="group" aria-label="후보 범위">
                  <button type="button" aria-pressed={poolLimit === 0} disabled={disabled} onClick={() => onPoolLimitChange(0)}>
                    전체 {eligibleParticipants.length}명
                  </button>
                  <button
                    type="button"
                    aria-pressed={poolLimit > 0}
                    disabled={disabled || eligibleParticipants.length === 0}
                    onClick={() => onPoolLimitChange(Math.max(1, sampleSize))}
                  >
                    일부만 무작위 선택
                  </button>
                </div>
                <button className="round-setup__quiet-button" type="button" disabled={disabled} onClick={onEditRoster}>명단 다듬기</button>
              </div>

              {poolLimit > 0 && (
                <div className="round-setup__sample">
                  <label htmlFor={sampleInputId}>무작위 후보 인원</label>
                  <span className="round-setup__number-box">
                    <input
                      id={sampleInputId}
                      type="number"
                      min="1"
                      max={eligibleParticipants.length}
                      value={poolLimit}
                      disabled={disabled}
                      onChange={(event) => onPoolLimitChange(clampWholeNumber(Number(event.target.value), 1, eligibleParticipants.length))}
                    />
                    <em>명</em>
                  </span>
                  <button type="button" disabled={disabled || poolLimit === 0} onClick={onReshufflePool}>후보 다시 선택</button>
                  <p>
                    {candidateParticipants.slice(0, 8).map((participant) => participant.name).join(' · ')}
                    {candidateParticipants.length > 8 ? ` 외 ${candidateParticipants.length - 8}명` : ''}
                  </p>
                </div>
              )}
            </>
          ) : (
            <label className="round-setup__text-field round-setup__text-field--recipient">
              <span>받을 사람 <em>선택</em></span>
              <input
                value={recipient}
                maxLength={40}
                disabled={disabled}
                placeholder="예: 첫 번째 당첨자 티얀키"
                onChange={(event) => onRecipientChange(event.target.value)}
              />
              <small>비워 두면 상품만 뽑고, 입력하면 “누구에게 어떤 상품”인지 함께 보여 줍니다.</small>
            </label>
          )}
        </li>

        <li className="round-setup__step">
          <StepHeading
            number={3}
            title={target === 'people' ? '몇 명을 뽑나요?' : '상품을 몇 개 뽑나요?'}
            description={`현재 조건에서는 최대 ${maximumWinnerCount}${countUnit}까지 한 회차로 진행할 수 있습니다.`}
          />

          <div className="round-setup__count-row">
            <div className="round-setup__quick-counts" aria-label="빠른 수량 선택">
              {quickCounts.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={winnerCount === value}
                  disabled={disabled}
                  onClick={() => onWinnerCountChange(value)}
                >
                  {value}{countUnit}
                </button>
              ))}
            </div>
            <label className="round-setup__count-control" htmlFor={countInputId}>
              <span>직접 입력</span>
              <span className="round-setup__number-box">
                <button type="button" disabled={disabled || winnerCount <= 1} aria-label={`${countUnit} 수 줄이기`} onClick={() => onWinnerCountChange(winnerCount - 1)}>−</button>
                <input
                  id={countInputId}
                  type="number"
                  min="1"
                  max={maximumWinnerCount}
                  value={winnerCount}
                  disabled={disabled}
                  onChange={(event) => onWinnerCountChange(clampWholeNumber(Number(event.target.value), 1, maximumWinnerCount))}
                />
                <em>{countUnit}</em>
                <button type="button" disabled={disabled || winnerCount >= maximumWinnerCount} aria-label={`${countUnit} 수 늘리기`} onClick={() => onWinnerCountChange(winnerCount + 1)}>＋</button>
              </span>
            </label>
          </div>
        </li>

        <li className="round-setup__step">
          <StepHeading
            number={4}
            title="어떤 방송 연출로 보여줄까요?"
            description="결과를 뽑는 규칙은 같고, 시청자에게 공개하는 장면만 달라집니다."
          />

          <div className="round-setup__choice-grid round-setup__choice-grid--three">
            <button type="button" className="round-setup__choice-card" aria-pressed={presentationChoice === 'spin'} disabled={disabled} onClick={() => onPresentationChange('spin')}>
              <span>회전 룰렛</span>
              <strong>고속 회전 → 감속</strong>
              <small>버튼을 누르면 결과를 고정하고 경계선에서 멈춥니다.</small>
            </button>
            <button type="button" className="round-setup__choice-card" aria-pressed={presentationChoice === 'dart'} disabled={disabled} onClick={() => onPresentationChange('dart')}>
              <span>다트 복권</span>
              <strong>직접 한 발씩 발사</strong>
              <small>당첨자마다 버튼을 누르고, 다트가 꽂힌 판이 함께 돕니다.</small>
            </button>
            <button type="button" className="round-setup__choice-card" aria-pressed={presentationChoice === 'marble'} disabled={disabled} onClick={() => onPresentationChange('marble')}>
              <span>마블 레이스</span>
              <strong>모두 함께 결승선으로</strong>
              <small>후보가 동시에 달리는 게임형 추첨입니다.</small>
            </button>
          </div>
        </li>

        <li className="round-setup__step">
          <StepHeading
            number={5}
            title="당첨 규칙을 확인해요"
            description="확률과 중복 정책은 결과에 직접 영향을 주므로 숨기지 않고 문장 그대로 선택합니다."
          />

          <div className="round-setup__rule-grid">
            <fieldset className="round-setup__rule-group">
              <legend>당첨 확률</legend>
              <button type="button" aria-pressed={!useWeights} disabled={disabled} onClick={() => onUseWeightsChange(false)}>
                <strong>모두 같은 확률</strong><small>후보마다 추첨권 1장</small>
              </button>
              <button type="button" aria-pressed={useWeights} disabled={disabled} onClick={() => onUseWeightsChange(true)}>
                <strong>확률 직접 지정</strong><small>대상마다 추첨권 수 조정</small>
              </button>
            </fieldset>

            {target === 'people' ? (
              <fieldset className="round-setup__rule-group">
                <legend>중복 당첨</legend>
                <button type="button" aria-pressed={removeAfterDraw} disabled={disabled} onClick={() => onRemoveAfterDrawChange(true)}>
                  <strong>당첨자는 이후 후보에서 제외</strong><small>기본 · 중복 당첨 방지</small>
                </button>
                <button type="button" aria-pressed={!removeAfterDraw} disabled={disabled} onClick={() => onRemoveAfterDrawChange(false)}>
                  <strong>같은 사람의 중복 허용</strong><small>같은 회차에서도 다시 뽑힐 수 있음</small>
                </button>
              </fieldset>
            ) : (
              <div className="round-setup__fixed-rule">
                <span>고정 규칙</span>
                <strong>뽑힌 상품은 재고에서 1개 차감</strong>
                <small>같은 재고 단위는 한 번만 사용합니다.</small>
              </div>
            )}
          </div>

          {useWeights && target === 'people' && (
            <div className="round-setup__weight-editor">
              <header><strong>참여자별 추첨권</strong><small>0장은 이번 추첨에서 제외</small></header>
              <div>
                {candidateParticipants.map((participant) => (
                  <label key={participant.id}>
                    <span>{participant.name}</span>
                    <input type="number" min="0" max="99" value={participant.weight} disabled={disabled} onChange={(event) => onParticipantWeightChange(participant.id, clampWholeNumber(Number(event.target.value), 0, 99))} />
                    <em>장</em>
                  </label>
                ))}
              </div>
            </div>
          )}

          {useWeights && target === 'prizes' && prizes.length > 0 && (
            <div className="round-setup__weight-editor">
              <header><strong>상품별 확률 배수</strong><small>유효 추첨권 = 남은 수량 × 확률 배수</small></header>
              <div>
                {prizes.map((prize) => (
                  <label key={prize.id}>
                    <span>{prize.name.trim() || '이름 없는 상품'} · {prize.quantity}개</span>
                    <input type="number" min="0" max="99" value={prize.weight} disabled={disabled} onChange={(event) => onPrizeWeightChange(prize.id, clampWholeNumber(Number(event.target.value), 0, 99))} />
                    <em>배 · {Math.max(0, prize.quantity) * Math.max(0, prize.weight)}장</em>
                  </label>
                ))}
              </div>
            </div>
          )}
        </li>

        <li className="round-setup__step round-setup__step--display">
          <StepHeading
            number={6}
            title="방송 화면에 붙일 제목"
            description="선물 이름과 별개인 방송용 문구입니다. 비워도 진행할 수 있습니다."
          />
          <label className="round-setup__text-field">
            <span>방송 표시 제목 <em>선택</em></span>
            <input value={drawLabel} maxLength={40} disabled={disabled} placeholder="예: 오늘의 버거 3명 추첨" onChange={(event) => onDrawLabelChange(event.target.value)} />
          </label>
        </li>
      </ol>
    </section>
  );
}
