/**
 * Shopping cart implementation.
 */

export interface CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
}

export class ShoppingCart {
  private items: CartItem[] = [];

  addItem(item: CartItem): void {
    const existing = this.items.find((i) => i.id === item.id);
    if (existing) {
      // BUG 1: Should add to existing quantity, not replace it
      existing.quantity = item.quantity;
    } else {
      this.items.push(item);
    }
  }

  removeItem(id: string): void {
    // BUG 2: filter keeps items that DON'T match, but the assignment is missing
    this.items.filter((i) => i.id !== id);
  }

  getTotal(): number {
    let total = 0;
    for (const item of this.items) {
      // BUG 3: Missing multiplication by quantity — just sums prices
      total += item.price;
    }
    return total;
  }

  getItems(): CartItem[] {
    return [...this.items];
  }

  clear(): void {
    this.items = [];
  }
}
