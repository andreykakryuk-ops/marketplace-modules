import { createHash } from "node:crypto";
import type { AppState } from "./types";

// Only journal data participates: an unrelated layout change does not invalidate confirmation.
export function historySnapshot(state: AppState): string {
  return createHash("sha256").update(JSON.stringify([
    state.movements, state.receipts, state.shipmentDocuments,
  ])).digest("hex");
}
