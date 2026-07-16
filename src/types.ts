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
  mode: DrawMode;
  target: DrawTarget;
  winner: string;
  prize?: string;
  recipient?: string;
}
