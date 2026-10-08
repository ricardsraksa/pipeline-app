// Import list order and provisional P numbers. Pure.
//
// Priority items first, then oldest first. Open items are numbered
// base+1, base+2, … in that order; starting any item takes base+1, so P
// numbers follow the order runs are started in.

export type OpenItem = { id: number; priority: boolean; createdAt: string };

export function orderItems<T extends OpenItem>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    Number(b.priority) - Number(a.priority)
    || (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0)
    || a.id - b.id);
}

/** id → provisional code, e.g. base 91 → P92, P93, … */
export function assignCodes(base: number, items: OpenItem[]): Map<number, string> {
  return new Map(orderItems(items).map((it, i) => [it.id, `P${base + i + 1}`]));
}

/** The code a run gets when it is started, whichever row it was. */
export function codeForStart(base: number): string {
  return `P${base + 1}`;
}
