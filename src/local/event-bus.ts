/**
 * Simple typed event emitter for browser use.
 * Replaces socket.io Socket interface for local play.
 */
export class EventBus {
  private listeners = new Map<string, Set<(...args: any[]) => void>>();
  private onceListeners = new Map<string, Set<(...args: any[]) => void>>();

  on(event: string, callback: (...args: any[]) => void): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(callback);
    return this;
  }

  once(event: string, callback: (...args: any[]) => void): this {
    if (!this.onceListeners.has(event)) this.onceListeners.set(event, new Set());
    this.onceListeners.get(event)!.add(callback);
    return this;
  }

  off(event: string, callback?: (...args: any[]) => void): this {
    if (callback) {
      this.listeners.get(event)?.delete(callback);
      this.onceListeners.get(event)?.delete(callback);
    } else {
      this.listeners.delete(event);
      this.onceListeners.delete(event);
    }
    return this;
  }

  emit(event: string, ...args: any[]): this {
    this.listeners.get(event)?.forEach(cb => cb(...args));
    const once = this.onceListeners.get(event);
    if (once) {
      once.forEach(cb => cb(...args));
      once.clear();
    }
    return this;
  }

  removeAllListeners(): this {
    this.listeners.clear();
    this.onceListeners.clear();
    return this;
  }
}
