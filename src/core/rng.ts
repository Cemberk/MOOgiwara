/**
 * Seedable pseudo-random number generator (xoshiro128**).
 * Deterministic: same seed always produces the same sequence.
 */
export class SeededRng {
  private s: Uint32Array;

  constructor(seed: number) {
    // SplitMix32 to expand a single seed into 4 state words
    this.s = new Uint32Array(4);
    for (let i = 0; i < 4; i++) {
      seed |= 0;
      seed = (seed + 0x9e3779b9) | 0;
      let t = seed ^ (seed >>> 16);
      t = Math.imul(t, 0x21f0aaad);
      t = t ^ (t >>> 15);
      t = Math.imul(t, 0x735a2d97);
      t = t ^ (t >>> 15);
      this.s[i] = t >>> 0;
    }
  }

  /** Returns a float in [0, 1) */
  next(): number {
    return this.nextUint32() / 0x100000000;
  }

  /** Returns an integer in [0, max) */
  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  /** Shuffle an array in-place (Fisher-Yates) */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  private nextUint32(): number {
    const s = this.s;
    const result = Math.imul(s[1] * 5, 1 << 7 | 1 >>> 25) * 9;
    const t = s[1] << 9;
    s[2] ^= s[0];
    s[3] ^= s[1];
    s[1] ^= s[2];
    s[0] ^= s[3];
    s[2] ^= t;
    s[3] = (s[3] << 11) | (s[3] >>> 21);
    return (result >>> 0);
  }
}

/** Create a seed from a string (simple hash) */
export function seedFromString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}
