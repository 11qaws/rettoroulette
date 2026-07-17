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
  createdAt: string;
  /** Groups individual animation results from one multi-winner draw. */
  roundId?: string;
  /** One-based order within a multi-winner draw. */
  roundOrder?: number;
  mode: DrawMode;
  /** Present for wheel draws so the history can explain the on-air reveal. */
  presentation?: WheelPresentation;
  target: DrawTarget;
  winner: string;
  prize?: string;
  recipient?: string;
}
