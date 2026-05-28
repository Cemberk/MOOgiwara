import { CoreCard } from './card';
import { SeededRng } from './rng';

/**
 * A list of cards — replaces the server's SyncCardList.
 * Pure logic, no network sync.
 */
export class CardList {
  readonly zone: string;
  private _cards: CoreCard[] = [];

  constructor(zone: string, cardIds: string[] = []) {
    this.zone = zone;
    for (const id of cardIds) {
      this._cards.push(new CoreCard(id));
    }
  }

  push(card: CoreCard): void {
    this._cards.push(card);
  }

  pop(): CoreCard | undefined {
    return this._cards.pop();
  }

  popTop(): CoreCard {
    if (this._cards.length === 0) throw new Error(`Cannot pop from empty ${this.zone}`);
    return this._cards.splice(0, 1)[0];
  }

  pushToFront(card: CoreCard): void {
    this._cards.unshift(card);
  }

  removeAt(index: number): CoreCard {
    if (index < 0 || index >= this._cards.length) {
      throw new Error(`Index ${index} out of bounds for ${this.zone}`);
    }
    return this._cards.splice(index, 1)[0];
  }

  remove(card: CoreCard): CoreCard | undefined {
    const idx = this._cards.indexOf(card);
    if (idx !== -1) {
      return this._cards.splice(idx, 1)[0];
    }
    return undefined;
  }

  insertAt(index: number, card: CoreCard): void {
    this._cards.splice(index, 0, card);
  }

  get(index: number): CoreCard | undefined {
    return this._cards[index];
  }

  getByObjectId(objectId: number): CoreCard | undefined {
    return this._cards.find(c => c.objectId === objectId);
  }

  size(): number {
    return this._cards.length;
  }

  isEmpty(): boolean {
    return this._cards.length === 0;
  }

  clear(): void {
    this._cards = [];
  }

  list(): CoreCard[] {
    return this._cards;
  }

  shuffle(rng: SeededRng): void {
    rng.shuffle(this._cards);
  }

  toIds(): string[] {
    return this._cards.map(c => c.id);
  }
}
