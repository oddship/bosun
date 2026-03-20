/**
 * Simple typed event emitter.
 */

type Listener = (...args: any[]) => void;

export class EventEmitter {
  private listeners: Map<string, Listener[]> = new Map();

  on(event: string, listener: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  emit(event: string, ...args: any[]): void {
    const list = this.listeners.get(event) ?? [];
    for (const listener of list) {
      listener(...args);
    }
  }

  off(event: string, listener: Listener): void {
    const list = this.listeners.get(event) ?? [];
    this.listeners.set(
      event,
      list.filter((l) => l !== listener),
    );
  }
}
