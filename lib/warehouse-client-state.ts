import type { AppState } from "./types";

/** Read-only page projection. Never pass this projection to a mutation or persist it. */
export function warehouseClientState(state: AppState): AppState {
  return {
    importedAt: state.importedAt, sourceFile: state.sourceFile,
    items: state.items, kits: state.kits, layout: state.layout,
    shipments: [], movements: [], receipts: [], shipmentDocuments: [], users: [],
    wbFbs: { handledOrderIds: [] }, wbFbo: { handledSupplyIds: [] },
    ozonFbs: { handled: [] },
  };
}
