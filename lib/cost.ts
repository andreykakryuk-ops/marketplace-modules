import type { Item } from "@/lib/types";

export function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

export function parseMoney(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return roundMoney(n);
}

/** Последняя закупочная цена; если ещё не было прихода — текущая себес. на складе. */
export function lastBuyPrice(item: Item): number {
  if (item.lastPurchaseCost != null && Number.isFinite(item.lastPurchaseCost) && item.lastPurchaseCost >= 0) {
    return item.lastPurchaseCost;
  }
  if (item.cost != null && Number.isFinite(item.cost) && item.cost >= 0) return item.cost;
  return 0;
}

/** Средневзвешенная себестоимость после прихода партии. */
export function averageCostAfterReceipt(
  onHand: number,
  currentCost: number | null,
  incomingQty: number,
  purchaseCost: number,
): number {
  if (!(incomingQty > 0) || !Number.isFinite(purchaseCost) || purchaseCost < 0) {
    return currentCost ?? purchaseCost;
  }
  const oldQty = Math.max(0, Number.isFinite(onHand) ? onHand : 0);
  if (oldQty <= 0) return roundMoney(purchaseCost);
  const oldCost = currentCost == null || !Number.isFinite(currentCost) ? purchaseCost : currentCost;
  return roundMoney((oldQty * oldCost + incomingQty * purchaseCost) / (oldQty + incomingQty));
}
