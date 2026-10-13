export type StockKind = "main" | "finished";
export type ItemCategory =
  | "watch"
  | "strap"
  | "headphone"
  | "box"
  | "charger"
  | "other"
  | "finished";
export type BomStatus = "ok" | "needs_setup";
export type ShipmentChannel = "FBO" | "FBS" | "FBW" | "STOCK";
export type ShipmentStatus = "draft" | "posted";
export type ShipmentSource = "manual" | "wb-fbs" | "wb-fbo" | "ozon-fbs";
export type WbFbsShipmentStage = "collecting" | "assembly";
export type ShipmentOperation = "post" | "pack";
export type UserRole = "admin" | "employee";
export type WarehouseBlockId = "watches" | "straps" | "assembled";
export type BlockId = WarehouseBlockId | "shipments";
export type StockColumnId = "name" | "size" | "qty" | "cost" | "sum";

export type AppUser = {
  id: string;
  name: string;
  role: UserRole;
};

export type Item = {
  id: string;
  sku: string;
  name: string;
  stockKind: StockKind;
  category: ItemCategory;
  strapSize: number | null;
  cost: number | null;
  lastPurchaseCost: number | null;
  needsReview: boolean;
  onHand: number;
  reserved: number;
  sortOrder: number;
  hidden: boolean;
};

export type KitLine = {
  componentItemId: string;
  qty: number;
};

export type KitLineInput = KitLine & {
  lastPurchaseCost?: number | null;
};

export type Kit = {
  finishedItemId: string;
  sku: string;
  status: BomStatus;
  lines: KitLine[];
};

export type ShipmentLine = {
  fbsUnits?:{key:string;qty:number}[];
  assembledQty?:number;
  ozonPostingIds?:string[];
  id: string;
  finishedItemId: string;
  qty: number;
  assembled: boolean;
  externalOrderIds: number[];
};

export type Shipment = {
  wbCabinetId?:string;
  ozonClientId?:string;ozonGroup?:string;ozonPostingIds?:string[];ozonUnknown?:string[];
  id: string;
  name: string;
  channel: ShipmentChannel;
  source: ShipmentSource;
  wbFbsStage: WbFbsShipmentStage | null;
  wbFboStatusId: number | null;
  status: ShipmentStatus;
  lines: ShipmentLine[];
  postedAt: string | null;
  packedToAssembled: boolean;
  externalOrderIds: number[];
  canceledExternalOrderIds: number[];
  externalSupplyId: number | null;
  wbFbsSupplyId: string | null;
  externalUpdatedAt: string | null;
};

export type ShipmentDocumentLine = {
  finishedItemId: string;
  qty: number;
  fromFinishedStock: number;
  assembledForShipment: number;
  externalOrderIds: number[];
};

export type ShipmentDocument = {
  ozonClientId?:string;
  ozonPostingIds?:string[];
  id: string;
  at: string;
  userName: string;
  shipmentId: string;
  shipmentName: string;
  channel: ShipmentChannel;
  operation: ShipmentOperation;
  lines: ShipmentDocumentLine[];
};

export type WbFbsSyncState = {
  handledOrderIds: number[];
};

export type WbFboSyncState = {
  handledSupplyIds: number[];
};

export type WbFboStatus = {
  configured: boolean;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  activeSupplies: number;
  matchedSupplies: number;
  handledSupplies: number;
  unknownArticles: WbFbsUnknownArticle[];
};

export type WbFbsUnknownArticle = {
  article: string;
  qty: number;
};

export type WbFbsStatus = {
  configured: boolean;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastError: string | null;
  activeOrders: number;
  queuedOrders: number;
  matchedOrders: number;
  handledOrders: number;
  unknownArticles: WbFbsUnknownArticle[];
};

export type Movement = {
  id: string;
  at: string;
  userName: string;
  itemId: string;
  qtyBefore: number;
  delta: number;
  qtyAfter: number;
  reason: string;
  reference: string | null;
  reversed: boolean;
  receiptId: string | null;
  shipmentDocumentId: string | null;
};

export type ReceiptLine = {
  itemId: string;
  qty: number;
  purchaseCost: number | null;
  qtyBefore: number;
  qtyAfter: number;
  averageCostAfter: number | null;
};

export type Receipt = {
  id: string;
  at: string;
  userName: string;
  lines: ReceiptLine[];
};

export const RECEIPT_REASON = "Оприходование партии";
export const SHIPMENT_POST_REASON = "Проведение поставки";
export const SHIPMENT_PACK_REASON = "В склад упакованных";

export type Layout = {
  projectName: string;
  blockTitles: Record<BlockId, string>;
  blockOrder: WarehouseBlockId[];
  watchColumns: StockColumnId[];
  strapColumns: StockColumnId[];
  columnWidths: Record<string, number>;
  blockWidths: Record<string, number>;
  showHidden: boolean;
};

export type AppState = {
  // Read-only projection for shipment pages; never persisted by warehouse mutations.
  shipmentReservationView?:{components:Record<string,number>;finished:Record<string,number>;coverage:Record<string,{fromFinishedStock:number;toAssemble:number}>};
  fbsAssembly?:Record<string,number>;
  ozonFbs?:{handled:string[];applied?:Record<string,{snapshotRevision:number;postingsRevision:number;sourceUpdatedAt:string;appliedAt:string;postingsCount:number;reconciliationRequired?:number}>;reconciliation?:Record<string,{sourceUpdatedAt:string;postings:{number:string;status:string;createdAt:string}[]}>};
  importedAt: string;
  sourceFile: string;
  items: Item[];
  kits: Kit[];
  shipments: Shipment[];
  shipmentDocuments: ShipmentDocument[];
  wbFbs: WbFbsSyncState;
  wbFbo: WbFboSyncState;
  receipts: Receipt[];
  movements: Movement[];
  users: AppUser[];
  layout: Layout;
};

export const CATEGORY_LABEL: Record<ItemCategory, string> = {
  watch: "Часы",
  strap: "Ремешок",
  headphone: "Наушники",
  box: "Коробка",
  charger: "Зарядка",
  other: "Прочее",
  finished: "Готовый товар",
};

export const KIND_LABEL: Record<StockKind, string> = {
  main: "Основной склад",
  finished: "Собрано на складе",
};

export const DEFAULT_PROJECT_NAME = "Склад";

export const DEFAULT_BLOCK_TITLES: Record<BlockId, string> = {
  watches: "Часы и комплектующие",
  straps: "Ремешки",
  assembled: "Собрано на складе",
  shipments: "Поставки",
};

export const DEFAULT_LAYOUT: Layout = {
  projectName: DEFAULT_PROJECT_NAME,
  blockTitles: { ...DEFAULT_BLOCK_TITLES },
  blockOrder: ["watches", "straps", "assembled"],
  watchColumns: ["name", "qty", "cost", "sum"],
  strapColumns: ["name", "size", "qty", "cost", "sum"],
  columnWidths: {},
  blockWidths: {},
  showHidden: false,
};

export const DEFAULT_USERS: AppUser[] = [{ id: "admin", name: "Администратор", role: "admin" }];

export function availableQty(item: Item): number {
  return item.onHand - item.reserved;
}

export function asInt(value: unknown, fallback = 0): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? n : fallback;
}

export function isAdmin(user: AppUser | null | undefined): boolean {
  return user?.role === "admin";
}
