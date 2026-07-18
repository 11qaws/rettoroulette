export type DrawMode = 'wheel' | 'marble';
export type DrawTarget = 'people' | 'prizes';
/** How a wheel result is revealed. It never changes the draw result itself. */
export type WheelPresentation = 'spin' | 'dart';

export interface Participant {
  id: string;
  name: string;
  weight: number;
  commentCount?: number;
}

export interface Prize {
  id: string;
  name: string;
  quantity: number;
  weight: number;
}

export interface DrawRecord {
  id: string;
  /** Selection time, fixed at the button press that committed this result. */
  createdAt: string;
  /** Optional on-air reveal time after the wheel or dart animation finishes. */
  revealedAt?: string;
  /** Groups individual animation results from one multi-winner draw. */
  roundId?: string;
  /** Optional on-air context, for example "버거 3명 추첨". */
  roundLabel?: string;
  /** One-based order within a multi-winner draw. */
  roundOrder?: number;
  mode: DrawMode;
  /** Present for wheel draws so the history can explain the on-air reveal. */
  presentation?: WheelPresentation;
  /** Snapshot of the eligible display candidates when this result was started. */
  candidateCount?: number;
  /** Stable compact audit marker for the exact candidate ids/names/weights. */
  candidateFingerprint?: string;
  /** Sum of the effective weights in that candidate snapshot. */
  candidateTotalWeight?: number;
  /** Kept with the record so older results do not inherit a later rule change. */
  useWeights?: boolean;
  /** Whether this winner was removed from later participant draws. */
  removeAfterDraw?: boolean;
  target: DrawTarget;
  winner: string;
  /** Original configured prize row when the target is a product. */
  prizeId?: string;
  /** Individual inventory unit consumed by a product draw. */
  prizeUnitId?: string;
  prize?: string;
  recipient?: string;
}
