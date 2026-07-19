import { useId } from 'react';

import type { Prize } from '../types';

import './PrizeEditor.css';

type PrizePatch = Partial<Pick<Prize, 'name' | 'quantity'>>;

export interface PrizeEditorProps {
  prizes: Prize[];
  /** Shows a per-product draw-ticket field when weighted drawing is enabled. */
  useWeights: boolean;
  /** Keeps probability editing beside the probability rule when false. */
  showWeightFields?: boolean;
  disabled?: boolean;
  className?: string;
  onAdd: () => void;
  onUpdate: (id: string, patch: PrizePatch) => void;
  onWeightChange: (id: string, weight: number) => void;
  onRemove: (id: string, name: string) => void;
}

function clampWholeNumber(value: string, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

export default function PrizeEditor({
  prizes,
  useWeights,
  showWeightFields = useWeights,
  disabled = false,
  className = '',
  onAdd,
  onUpdate,
  onWeightChange,
  onRemove,
}: PrizeEditorProps) {
  const headingId = useId();
  const weightHelpId = useId();
  const totalQuantity = prizes.reduce((total, prize) => total + Math.max(0, prize.quantity), 0);
  const productTypeCount = new Set(
    prizes
      .filter((prize) => prize.quantity > 0)
      .map((prize) => prize.name.trim())
      .filter(Boolean)
      .map((name) => name.normalize('NFKC').toLocaleLowerCase('ko-KR')),
  ).size;
  const drawableQuantity = prizes.reduce((total, prize) => {
    if (!prize.name.trim() || prize.quantity <= 0 || (useWeights && prize.weight <= 0)) return total;
    return total + prize.quantity;
  }, 0);

  return (
    <section
      className={`prize-editor${disabled ? ' is-disabled' : ''}${className ? ` ${className}` : ''}`}
      aria-labelledby={headingId}
    >
      <header className="prize-editor__header">
        <div>
          <p className="prize-editor__eyebrow">상품 명단</p>
          <h3 id={headingId}>추첨할 상품</h3>
          <p className="prize-editor__summary">
            {prizes.length > 0
              ? `${productTypeCount}종 · 총 ${totalQuantity}개${drawableQuantity !== totalQuantity ? ` · 추첨 가능 ${drawableQuantity}개` : ''}`
              : '상품을 추가하면 바로 룰렛 후보가 됩니다.'}
          </p>
        </div>
        {prizes.length > 0 && (
          <button className="prize-editor__add" type="button" disabled={disabled} onClick={onAdd}>
            <span aria-hidden="true">＋</span> 상품 추가
          </button>
        )}
      </header>

      {prizes.length === 0 ? (
        <div className="prize-editor__empty">
          <span className="prize-editor__empty-icon" aria-hidden="true">🎁</span>
          <div>
            <strong>아직 추첨할 상품이 없어요</strong>
            <p>상품 이름과 수량만 넣으면 준비가 끝납니다.</p>
          </div>
          <button type="button" disabled={disabled} onClick={onAdd}>
            첫 상품 추가
          </button>
        </div>
      ) : (
        <ol className="prize-editor__list">
          {prizes.map((prize, index) => {
            const unavailable = !prize.name.trim() || prize.quantity <= 0 || (useWeights && prize.weight <= 0);
            const displayName = prize.name.trim() || `${index + 1}번 상품`;

            return (
              <li className={unavailable ? 'is-unavailable' : ''} key={prize.id}>
                <span className="prize-editor__number" aria-hidden="true">{index + 1}</span>
                <label className="prize-editor__name">
                  <span>상품 이름</span>
                  <input
                    type="text"
                    value={prize.name}
                    maxLength={60}
                    disabled={disabled}
                    aria-label={`${index + 1}번 상품 이름`}
                    placeholder="예: 치킨 기프티콘"
                    onChange={(event) => onUpdate(prize.id, { name: event.target.value })}
                  />
                </label>

                <label className="prize-editor__number-field">
                  <span>수량</span>
                  <span className="prize-editor__number-control">
                    <input
                      type="number"
                      min="0"
                      max="999"
                      inputMode="numeric"
                      value={prize.quantity}
                      disabled={disabled}
                      aria-label={`${displayName} 수량`}
                      onChange={(event) => onUpdate(prize.id, {
                        quantity: clampWholeNumber(event.target.value, 0, 999),
                      })}
                    />
                    <em>개</em>
                  </span>
                </label>

                {useWeights && showWeightFields && (
                  <label className="prize-editor__number-field">
                    <span>
                      확률 배수
                      <small>유효 {Math.max(0, prize.quantity) * Math.max(0, prize.weight)}장</small>
                    </span>
                    <span className="prize-editor__number-control">
                      <input
                        type="number"
                        min="0"
                        max="99"
                        inputMode="numeric"
                        value={prize.weight}
                        disabled={disabled}
                        aria-label={`${displayName} 추첨권`}
                        aria-describedby={weightHelpId}
                        onChange={(event) => onWeightChange(
                          prize.id,
                          clampWholeNumber(event.target.value, 0, 99),
                        )}
                      />
                      <em>장</em>
                    </span>
                  </label>
                )}

                <button
                  className="prize-editor__remove"
                  type="button"
                  disabled={disabled}
                  aria-label={`${displayName} 삭제`}
                  title="상품 삭제"
                  onClick={() => onRemove(prize.id, displayName)}
                >
                  <span aria-hidden="true">×</span>
                </button>

                {unavailable && (
                  <small className="prize-editor__row-status">
                    {!prize.name.trim()
                      ? '상품 이름을 입력해 주세요.'
                      : prize.quantity <= 0
                        ? '수량이 0개라 이번 추첨에서 빠집니다.'
                        : '추첨권이 0장이라 이번 추첨에서 빠집니다.'}
                  </small>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {useWeights && showWeightFields && prizes.length > 0 && (
        <p className="prize-editor__weight-help" id={weightHelpId}>
          추첨권이 많을수록 당첨 확률이 커집니다. 0장은 이번 추첨에서 제외됩니다.
        </p>
      )}
    </section>
  );
}
