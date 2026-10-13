import { moscowDateKey } from "@/lib/format";
import {
  RECEIPT_REASON,
  type AppState,
  type Movement,
  type Receipt,
  type ShipmentDocument,
} from "@/lib/types";

const RECEIPT_CLUSTER_MS = 5000;

export type ReceiptLineView = {
  movementId: string | null;
  itemId: string;
  qty: number;
  purchaseCost: number | null;
  qtyBefore: number;
  qtyAfter: number;
  reversed: boolean;
  averageCostAfter: number | null;
};

export type ReceiptView = {
  id: string;
  at: string;
  userName: string;
  lines: ReceiptLineView[];
};

export type HistoryEntry =
  | { kind: "receipt"; key: string; receipt: ReceiptView }
  | { kind: "shipment"; key: string; shipment: ShipmentDocument }
  | { kind: "movement"; key: string; movement: Movement };

function toReceiptView(stored: Receipt | undefined, related: Movement[]): ReceiptView {
  const first = related[0];
  const id = stored?.id ?? first?.receiptId ?? first?.id ?? "";
  const at = stored?.at ?? first?.at ?? "";
  const userName = stored?.userName ?? first?.userName ?? "";

  if (stored && stored.lines.length > 0) {
    const unused = [...related];
    const lines = stored.lines.map((line) => {
      const index = unused.findIndex(
        (row) => row.itemId === line.itemId && row.qtyBefore === line.qtyBefore && row.delta === line.qty,
      );
      const mov = index >= 0 ? unused.splice(index, 1)[0] : undefined;
      return {
        movementId: mov?.id ?? null,
        itemId: line.itemId,
        qty: line.qty,
        purchaseCost: line.purchaseCost,
        qtyBefore: line.qtyBefore,
        qtyAfter: line.qtyAfter,
        reversed: Boolean(mov?.reversed),
        averageCostAfter: line.averageCostAfter,
      };
    });
    return { id, at, userName, lines };
  }

  return {
    id,
    at,
    userName,
    lines: related.map((row) => ({
      movementId: row.id,
      itemId: row.itemId,
      qty: row.delta,
      purchaseCost: null,
      qtyBefore: row.qtyBefore,
      qtyAfter: row.qtyAfter,
      reversed: row.reversed,
      averageCostAfter: null,
    })),
  };
}

export function buildHistoryEntries(state: AppState): HistoryEntry[] {
  const receiptsById = new Map((state.receipts ?? []).map((row) => [row.id, row]));
  const shipmentsById = new Map((state.shipmentDocuments ?? []).map((row) => [row.id, row]));
  const seenReceipts = new Set<string>();
  const seenShipments = new Set<string>();
  const consumed = new Set<string>();
  const entries: HistoryEntry[] = [];
  const movements = state.movements ?? [];
  const receiptMovements = new Map<string, Movement[]>();
  const shipmentMovements = new Map<string, Movement[]>();
  for (const row of movements) {
    if (row.receiptId) {
      const bucket = receiptMovements.get(row.receiptId) ?? [];
      bucket.push(row);
      receiptMovements.set(row.receiptId, bucket);
    }
    if (row.shipmentDocumentId) {
      const bucket = shipmentMovements.get(row.shipmentDocumentId) ?? [];
      bucket.push(row);
      shipmentMovements.set(row.shipmentDocumentId, bucket);
    }
  }

  for (let i = 0; i < movements.length; i++) {
    const mov = movements[i];
    if (consumed.has(mov.id)) continue;

    if (mov.shipmentDocumentId && shipmentsById.has(mov.shipmentDocumentId)) {
      if (seenShipments.has(mov.shipmentDocumentId)) continue;
      seenShipments.add(mov.shipmentDocumentId);
      const related = shipmentMovements.get(mov.shipmentDocumentId) ?? [];
      for (const row of related) consumed.add(row.id);
      entries.push({
        kind: "shipment",
        key: mov.shipmentDocumentId,
        shipment: shipmentsById.get(mov.shipmentDocumentId)!,
      });
      continue;
    }

    if (mov.receiptId) {
      if (seenReceipts.has(mov.receiptId)) continue;
      seenReceipts.add(mov.receiptId);
      const related = receiptMovements.get(mov.receiptId) ?? [];
      for (const row of related) consumed.add(row.id);
      entries.push({
        kind: "receipt",
        key: mov.receiptId,
        receipt: toReceiptView(receiptsById.get(mov.receiptId), related),
      });
      continue;
    }

    if (mov.reason === RECEIPT_REASON) {
      const cluster = [mov];
      consumed.add(mov.id);
      const started = Date.parse(mov.at);
      for (let j = i + 1; j < movements.length; j++) {
        const next = movements[j];
        if (next.receiptId || next.reason !== RECEIPT_REASON || next.userName !== mov.userName) break;
        if (Math.abs(Date.parse(next.at) - started) > RECEIPT_CLUSTER_MS) break;
        cluster.push(next);
        consumed.add(next.id);
      }
      entries.push({
        kind: "receipt",
        key: `legacy:${cluster[0].id}`,
        receipt: toReceiptView(undefined, cluster),
      });
      continue;
    }

    entries.push({ kind: "movement", key: mov.id, movement: mov });
  }

  for (const shipment of state.shipmentDocuments ?? []) {
    if (seenShipments.has(shipment.id)) continue;
    entries.push({ kind: "shipment", key: shipment.id, shipment });
  }

  return entries.sort((a, b) => {
    const atA = a.kind === "receipt" ? a.receipt.at : a.kind === "shipment" ? a.shipment.at : a.movement.at;
    const atB = b.kind === "receipt" ? b.receipt.at : b.kind === "shipment" ? b.shipment.at : b.movement.at;
    return Date.parse(atB) - Date.parse(atA);
  });
}

export function matchesHistoryFilter(
  at: string,
  userName: string,
  dateFrom: string,
  dateTo: string,
  userFilter: string,
) {
  if (userFilter && userName !== userFilter) return false;
  if (dateFrom || dateTo) {
    const day = moscowDateKey(at);
    if (dateFrom && day < dateFrom) return false;
    if (dateTo && day > dateTo) return false;
  }
  return true;
}
