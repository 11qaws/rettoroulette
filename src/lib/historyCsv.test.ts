import { describe, expect, it } from 'vitest';

import type { DrawRecord } from '../types';
import { buildHistoryCsvRows, HISTORY_CSV_HEADER } from './historyCsv';

describe('history CSV compatibility', () => {
  it('keeps every legacy column in place and appends recipient audit fields', () => {
    const record: DrawRecord = {
      id: 'product-result',
      sessionId: 'product-session',
      createdAt: '2026-07-20T00:00:00.000Z',
      mode: 'wheel',
      presentation: 'dart',
      target: 'prizes',
      winner: '케이크',
      recipient: '아모레또',
      recipientId: 'winner-people-result',
      prizeId: 'cake',
      prizeUnitId: 'cake::round',
      prizeProbabilityModel: 'quantity-ratio',
      prizeAssignmentBatchId: 'assignment-1',
      candidateCount: 2,
      candidateTotalWeight: 5,
      useWeights: false,
    };

    expect(HISTORY_CSV_HEADER.slice(0, 17)).toEqual([
      '선정 시각', '공개 시각', '방송 세션 ID', '회차 제목', '선물·이벤트',
      '모드', '연출', '추첨 대상', '결과', '수령자', '상품 원본 ID',
      '상품 재고 단위 ID', '후보 수', '후보 지문', '추첨권 합계', '가중치', '중복 정책',
    ]);
    expect(HISTORY_CSV_HEADER.slice(17)).toEqual(['수령자 슬롯 ID', '상품 확률 모델', '상품 배정 차수 ID']);

    const row = buildHistoryCsvRows([record])[0];
    expect(row[9]).toBe('아모레또');
    expect(row[10]).toBe('cake');
    expect(row[11]).toBe('cake::round');
    expect(row[17]).toBe('winner-people-result');
    expect(row[18]).toBe('quantity-ratio');
    expect(row[19]).toBe('assignment-1');
  });
});
