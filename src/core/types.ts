/** Replay event for deterministic replay and analysis */
export interface ReplayEvent {
  turn: number;
  player: 1 | 2;
  action: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/** Serialized game result for analytics */
export interface GameResult {
  gameId: string;
  seed: number;
  deckA: string;
  deckB: string;
  winner: 1 | 2 | 'draw';
  turns: number;
  events: ReplayEvent[];
  startedAt: number;
  finishedAt: number;
}

/** Card category as used in metadata */
export type CardCategory = 'LEADER' | 'CHARACTER' | 'EVENT' | 'STAGE' | '-';

/** Minimal card info from metadata */
export interface CardMeta {
  'Card ID': string;
  Rarity: string;
  Category: CardCategory;
  Name: string;
  Life: string;
  Attribute: string;
  Power: string;
  Cost: string;
  Counter: string;
  Color: string;
  Type: string;
  Effect: string;
  Trigger: string;
  'Card Set(s)': string;
  'Alternate Art'?: string;
}

export enum CardColor {
  RED = 'r',
  BLUE = 'blu',
  GREEN = 'g',
  YELLOW = 'y',
  PURPLE = 'p',
  BLACK = 'bla',
  WHITE = 'w',
}
