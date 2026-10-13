import type { Kit } from "./types";

export type ItemUsage = { sku: string; qty: number };

export function buildItemUsageIndex(kits: Kit[]): Map<string, ItemUsage[]> {
  const totals = new Map<string, Map<string, number>>();
  for (const kit of kits) {
    for (const line of kit.lines) {
      const bySku = totals.get(line.componentItemId) ?? new Map<string, number>();
      bySku.set(kit.sku, (bySku.get(kit.sku) ?? 0) + line.qty);
      totals.set(line.componentItemId, bySku);
    }
  }
  return new Map([...totals].map(([id, bySku]) => [
    id,
    [...bySku].map(([sku, qty]) => ({ sku, qty })).sort((a, b) => a.sku.localeCompare(b.sku, "ru")),
  ]));
}
