import cardMetadata from '../cards/metadata.json';
import type { CardCategory } from './types';

/**
 * Pure game-logic Card. No rendering, no socket.io.
 * Used by the core game engine and simulation workers.
 */
export class CoreCard {
  id: string;
  objectId = 0;
  name: string;
  life: number;
  cost: number;
  category: CardCategory;
  attribute: string;
  power: number;
  counter: string;
  color: string;
  type: string;
  effect: string;
  trigger: string;
  cardSets: string;

  isResting = false;
  summoningSickness = false;
  isBlocker = false;

  attachedDon: CoreCard[] = [];

  constructor(cardId: string) {
    this.id = cardId;
    const meta = (cardMetadata as Record<string, any>)[cardId];
    if (!meta) {
      throw new Error(`Card ID: ${cardId} does not exist in the metadata`);
    }
    this.name = meta['Name'];
    this.life = parseInt(meta['Life']) || 0;
    this.cost = parseInt(meta['Cost']) || 0;
    this.category = meta['Category'] as CardCategory;
    this.attribute = meta['Attribute'];
    this.power = parseInt(meta['Power']) || 0;
    this.counter = meta['Counter'];
    this.color = meta['Color'];
    this.type = meta['Type'];
    this.effect = meta['Effect'];
    this.trigger = meta['Trigger'];
    this.cardSets = meta['Card Set(s)'];

    this.isBlocker = typeof this.effect === 'string' &&
      this.effect.includes('[Blocker]');
  }

  isCharacterCard(): boolean {
    return this.category === 'CHARACTER';
  }

  isEventCard(): boolean {
    return this.category === 'EVENT';
  }

  isEventCounterCard(): boolean {
    return this.isEventCard() && this.effect.startsWith('[Counter]');
  }

  isLeaderCard(): boolean {
    return this.category === 'LEADER';
  }

  isDonCard(): boolean {
    return this.name === 'Don!!';
  }

  getBaseAttack(): number {
    return this.power;
  }

  calculateBonusAttackFromDon(): number {
    return 1000 * this.attachedDon.length;
  }

  getTotalAttack(): number {
    return this.getBaseAttack() + this.calculateBonusAttackFromDon();
  }

  addDon(card: CoreCard): void {
    this.attachedDon.push(card);
  }

  removeDon(card: CoreCard): void {
    const idx = this.attachedDon.indexOf(card);
    if (idx !== -1) this.attachedDon.splice(idx, 1);
  }

  clearDon(): CoreCard[] {
    const dons = this.attachedDon.slice();
    this.attachedDon = [];
    return dons;
  }
}
