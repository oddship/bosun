/**
 * Simple stack implementation.
 */

export class Stack<T> {
  private items: T[] = [];

  push(item: T): void {
    this.items.push(item);
  }

  pop(): T {
    // BUG: doesn't check if stack is empty — returns undefined as T
    return this.items.pop() as T;
  }

  peek(): T {
    // BUG: same issue — no empty check
    return this.items[this.items.length - 1];
  }

  get size(): number {
    return this.items.length;
  }

  isEmpty(): boolean {
    return this.items.length === 0;
  }
}
