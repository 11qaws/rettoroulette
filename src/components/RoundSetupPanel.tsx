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
  /** Restores every participant excluded by earlier wins without deleting draw history. */
  onRestoreExcluded?: () => void;
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
  onRestoreExcluded,
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
  const hasPrizeInventory = prizes.some((prize) => prize.name.trim() && prize.quantity > 0);
  const allParticipantsExcluded = target === 'people'
    && participantTotal > 0
    && eligibleParticipants.length === 0
    && excludedCount > 0;
  const weightedCandidatesUnavailable = useWeights
    && drawOptionCount === 0
    && (target === 'people' ? candidateParticipants.length > 0 : hasPrizeInventory);
  const isBlocked = drawOptionCount === 0;

  const renderRecoveryCard = () => {
    if (!isBlocked) return null;

    if (allParticipantsExcluded) {
      return (
        <section className="round-setup__recovery" role="alert" aria-labelledby="round-setup-recovery-title">
          <span className="round-setup__recovery-icon" aria-hidden="true">!</span>
          <div>
            <p>현재 추첨을 시작할 수 없어요</p>
            <h3 id="round-setup-recovery-title">명단 전원이 이전 당첨자로 제외되어 있어요</h3>
            <small>
              저장된 {participantTotal}명과 당첨 기록은 그대로입니다. 제외 상태만 풀면 다시 후보가 됩니다.
            </small>
          </div>
          <div className="round-setup__recovery-actions">
            {onRestoreExcluded && (
              <button type="button" disabled={disabled} onClick={onRestoreExcluded}>
                {excludedCount}명 모두 후보로 복귀
              </button>
            )}
            <button type="button" className="is-secondary" disabled={disabled} onClick={onEditRoster}>
              새 명단으로 바꾸기
            </button>
          </div>
        </section>
      );
    }

    if (weightedCandidatesUnavailable) {
      return (
        <section className="round-setup__recovery" role="alert" aria-labelledby="round-setup-recovery-title">
          <span className="round-setup__recovery-icon" aria-hidden="true">!</span>
          <div>
            <p>확률 설정을 확인해 주세요</p>
            <h3 id="round-setup-recovery-title">추첨권이 있는 후보가 없어요</h3>
            <small>모든 추첨권이 0이면 룰렛에 올라갈 후보가 없습니다. 동일 확률로 돌려놓으면 바로 진행할 수 있어요.</small>
          </div>
          <div className="round-setup__recovery-actions">
            <button type="button" disabled={disabled} onClick={() => onUseWeightsChange(false)}>
              모두 같은 확률로 전환
            </button>
            {target === 'people' && (
              <button type="button" className="is-secondary" disabled={disabled} onClick={onEditRoster}>
                원본 명단 편집
              </button>
            )}
          </div>
        </section>
      );
    }

    if (target === 'prizes') {
      return (
        <section className="round-setup__recovery" role="alert" aria-labelledby="round-setup-recovery-title">
          <span className="round-setup__recovery-icon" aria-hidden="true">!</span>
          <div>
            <p>상품 준비가 필요해요</p>
            <h3 id="round-setup-recovery-title">추첨할 상품이 없어요</h3>
            <small>위 상품 목록에서 이름과 수량을 입력하세요. 수량이 1개 이상인 상품만 룰렛 후보가 됩니다.</small>
          </div>
          <div className="round-setup__recovery-actions">
            <button type="button" disabled={disabled} onClick={onAddPrize}>상품 추가하기</button>
          </div>
        </section>
      );
    }

    const canUseWholeRoster = eligibleParticipants.length > 0;
    return (
      <section className="round-setup__recovery" role="alert" aria-labelledby="round-setup-recovery-title">
        <span className="round-setup__recovery-icon" aria-hidden="true">!</span>
        <div>
          <p>후보 준비가 필요해요</p>
          <h3 id="round-setup-recovery-title">
            {participantTotal === 0 ? '아직 참여자 명단이 없어요' : '현재 선택된 후보가 없어요'}
          </h3>
          <small>
            {participantTotal === 0
              ? '카페 댓글이나 직접 입력으로 참여자를 준비해 주세요.'
              : '1차 후보 설정을 전체 명단으로 되돌리거나 원본 명단을 확인해 주세요.'}
          </small>
        </div>
        <div className="round-setup__recovery-actions">
          {canUseWholeRoster && poolLimit > 0 && (
            <button type="button" disabled={disabled} onClick={() => onPoolLimitChange(0)}>현재 명단 전체 사용</button>
          )}
          <button type="button" className={canUseWholeRoster && poolLimit > 0 ? 'is-secondary' : undefined} disabled={disabled} onClick={onEditRoster}>
            {participantTotal === 0 ? '명단 준비하기' : '원본 명단 편집'}
          </button>
        </div>
      </section>
    );
  };

  return (
    <section className="round-setup" aria-label="이번 추첨 설계">
      <header className="round-setup__header">
        <div>
          <p>한 화면에서 순서대로 정해요</p>
          <h2>이번 추첨 설계</h2>
        </div>
        <strong className={isBlocked ? 'is-blocked' : undefined}>
          {isBlocked ? '진행 전 확인 필요' : `${drawOptionCount}${countUnit} 추첨 가능`}
        </strong>
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

        <li className="round-setup__step round-setup__step--candidate">
          {target === 'people' ? (
            <>
              <section className={`round-setup__candidate-card${isBlocked ? ' is-blocked' : ''}`} aria-labelledby="round-setup-candidate-title">
                <div className="round-setup__candidate-main">
                  <div>
                    <p>현재 추첨 대상</p>
                    <h3 id="round-setup-candidate-title">
                      현재 후보 {candidateParticipants.length}명
                    </h3>
                    <small>
                      저장 {participantTotal}명
                      {excludedCount > 0 ? ` · 이전 당첨 제외 ${excludedCount}명` : ' · 제외된 사람 없음'}
                      {poolLimit > 0 ? ` · 1차 후보 ${candidateParticipants.length}명 사용` : ' · 남은 명단 전체 사용'}
                    </small>
                  </div>
                  <div className="round-setup__candidate-actions">
                    {excludedCount > 0 && onRestoreExcluded && (
                      <button type="button" disabled={disabled} onClick={onRestoreExcluded}>
                        제외 {excludedCount}명 모두 복귀
                      </button>
                    )}
                    <button type="button" className="round-setup__quiet-button" disabled={disabled} onClick={onEditRoster}>
                      원본 명단 편집
                    </button>
                  </div>
                </div>

                {!isBlocked && (
                  <details className="round-setup__candidate-advanced" open={poolLimit > 0 || undefined}>
                  <summary>
                    <span>1차 후보 무작위 추리기</span>
                    <em>{poolLimit > 0 ? `${candidateParticipants.length}명 사용 중` : '고급 설정'}</em>
                  </summary>
                  <div className="round-setup__candidate-advanced-body">
                    <p>실제 룰렛을 돌리기 전에 현재 후보 중 일부만 무작위로 골라 원판에 올립니다.</p>
                    <div className="round-setup__segmented" role="group" aria-label="1차 후보 범위">
                      <button type="button" aria-pressed={poolLimit === 0} disabled={disabled} onClick={() => onPoolLimitChange(0)}>
                        남은 후보 전체
                      </button>
                      <button
                        type="button"
                        aria-pressed={poolLimit > 0}
                        disabled={disabled || eligibleParticipants.length === 0}
                        onClick={() => onPoolLimitChange(Math.max(1, sampleSize))}
                      >
                        일부만 무작위로 추리기
                      </button>
                    </div>

                    {poolLimit > 0 && (
                      <div className="round-setup__sample">
                        <label htmlFor={sampleInputId}>원판에 올릴 후보</label>
                        <span className="round-setup__number-box">
                          <input
                            id={sampleInputId}
                            type="number"
                            min="1"
                            max={eligibleParticipants.length}
                            value={Math.min(poolLimit, Math.max(1, eligibleParticipants.length))}
                            disabled={disabled}
                            onChange={(event) => onPoolLimitChange(clampWholeNumber(Number(event.target.value), 1, eligibleParticipants.length))}
                          />
                          <em>명</em>
                        </span>
                        <button type="button" disabled={disabled || poolLimit === 0} onClick={onReshufflePool}>다시 무작위 선택</button>
                        <p>
                          {candidateParticipants.slice(0, 8).map((participant) => participant.name).join(' · ')}
                          {candidateParticipants.length > 8 ? ` 외 ${candidateParticipants.length - 8}명` : ''}
                        </p>
                      </div>
                    )}
                  </div>
                  </details>
                )}
              </section>
            </>
          ) : (
            <section className="round-setup__candidate-card" aria-labelledby="round-setup-recipient-title">
              <div className="round-setup__candidate-main">
                <div>
                  <p>상품을 받을 사람</p>
                  <h3 id="round-setup-recipient-title">{recipient.trim() || '받을 사람을 정하지 않았어요'}</h3>
                  <small>이름은 선택 사항입니다. 비워 두면 상품만 뽑습니다.</small>
                </div>
              </div>
              <label className="round-setup__text-field round-setup__text-field--recipient">
                <span>받을 사람 <em>선택</em></span>
                <input
                  value={recipient}
                  maxLength={40}
                  disabled={disabled}
                  placeholder="예: 첫 번째 당첨자 티얀키"
                  onChange={(event) => onRecipientChange(event.target.value)}
                />
              </label>
            </section>
          )}
        </li>

        {isBlocked ? (
          <li className="round-setup__step round-setup__step--blocked">
            {renderRecoveryCard()}
          </li>
        ) : (
          <>
        <li className="round-setup__step">
          <StepHeading
            number={2}
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
            number={3}
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
            number={4}
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
          <details className="round-setup__display-options">
            <summary>방송 화면에 붙일 제목 <span>선택</span></summary>
            <p>선물 이름과 별개인 방송용 문구입니다. 비워도 진행할 수 있습니다.</p>
            <label className="round-setup__text-field">
              <span>방송 표시 제목</span>
              <input value={drawLabel} maxLength={40} disabled={disabled} placeholder="예: 오늘의 버거 3명 추첨" onChange={(event) => onDrawLabelChange(event.target.value)} />
            </label>
          </details>
        </li>
          </>
        )}
      </ol>
    </section>
  );
}
