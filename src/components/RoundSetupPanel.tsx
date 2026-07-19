import { useId, useState } from 'react';

import type {
  DrawTarget,
  Participant,
  Prize,
  PrizeRecipientSource,
  WheelPresentation,
} from '../types';
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
  prizes: Prize[];
  rewardLabel: string;
  drawLabel: string;
  prizeRecipientText: string;
  prizeRecipientCount: number;
  assignedPrizeRecipientCount: number;
  prizeRecipientSource: PrizeRecipientSource;
  recentWinnerCount: number;
  recentWinnersAlreadyLoaded: boolean;
  recentWinnerLabel?: string;
  removeAfterDraw: boolean;
  useWeights: boolean;
  disabled?: boolean;
  onTargetChange: (target: DrawTarget) => void;
  onRewardLabelChange: (value: string) => void;
  onDrawLabelChange: (value: string) => void;
  onPrizeRecipientTextChange: (value: string) => void;
  onLoadRecentWinners: () => void;
  onRestartPrizeRecipients: () => void;
  onPoolLimitChange: (value: number) => void;
  onReshufflePool: () => void;
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
  prizes,
  rewardLabel,
  drawLabel,
  prizeRecipientText,
  prizeRecipientCount,
  assignedPrizeRecipientCount,
  prizeRecipientSource,
  recentWinnerCount,
  recentWinnersAlreadyLoaded,
  recentWinnerLabel,
  removeAfterDraw,
  useWeights,
  disabled = false,
  onTargetChange,
  onRewardLabelChange,
  onDrawLabelChange,
  onPrizeRecipientTextChange,
  onLoadRecentWinners,
  onRestartPrizeRecipients,
  onPoolLimitChange,
  onReshufflePool,
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
  const poolInputId = useId();
  const presentationChoice: PresentationChoice = wheelPresentation;
  const sourceValue = participantTotal === 0
    ? '명단 없음'
    : `${participantTotal}명${excludedCount > 0 ? ` · ${excludedCount}명 제외` : ''}`;
  const poolSampleSize = poolLimit > 0 ? poolLimit : Math.min(10, eligibleParticipants.length);
  const extraSettingCount = [
    poolLimit > 0,
    target === 'people' && Boolean(rewardLabel.trim()),
  ].filter(Boolean).length;
  const [advancedOpen, setAdvancedOpen] = useState(
    target === 'people' && (useWeights || poolLimit > 0 || Boolean(rewardLabel.trim())),
  );
  const recipientStatus = prizeRecipientCount === 0
    ? '상품만 추첨'
    : `${prizeRecipientCount}명 · ${prizeRecipientSource === 'linked'
      ? `이전 당첨자 연동${recentWinnerLabel ? ` · ${recentWinnerLabel}` : ''}`
      : '직접 입력'}${assignedPrizeRecipientCount > 0
      ? ` · ${assignedPrizeRecipientCount}/${prizeRecipientCount} 배정 · 명단 잠김`
      : ''}`;
  const recentWinnerAction = recentWinnersAlreadyLoaded
    ? '연동됨'
    : recentWinnerCount === 0
      ? '없음'
      : prizeRecipientCount > 0 ? `${recentWinnerCount}명으로 교체` : `${recentWinnerCount}명 불러오기`;

  return (
    <section className="round-setup round-setup--compact" aria-label="추첨 설정">
      <label className="round-setup__row round-setup__row--title" data-setup-slot="title">
        <span className="round-setup__label">방송 제목</span>
        <input
          value={drawLabel}
          maxLength={50}
          disabled={disabled}
          placeholder="예: 오늘의 선물 추첨"
          aria-label="방송 제목"
          onChange={(event) => onDrawLabelChange(event.target.value)}
        />
      </label>

      <div className="round-setup__row round-setup__row--target" data-setup-slot="target">
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

      <div className="round-setup__row round-setup__row--presentation" data-setup-slot="presentation">
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

      <div
        className={`round-setup__data-slot round-setup__data-slot--${target}`}
        data-setup-slot="data"
        data-setup-data-layout={target === 'people' ? 'span' : 'split'}
      >
        {target === 'people' ? (
          <div className="round-setup__row round-setup__row--source round-setup__row--source-spanning">
            <span className="round-setup__label">명단</span>
            <div className="round-setup__source-summary">
              <strong>{sourceValue}</strong>
              {drawOptionCount > 0 && drawOptionCount !== participantTotal && (
                <span>추첨 가능 {drawOptionCount}명</span>
              )}
            </div>
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
          </div>
        ) : (
          <div className="round-setup__row round-setup__row--source round-setup__row--recipients">
            <span className="round-setup__label">받을 사람</span>
            <label className="round-setup__recipient-entry">
              <textarea
                value={prizeRecipientText}
                rows={2}
                disabled={disabled || assignedPrizeRecipientCount > 0}
                aria-label="상품 받을 사람 명단"
                placeholder="직접 입력 · 한 줄에 한 명"
                onChange={(event) => onPrizeRecipientTextChange(event.target.value)}
              />
              <span>{recipientStatus}</span>
            </label>
            <div className="round-setup__source-actions round-setup__recipient-actions">
              <button
                type="button"
                disabled={disabled || assignedPrizeRecipientCount > 0 || recentWinnerCount === 0 || recentWinnersAlreadyLoaded}
                title={recentWinnerCount > 0 ? `${recentWinnerLabel ?? '최근 당첨자 추첨'} · ${recentWinnerCount}명` : undefined}
                onClick={onLoadRecentWinners}
              >
                <span>이전 당첨자</span>
                <strong>{recentWinnerAction}</strong>
              </button>
              {assignedPrizeRecipientCount > 0 && assignedPrizeRecipientCount < prizeRecipientCount && (
                <button type="button" disabled={disabled} onClick={onRestartPrizeRecipients}>같은 명단으로 새 배정</button>
              )}
            </div>
          </div>
        )}

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
      </div>

      <details
        className="round-setup__advanced"
        data-setup-slot="advanced"
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen(event.currentTarget.open)}
      >
        <summary>
          <span>세부 설정</span>
          <em>
            {target === 'people' ? useWeights ? '확률 지정' : '동일 확률' : '수량 비율'}
            {' · '}
            {target === 'people' ? removeAfterDraw ? '당첨 후 제외' : '중복 허용' : '재고 차감'}
            {extraSettingCount > 0 ? ` · 추가 ${extraSettingCount}` : ''}
          </em>
        </summary>
        <div className="round-setup__advanced-body">
          <section className={`round-setup__advanced-rules${target === 'prizes' ? ' round-setup__advanced-rules--prizes' : ''}`} aria-label="추첨 규칙">
            {target === 'people' ? (
              <>
                <div className="round-setup__segmented" role="group" aria-label="확률">
                  <button type="button" aria-pressed={!useWeights} disabled={disabled} onClick={() => onUseWeightsChange(false)}>동일 확률</button>
                  <button type="button" aria-pressed={useWeights} disabled={disabled} onClick={() => onUseWeightsChange(true)}>직접 지정</button>
                </div>
                <div className="round-setup__segmented" role="group" aria-label="중복 당첨 규칙">
                  <button type="button" aria-pressed={removeAfterDraw} disabled={disabled} onClick={() => onRemoveAfterDrawChange(true)}>당첨 후 제외</button>
                  <button type="button" aria-pressed={!removeAfterDraw} disabled={disabled} onClick={() => onRemoveAfterDrawChange(false)}>중복 허용</button>
                </div>
              </>
            ) : (
              <>
                <span className="round-setup__fixed-rule">상품 종류마다 원판 한 구역</span>
                <span className="round-setup__fixed-rule">3개 : 2개 → 칸 넓이 3 : 2</span>
              </>
            )}
          </section>

          {target === 'people' && (
            <label className="round-setup__field">
              <span>상품명 <em>선택</em></span>
              <input value={rewardLabel} maxLength={40} disabled={disabled} placeholder="예: 치킨 기프티콘" onChange={(event) => onRewardLabelChange(event.target.value)} />
            </label>
          )}

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
        </div>
      </details>
    </section>
  );
}
