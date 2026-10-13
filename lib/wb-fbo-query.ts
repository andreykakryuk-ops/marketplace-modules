import { moscowDateShift } from "@/lib/format";

export const WB_FBO_LIST_LIMIT = 1000;
export const WB_FBO_LIST_STATUSES = [2, 3, 4];

export type WbFboDateFilterType = "createDate" | "supplyDate";

export type WbFboDateFilter = {
  from: string;
  till: string;
  type: WbFboDateFilterType;
};

/** Окна дат для списка поставок: создание и плановая отгрузка, чтобы не терять новые черновики. */
export function wbFboListDateFilters(now = new Date()): WbFboDateFilter[] {
  return [
    { from: moscowDateShift(-90, now), till: moscowDateShift(1, now), type: "createDate" },
    { from: moscowDateShift(-14, now), till: moscowDateShift(60, now), type: "supplyDate" },
  ];
}

export function wbFboSupplyIdentity(raw: { supplyID?: unknown; preorderID?: unknown }) {
  const supplyId = Math.round(Number(raw.supplyID));
  if (Number.isFinite(supplyId) && supplyId > 0) return { id: supplyId, isPreorder: false };
  const preorderId = Math.round(Number(raw.preorderID));
  if (Number.isFinite(preorderId) && preorderId > 0) return { id: preorderId, isPreorder: true };
  return null;
}

export function mergeWbFboSupplyRows<T extends { supplyID?: unknown; preorderID?: unknown }>(pages: T[][]) {
  const map = new Map<string, T>();
  for (const page of pages) {
    for (const row of page) {
      const identity = wbFboSupplyIdentity(row);
      if (!identity) continue;
      map.set(`${identity.isPreorder ? "p" : "s"}:${identity.id}`, row);
    }
  }
  return [...map.values()];
}
