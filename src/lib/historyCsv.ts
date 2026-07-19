import type { DrawRecord } from '../types';
import { csvField } from './csv';

/** Existing columns stay fixed; new audit fields are append-only. */
export const HISTORY_CSV_HEADER = [
  '선정 시각',
  '공개 시각',
  '방송 세션 ID',
  '회차 제목',
  '선물·이벤트',
  '모드',
  '연출',
  '추첨 대상',
  '결과',
  '수령자',
  '상품 원본 ID',
  '상품 재고 단위 ID',
  '후보 수',
  '후보 지문',
  '추첨권 합계',
  '가중치',
  '중복 정책',
  '수령자 슬롯 ID',
  '상품 확률 모델',
  '상품 배정 차수 ID',
] as const;

export function buildHistoryCsvRows(history: readonly DrawRecord[]) {
  return history.map((item) => [
    new Date(item.createdAt).toLocaleString('ko-KR'),
    item.revealedAt ? new Date(item.revealedAt).toLocaleString('ko-KR') : '',
    item.sessionId ?? '',
    item.roundLabel ?? '',
    item.rewardLabel ?? '',
    item.mode === 'wheel' ? '룰렛' : '마블',
    item.mode === 'wheel' ? item.presentation === 'dart' ? '다트 복권' : '자동' : '마블',
    item.target === 'people' ? '사람' : '상품',
    item.winner,
    item.recipient ?? '',
    item.prizeId ?? '',
    item.prizeUnitId ?? '',
    String(item.candidateCount ?? ''),
    item.candidateFingerprint ?? '',
    String(item.candidateTotalWeight ?? ''),
    typeof item.useWeights === 'boolean' ? item.useWeights ? '적용' : '동일 확률' : '',
    item.target === 'people'
      ? item.removeAfterDraw === false ? '중복 허용' : '중복 방지'
      : '재고 단위',
    item.recipientId ?? '',
    item.prizeProbabilityModel ?? '',
    item.prizeAssignmentBatchId ?? '',
  ]);
}

export function createHistoryCsv(history: readonly DrawRecord[]) {
  return [HISTORY_CSV_HEADER, ...buildHistoryCsvRows(history)]
    .map((row) => row.map(csvField).join(','))
    .join('\n');
}
