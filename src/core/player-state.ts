import { CoreCard } from './card';
import { CardList } from './card-list';
import { SeededRng } from './rng';

/**
 * Pure game-logic player state. No socket, no rendering.
 * Mirrors the server Player's game state and actions.
 */
export class CorePlayer {
  readonly index: 1 | 2;
  username: string;

  leader: CoreCard | undefined;
  deck: CardList;
  hand: CardList;
  lifeCards: CardList;
  characterArea: CardList;
  donDeck: CardList;
  donArea: CardList;
  trash: CardList;

  boardReady = false;
  mulligan = false;

  constructor(index: 1 | 2, username: string, deckList: string[]) {
    this.index = index;
    this.username = username;

    // Find and extract the leader card
    const deckCopy = [...deckList];
    let leaderIdx = -1;
    for (let i = 0; i < deckCopy.length; i++) {
      const card = new CoreCard(deckCopy[i]);
      if (card.isLeaderCard()) {
        this.leader = card;
        leaderIdx = i;
        break;
      }
    }
    if (leaderIdx !== -1) {
      deckCopy.splice(leaderIdx, 1);
    }

    this.deck = new CardList('deck', deckCopy);
    this.hand = new CardList('hand');
    this.lifeCards = new CardList('lifeCards');
    this.characterArea = new CardList('characterArea');
    this.donDeck = new CardList('donDeck');
    this.donArea = new CardList('donArea');
    this.trash = new CardList('trash');

    // Initialize 10 Don!! cards
    for (let i = 0; i < 10; i++) {
      this.donDeck.push(new CoreCard('donCardAltArt'));
    }
  }

  drawCard(amount = 1): CoreCard[] {
    const drawn: CoreCard[] = [];
    for (let i = 0; i < amount; i++) {
      if (this.deck.isEmpty()) break;
      const card = this.deck.popTop();
      this.hand.push(card);
      drawn.push(card);
    }
    return drawn;
  }

  drawDon(amount = 1): number {
    let drawn = 0;
    for (let i = 0; i < amount; i++) {
      if (this.donDeck.isEmpty()) break;
      const card = this.donDeck.popTop();
      this.donArea.push(card);
      drawn++;
    }
    return drawn;
  }

  shuffleHandToDeck(rng: SeededRng): void {
    while (!this.hand.isEmpty()) {
      this.deck.push(this.hand.popTop());
    }
    this.deck.shuffle(rng);
  }

  setLifeCards(): void {
    if (!this.leader) return;
    for (let i = 0; i < this.leader.life; i++) {
      if (this.deck.isEmpty()) break;
      this.lifeCards.push(this.deck.popTop());
    }
  }

  getUnrestedDonCount(): number {
    return this.donArea.list().filter(c => !c.isResting).length;
  }

  restDon(amount: number): void {
    let remaining = Math.min(amount, this.getUnrestedDonCount());
    const dons = this.donArea.list();
    for (let i = dons.length - 1; i >= 0 && remaining > 0; i--) {
      if (!dons[i].isResting) {
        dons[i].isResting = true;
        remaining--;
      }
    }
  }

  refreshPhase(): void {
    // Unrest all characters and return attached dons
    for (const card of this.characterArea.list()) {
      card.isResting = false;
      card.summoningSickness = false;
      for (const don of card.clearDon()) {
        this.donArea.push(don);
      }
    }

    // Return leader dons and unrest
    if (this.leader) {
      for (const don of this.leader.clearDon()) {
        this.donArea.push(don);
      }
      this.leader.isResting = false;
    }

    // Unrest all dons
    for (const don of this.donArea.list()) {
      don.isResting = false;
    }
  }

  playCard(cardIndex: number): CoreCard | undefined {
    const card = this.hand.get(cardIndex);
    if (!card) return undefined;
    if (this.getUnrestedDonCount() < card.cost) return undefined;

    this.restDon(card.cost);
    this.hand.remove(card);

    if (card.isCharacterCard()) {
      card.summoningSickness = true;
      this.characterArea.push(card);
    } else {
      // Event card goes to trash
      this.trash.push(card);
    }

    return card;
  }

  attachDon(cardIndex: number): boolean {
    const target = cardIndex === -1 ? this.leader : this.characterArea.get(cardIndex);
    if (!target) return false;
    if (this.donArea.isEmpty()) return false;

    // Find last unrested don
    const dons = this.donArea.list();
    for (let i = dons.length - 1; i >= 0; i--) {
      if (!dons[i].isResting) {
        target.addDon(dons[i]);
        this.donArea.removeAt(i);
        return true;
      }
    }
    return false;
  }

  retireCard(cardInPlayIndex: number, cardInHandIndex: number): boolean {
    if (this.characterArea.size() !== 5) return false;
    const cardInHand = this.hand.get(cardInHandIndex);
    const cardInPlay = this.characterArea.get(cardInPlayIndex);
    if (!cardInHand || !cardInPlay || cardInHand.isEventCard()) return false;

    this.hand.remove(cardInHand);
    this.characterArea.insertAt(cardInPlayIndex, cardInHand);
    this.characterArea.remove(cardInPlay);

    // Return attached dons (rested)
    for (const don of cardInPlay.clearDon()) {
      don.isResting = true;
      this.donArea.push(don);
    }

    this.restDon(cardInHand.cost);
    cardInHand.summoningSickness = true;
    this.trash.push(cardInPlay);
    return true;
  }
}
