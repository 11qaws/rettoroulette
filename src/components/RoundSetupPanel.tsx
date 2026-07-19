import { useId, useState } from 'react';

import type { DrawTarget, Participant, Prize, WheelPresentation } from '../types';
import PrizeEditor from './PrizeEditor';
import './RoundSetupPanel.css';

type PrizePatch = Partial<Pick<Prize, 'name' | 'quantity'>>;
type PresentationChoice = WheelPresentation;

export interface RoundSetupPanelProps {
  target: DrawTarget;
  wheelPresentation: WheelPresentation;
  participantTotal: number;
  eligibleParticipants: Participant[];
  candidateParticipants: Participant[];
  drawOptionCount: number;
  excludedCount: number;
  poolLimit: number;
  winnerCount: number;
  maximumWinnerCount: number;
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

export default function RoundSetupPanel({
  target,
  wheelPresentation,
  participantTotal,
  eligibleParticipants,
  candidateParticipants,
  drawOptionCount,
  excludedCount,
  poolLimit,
  winnerCount,
  maximumWinnerCount,
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
  const poolInputId = useId();
  const countUnit = target === 'people' ? '명' : '개';
  const presentationChoice: PresentationChoice = wheelPresentation;
  const validPrizes = prizes.filter((prize) => prize.name.trim() && prize.quantity > 0);
  const validPrizeInventory = validPrizes.reduce((sum, prize) => sum + Math.max(0, prize.quantity), 0);
  const sourceValue = target === 'people'
    ? participantTotal === 0
      ? '명단 없음'
      : `${participantTotal}명${excludedCount > 0 ? ` · ${excludedCount}명 제외` : ''}`
    : validPrizes.length === 0
      ? '상품 없음'
      : `${validPrizes.length}종 · 재고 ${validPrizeInventory}개`;
  const maximumForInput = Math.max(1, maximumWinnerCount);
  const poolSampleSize = poolLimit > 0 ? poolLimit : Math.min(10, eligibleParticipants.length);
  const extraSettingCount = [
    poolLimit > 0,
    target === 'people' ? Boolean(rewardLabel.trim()) : Boolean(recipient.trim()),
    Boolean(drawLabel.trim()),
  ].filter(Boolean).length;
  const [advancedOpen, setAdvancedOpen] = useState(
    useWeights || poolLimit > 0 || Boolean(rewardLabel.trim() || recipient.trim() || drawLabel.trim()),
  );

  return (
    <section className="round-setup round-setup--compact" aria-label="추첨 설정">
      <div className="round-setup__row round-setup__row--target">
        <span className="round-setup__label">추첨 대상</span>
        <div className="round-setup__segmented" role="group" aria-label="추첨 대상">
          <button type="button" aria-pressed={target === 'people'} disabled={disabled} onClick={() => onTargetChange('people')}>
            <span aria-hidden="true">👤</span> 당첨자
          </button>
          <button type="button" aria-pressed={target === 'prizes'} disabled={disabled} onClick={() => onTargetChange('prizes')}>
            <span aria-hidden="true">🎁</span> 상품
          </button>
        </div>
      </div>

      <div className="round-setup__row round-setup__row--source">
        <span className="round-setup__label">{target === 'people' ? '명단' : '상품'}</span>
        <div className="round-setup__source-summary">
          <strong>{sourceValue}</strong>
          {target === 'people' && drawOptionCount > 0 && drawOptionCount !== participantTotal && (
            <span>추첨 가능 {drawOptionCount}명</span>
          )}
        </div>
        {target === 'people' ? (
          <div className="round-setup__source-actions">
            {excludedCount > 0 && onRestoreExcluded && (
              <button type="button" disabled={disabled} onClick={onRestoreExcluded}>{excludedCount}명 복귀</button>
            )}
            <button
              type="button"
              className={participantTotal === 0 ? 'is-primary' : undefined}
              disabled={disabled}
              onClick={onEditRoster}
            >{participantTotal === 0 ? '명단 추가' : '편집'}</button>
          </div>
        ) : null}
      </div>

      {target === 'prizes' && (
        <div className="round-setup__prizes">
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
        </div>
      )}

      <div className="round-setup__row round-setup__row--count">
        <label className="round-setup__label" htmlFor={countInputId}>당첨 {target === 'people' ? '인원' : '수량'}</label>
        <div className="round-setup__count-control">
          <button
            type="button"
            aria-label={`${countUnit} 수 줄이기`}
            disabled={disabled || maximumWinnerCount === 0 || winnerCount <= 1}
            onClick={() => onWinnerCountChange(winnerCount - 1)}
          >−</button>
          <input
            id={countInputId}
            type="number"
            min="1"
            max={maximumForInput}
            value={maximumWinnerCount === 0 ? '' : Math.max(1, winnerCount)}
            placeholder="—"
            disabled={disabled || maximumWinnerCount === 0}
            onChange={(event) => onWinnerCountChange(clampWholeNumber(Number(event.target.value), 1, maximumForInput))}
          />
          <span>{countUnit}</span>
          <button
            type="button"
            aria-label={`${countUnit} 수 늘리기`}
            disabled={disabled || maximumWinnerCount === 0 || winnerCount >= maximumWinnerCount}
            onClick={() => onWinnerCountChange(winnerCount + 1)}
          >＋</button>
        </div>
      </div>

      <div className="round-setup__row round-setup__row--presentation">
        <span className="round-setup__label">연출</span>
        <div className="round-setup__segmented" role="group" aria-label="방송 연출">
          <button type="button" aria-pressed={presentationChoice === 'spin'} disabled={disabled} onClick={() => onPresentationChange('spin')}>
            <span aria-hidden="true">↻</span> 회전 룰렛
          </button>
          <button type="button" aria-pressed={presentationChoice === 'dart'} disabled={disabled} onClick={() => onPresentationChange('dart')}>
            <span aria-hidden="true">➶</span> 다트 복권
          </button>
        </div>
      </div>

      <details
        className="round-setup__advanced"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>
          <span>세부 설정</span>
          <em>
            {useWeights ? '확률 지정' : '동일 확률'}
            {' · '}
            {target === 'people' ? removeAfterDraw ? '당첨 후 제외' : '중복 허용' : '재고 차감'}
            {extraSettingCount > 0 ? ` · 추가 ${extraSettingCount}` : ''}
          </em>
        </summary>
        <div className="round-setup__advanced-body">
          <section className="round-setup__advanced-rules" aria-label="추첨 규칙">
            <div className="round-setup__segmented" role="group" aria-label="확률">
              <button type="button" aria-pressed={!useWeights} disabled={disabled} onClick={() => onUseWeightsChange(false)}>동일 확률</button>
              <button type="button" aria-pressed={useWeights} disabled={disabled} onClick={() => onUseWeightsChange(true)}>직접 지정</button>
            </div>
            {target === 'people' ? (
              <div className="round-setup__segmented" role="group" aria-label="중복 당첨 규칙">
                <button type="button" aria-pressed={removeAfterDraw} disabled={disabled} onClick={() => onRemoveAfterDrawChange(true)}>당첨 후 제외</button>
                <button type="button" aria-pressed={!removeAfterDraw} disabled={disabled} onClick={() => onRemoveAfterDrawChange(false)}>중복 허용</button>
              </div>
            ) : (
              <span className="round-setup__fixed-rule">당첨 상품 재고 차감</span>
            )}
          </section>

          {target === 'people' ? (
            <label className="round-setup__field">
              <span>상품명 <em>선택</em></span>
              <input value={rewardLabel} maxLength={40} disabled={disabled} placeholder="예: 치킨 기프티콘" onChange={(event) => onRewardLabelChange(event.target.value)} />
            </label>
          ) : (
            <label className="round-setup__field">
              <span>받을 사람 <em>선택</em></span>
              <input value={recipient} maxLength={40} disabled={disabled} placeholder="예: 첫 번째 당첨자" onChange={(event) => onRecipientChange(event.target.value)} />
            </label>
          )}

          <label className="round-setup__field">
            <span>방송 제목 <em>선택</em></span>
            <input value={drawLabel} maxLength={50} disabled={disabled} placeholder="예: 오늘의 버거 3명 추첨" onChange={(event) => onDrawLabelChange(event.target.value)} />
          </label>

          {target === 'people' && eligibleParticipants.length > 0 && (
            <section className="round-setup__pool" aria-label="후보 범위">
              <header><strong>후보 범위</strong><span>{poolLimit > 0 ? `${candidateParticipants.length}명 무작위 선택` : '남은 명단 전체'}</span></header>
              <div className="round-setup__segmented">
                <button type="button" aria-pressed={poolLimit === 0} disabled={disabled} onClick={() => onPoolLimitChange(0)}>전체</button>
                <button type="button" aria-pressed={poolLimit > 0} disabled={disabled} onClick={() => onPoolLimitChange(Math.max(1, poolSampleSize))}>일부</button>
              </div>
              {poolLimit > 0 && (
                <div className="round-setup__pool-count">
                  <label htmlFor={poolInputId}>후보</label>
                  <input
                    id={poolInputId}
                    type="number"
                    min="1"
                    max={eligibleParticipants.length}
                    value={Math.min(poolLimit, Math.max(1, eligibleParticipants.length))}
                    disabled={disabled}
                    onChange={(event) => onPoolLimitChange(clampWholeNumber(Number(event.target.value), 1, eligibleParticipants.length))}
                  />
                  <span>명</span>
                  <button type="button" disabled={disabled} onClick={onReshufflePool}>다시 섞기</button>
                </div>
              )}
            </section>
          )}

          {useWeights && target === 'people' && candidateParticipants.length > 0 && (
            <section className="round-setup__weight-editor" aria-label="참여자별 추첨권">
              <header><strong>참여자별 추첨권</strong><span>0장은 제외</span></header>
              <div>
                {candidateParticipants.map((participant) => (
                  <label key={participant.id}>
                    <span>{participant.name}</span>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={participant.weight}
                      disabled={disabled}
                      aria-label={`${participant.name} 추첨권`}
                      onChange={(event) => onParticipantWeightChange(participant.id, clampWholeNumber(Number(event.target.value), 0, 99))}
                    />
                    <em>장</em>
                  </label>
                ))}
              </div>
            </section>
          )}

          {useWeights && target === 'prizes' && prizes.length > 0 && (
            <section className="round-setup__weight-editor" aria-label="상품별 추첨권">
              <header><strong>상품별 추첨권</strong><span>재고 × 추첨권</span></header>
              <div>
                {prizes.map((prize) => (
                  <label key={prize.id}>
                    <span>{prize.name || '이름 없는 상품'}</span>
                    <input
                      type="number"
                      min="0"
                      max="99"
                      value={prize.weight}
                      disabled={disabled}
                      aria-label={`${prize.name || '상품'} 추첨권`}
                      onChange={(event) => onPrizeWeightChange(prize.id, clampWholeNumber(Number(event.target.value), 0, 99))}
                    />
                    <em>장</em>
                  </label>
                ))}
              </div>
            </section>
          )}
        </div>
      </details>
    </section>
  );
}
