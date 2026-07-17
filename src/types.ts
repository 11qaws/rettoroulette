export type DrawMode = 'wheel' | 'marble';
export type DrawTarget = 'people' | 'prizes';

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
  target: DrawTarget;
  winner: string;
  prize?: string;
  recipient?: string;
}
