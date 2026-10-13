import {applyOzonSnapshot} from './ozon/postings-application';
import type {OzonSnapshot} from './ozon/runtime.cjs';
import {assemblyFields,fbsUnitKey,rememberAssembly,markFbsAssembly} from './fbs-assembly';
import {applyOzonPostings} from './ozon/fbs-sync';
import type {OzonPosting} from './ozon/runtime.cjs';
import {requireWarehouseEdit} from './warehouse-edit';
import fs from "node:fs";
import path from "node:path";
import {
  asInt,
  DEFAULT_BLOCK_TITLES,
  DEFAULT_PROJECT_NAME,
  DEFAULT_USERS,
  type AppState,
  type AppUser,
  type BlockId,
  type Item,
  type ItemCategory,
  type Kit,
  type KitLine,
  type KitLineInput,
  type Layout,
  type Movement,
  type ReceiptLine,
  type Shipment,
  type ShipmentDocument,
  type ShipmentOperation,
  type StockColumnId,
  type WarehouseBlockId,
  type WbFbsUnknownArticle,
  RECEIPT_REASON,
  SHIPMENT_PACK_REASON,
  SHIPMENT_POST_REASON,
} from "@/lib/types";
import { finishedCoverageForShipments, calcNeeds, shipmentLineKey } from "@/lib/bom";
import { averageCostAfterReceipt, parseMoney, roundMoney } from "@/lib/cost";
import { writeJsonFileAtomic } from "@/lib/atomic-file";
import { fileRevision } from "@/lib/file-revision";
import { historySnapshot } from "@/lib/history-snapshot";
import { UndoHistory } from "@/lib/undo-history";
import { shipmentDeletionSnapshot } from "@/lib/shipment-deletion";

const dataDir = path.join(process.cwd(), "data");
const statePath = path.join(dataDir, "app-state.json");
const seedPath = path.join(dataDir, "seed.json");
const undoHistory = new UndoHistory<AppState>(dataDir);

const ALL_BLOCKS: WarehouseBlockId[] = ["watches", "straps", "assembled"];
const WATCH_COLS: StockColumnId[] = ["name", "qty", "cost", "sum"];
const STRAP_COLS: StockColumnId[] = ["name", "size", "qty", "cost", "sum"];


export type WbFbsOrderInput = {
  id: number;
  article: string;
};

export type WbFbsOrderStatusInput = {
  id: number;
  supplierStatus: string;
  wbStatus: string;
};

export type WbFbsSupplyOrdersInput = {
  supplyId: string;
  orderIds: number[];
};

export type WbFbsShipmentSyncResult = {
  changed: boolean;
  activeOrders: number;
  queuedOrders: number;
  matchedOrders: number;
  handledOrders: number;
  unknownArticles: WbFbsUnknownArticle[];
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function optionalPositiveInt(value: unknown): number | null {
  const parsed = asInt(value, Number.NaN);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readJson(file: string): AppState {
  return JSON.parse(fs.readFileSync(file, "utf8")) as AppState;
}

function uniqueOrder<T extends string>(incoming: T[] | undefined, fallback: T[]): T[] {
  const allowed = new Set(fallback);
  const seen = new Set<T>();
  const out: T[] = [];
  for (const id of incoming ?? []) {
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of fallback) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

function normalizeLayout(raw?: Partial<Layout> | null): Layout {
  const titles = (raw?.blockTitles ?? {}) as Partial<Record<BlockId, string>>;
  const shipmentTitle = String(titles.shipments || DEFAULT_BLOCK_TITLES.shipments).trim();
  return {
    projectName: String(raw?.projectName || DEFAULT_PROJECT_NAME).trim() || DEFAULT_PROJECT_NAME,
    blockTitles: {
      watches: String(titles.watches || DEFAULT_BLOCK_TITLES.watches).trim() || DEFAULT_BLOCK_TITLES.watches,
      straps: String(titles.straps || DEFAULT_BLOCK_TITLES.straps).trim() || DEFAULT_BLOCK_TITLES.straps,
      assembled: String(titles.assembled || DEFAULT_BLOCK_TITLES.assembled).trim() || DEFAULT_BLOCK_TITLES.assembled,
      shipments:
        shipmentTitle === "Поставки FBO / FBS" ||
        shipmentTitle === "Поставки FBO / FBS / FBY" ||
        shipmentTitle === "Поставки FBO / FBS / FBW"
          ? DEFAULT_BLOCK_TITLES.shipments
          : shipmentTitle || DEFAULT_BLOCK_TITLES.shipments,
    },
    blockOrder: uniqueOrder(raw?.blockOrder, ALL_BLOCKS),
    watchColumns: uniqueOrder(raw?.watchColumns, WATCH_COLS),
    strapColumns: uniqueOrder(raw?.strapColumns, STRAP_COLS),
    columnWidths: raw?.columnWidths && typeof raw.columnWidths === "object" ? raw.columnWidths : {},
    blockWidths: raw?.blockWidths && typeof raw.blockWidths === "object" ? raw.blockWidths : {},
    showHidden: Boolean(raw?.showHidden),
  };
}

export function normalizeState(raw: AppState): AppState {
  return {
    fbsAssembly:raw.fbsAssembly??{},
    ozonFbs:raw.ozonFbs??{handled:[]},
    importedAt: raw.importedAt,
    sourceFile: raw.sourceFile,
    items: (raw.items ?? []).map((item, index) => ({
      ...item,
      onHand: asInt(item.onHand),
      reserved: asInt(item.reserved),
      sortOrder: item.sortOrder ?? index,
      hidden: Boolean(item.hidden),
      lastPurchaseCost: Object.prototype.hasOwnProperty.call(item, "lastPurchaseCost")
        ? parseMoney(item.lastPurchaseCost)
        : parseMoney(item.cost),
    })),
    kits: (raw.kits ?? []).map((kit) => {
      const lines = kit.lines.map((line) => ({ ...line, qty: Math.max(1, asInt(line.qty, 1)) }));
      return {
        ...kit,
        lines,
        status: lines.length > 0 ? "ok" : "needs_setup",
      };
    }),
    shipments: (raw.shipments ?? []).map((shipment) => {
      const source = shipment.source === "ozon-fbs" ? "ozon-fbs" : shipment.source === "wb-fbs" ? "wb-fbs" : shipment.source === "wb-fbo" ? "wb-fbo" : "manual";
      const fromWbFbo = source === "wb-fbo";
      const name = String(shipment.name ?? "");
      const channelRaw = String(shipment.channel ?? "");
      return {
      ...shipment,
      name:
        fromWbFbo && (name.startsWith("FBO ·") || name.startsWith("FBY ·") || name.startsWith("FBW ·"))
          ? `FBW ·${name.slice(5)}`
          : name,
      channel: fromWbFbo
        ? "FBW"
        : channelRaw === "STOCK" && source === "manual"
          ? "STOCK"
        : channelRaw === "FBS"
          ? "FBS"
          : channelRaw === "FBW" || channelRaw === "FBY"
            ? "FBW"
            : "FBO",
      source,
      wbFbsStage:
        (source === "wb-fbs"||source==="ozon-fbs")
          ? shipment.wbFbsStage === "assembly"
            ? "assembly"
            : "collecting"
          : null,
      wbFboStatusId: optionalPositiveInt(shipment.wbFboStatusId),
      packedToAssembled: Boolean(shipment.packedToAssembled),
      externalSupplyId: optionalPositiveInt(shipment.externalSupplyId),
      wbFbsSupplyId:
        source === "wb-fbs" && typeof shipment.wbFbsSupplyId === "string" && shipment.wbFbsSupplyId.trim()
          ? shipment.wbFbsSupplyId.trim()
          : null,
      externalUpdatedAt: shipment.externalUpdatedAt ? String(shipment.externalUpdatedAt) : null,
      externalOrderIds: [
        ...new Set(
          (shipment.externalOrderIds ?? [])
            .map((id) => asInt(id, Number.NaN))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ],
      canceledExternalOrderIds: [
        ...new Set(
          (shipment.canceledExternalOrderIds ?? [])
            .map((id) => asInt(id, Number.NaN))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ],
      lines: shipment.lines.map((line) => ({
        ...line,
        qty: Math.max(1, asInt(line.qty, 1)),
        externalOrderIds: [
          ...new Set(
            (line.externalOrderIds ?? [])
              .map((id) => asInt(id, Number.NaN))
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        ],
      })),
    };
    }),
    shipmentDocuments: (raw.shipmentDocuments ?? []).map((document) => ({
      id: String(document.id),
      at: String(document.at),
      userName: String(document.userName ?? ""),
      shipmentId: String(document.shipmentId ?? ""),
      shipmentName: String(document.shipmentName ?? ""),
      ...(document.ozonClientId?{ozonClientId:String(document.ozonClientId),ozonPostingIds:[...new Set((document.ozonPostingIds??[]).map(String))]}:{}),
      channel: (() => {
        const channelRaw = String(document.channel ?? "");
        return channelRaw === "STOCK" ? "STOCK" : channelRaw === "FBS" ? "FBS" : channelRaw === "FBW" || channelRaw === "FBY" ? "FBW" : "FBO";
      })(),
      operation: document.operation === "pack" ? "pack" : "post",
      lines: (document.lines ?? []).map((line) => ({
        finishedItemId: String(line.finishedItemId),
        qty: Math.max(1, asInt(line.qty, 1)),
        fromFinishedStock: Math.max(0, asInt(line.fromFinishedStock)),
        assembledForShipment: Math.max(0, asInt(line.assembledForShipment)),
        externalOrderIds: [
          ...new Set(
            (line.externalOrderIds ?? [])
              .map((id) => asInt(id, Number.NaN))
              .filter((id) => Number.isFinite(id) && id > 0),
          ),
        ],
      })),
    })),
    wbFbs: {
      handledOrderIds: [
        ...new Set(
          (raw.wbFbs?.handledOrderIds ?? [])
            .map((id) => asInt(id, Number.NaN))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ],
    },
    wbFbo: {
      handledSupplyIds: [
        ...new Set(
          (raw.wbFbo?.handledSupplyIds ?? [])
            .map((id) => asInt(id, Number.NaN))
            .filter((id) => Number.isFinite(id) && id > 0),
        ),
      ],
    },
    receipts: (raw.receipts ?? []).map((row) => ({
      id: String(row.id),
      at: String(row.at),
      userName: String(row.userName ?? ""),
      lines: (row.lines ?? []).map((line) => ({
        itemId: String(line.itemId),
        qty: asInt(line.qty),
        purchaseCost: parseMoney(line.purchaseCost),
        qtyBefore: asInt(line.qtyBefore),
        qtyAfter: asInt(line.qtyAfter),
        averageCostAfter: parseMoney(line.averageCostAfter),
      })),
    })),
    movements: (raw.movements ?? []).map((row) => ({
      ...row,
      reversed: Boolean(row.reversed),
      receiptId: row.receiptId ? String(row.receiptId) : null,
      shipmentDocumentId: row.shipmentDocumentId ? String(row.shipmentDocumentId) : null,
    })),
    users: raw.users?.length ? raw.users : clone(DEFAULT_USERS),
    layout: normalizeLayout(raw.layout),
  };
}

export function readStateRevision() {
  return fileRevision(fs.existsSync(statePath) ? statePath : seedPath);
}

export function readState(): AppState {
  if (fs.existsSync(statePath)) return normalizeState(readJson(statePath));
  if (fs.existsSync(seedPath)) return normalizeState(readJson(seedPath));
  throw new Error("Нет данных. Сначала выполните npm run import:excel");
}

export function writeState(state: AppState) {
  writeJsonFileAtomic(statePath, normalizeState(state));
}

export function readUndoMeta() {
  return undoHistory.meta();
}

function mutate(actor: AppUser, fn: (state: AppState) => void) {
  const state = readState();
  const previous = clone(state);
  fn(state);
  undoHistory.record(previous);
  writeState(state);
  return state;
}

function mutateExternal<T>(fn: (state: AppState) => { changed: boolean; result: T }): T {
  const state = readState();
  const { changed, result } = fn(state);
  if (changed) writeState(state);
  return result;
}

export function requireAdmin(user: AppUser) {
  if (user.role !== "admin") throw new Error("Это действие доступно только администратору");
}

export function itemById(state: AppState, id: string) {
  return state.items.find((item) => item.id === id);
}

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
}

function log(
  state: AppState,
  item: Item,
  delta: number,
  reason: string,
  reference: string | null,
  userName: string,
  extra?: { at?: string; receiptId?: string | null; shipmentDocumentId?: string | null },
) {
  const qtyBefore = item.onHand;
  item.onHand = qtyBefore + delta;
  const movement: Movement = {
    id: nowId("mov"),
    at: extra?.at ?? new Date().toISOString(),
    userName,
    itemId: item.id,
    qtyBefore,
    delta,
    qtyAfter: item.onHand,
    reason,
    reference,
    reversed: false,
    receiptId: extra?.receiptId ?? null,
    shipmentDocumentId: extra?.shipmentDocumentId ?? null,
  };
  state.movements.unshift(movement);
}

export function requireInt(value: unknown, min = 1) {
  const n = asInt(value, Number.NaN);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(min <= 0 ? "Количество должно быть целым числом: 0, 1, 2, 3…" : "Количество должно быть целым числом: 1, 2, 3…");
  }
  return n;
}

export function requireStrapSize(value: unknown) {
  const n = requireInt(value, 1);
  if (n > 100) throw new Error("Размер ремешка — целое число в миллиметрах, например 21, 22, 38, 44, 46");
  return n;
}

export function applyHistoryClear(state: AppState, actor: AppUser, expectedSnapshot: string) {
  requireAdmin(actor);
  if (!expectedSnapshot || historySnapshot(state) !== expectedSnapshot) {
    throw new Error("История изменилась. Обновите страницу, проверьте новые записи и подтвердите очистку ещё раз.");
  }
  if (!state.movements.length && !state.receipts.length && !state.shipmentDocuments.length) {
    throw new Error("История уже пуста");
  }
  state.movements = [];
  state.receipts = [];
  state.shipmentDocuments = [];
}

export function clearHistory(actor: AppUser, expectedSnapshot: string) {
  requireAdmin(actor);
  return mutate(actor, state => applyHistoryClear(state, actor, expectedSnapshot));
}

export function undoLast(actor: AppUser) {
  requireAdmin(actor);
  writeState(normalizeState(undoHistory.undo(readState())));
}

export function redoLast(actor: AppUser) {
  requireAdmin(actor);
  writeState(normalizeState(undoHistory.redo(readState())));
}

export function saveKit(sku: string, _status: Kit["status"], lines: KitLineInput[], actor: AppUser, newSku?: string) {
  return mutate(actor, (state) => {
    const kit = state.kits.find((entry) => entry.sku === sku);
    if (!kit) throw new Error("Комплект не найден");
    kit.lines = lines.map((line) => ({ componentItemId: line.componentItemId, qty: requireInt(line.qty) }));
    kit.status = kit.lines.length > 0 ? "ok" : "needs_setup";
    for (const line of lines) {
      if (!("lastPurchaseCost" in line)) continue;
      const item = itemById(state, line.componentItemId);
      if (!item || item.stockKind !== "main") continue;
      if (line.lastPurchaseCost == null) {
        item.lastPurchaseCost = null;
        continue;
      }
      const cost = Number(line.lastPurchaseCost);
      if (!Number.isFinite(cost) || cost < 0) {
        throw new Error(`Себестоимость закупки для «${item.name}» должна быть числом 0 или больше`);
      }
      item.lastPurchaseCost = roundMoney(cost);
    }
    const nextSku = (newSku ?? sku).trim();
    if (nextSku && nextSku !== kit.sku) renameKitInState(state, kit, nextSku);
  });
}

function renameKitInState(state: AppState, kit: Kit, nextSku: string) {
  if (state.kits.some((entry) => entry.sku === nextSku && entry !== kit)) {
    throw new Error("Такой артикул уже есть");
  }
  const finished = itemById(state, kit.finishedItemId);
  const newId = `fin:${nextSku}`;
  if (finished && newId !== finished.id && state.items.some((item) => item.id === newId)) {
    throw new Error("Такой артикул уже есть");
  }
  kit.sku = nextSku;
  if (finished) {
    const oldId = finished.id;
    finished.sku = nextSku;
    finished.name = nextSku;
    finished.id = newId;
    kit.finishedItemId = newId;
    retargetItemId(state, oldId, newId);
  }
}

export function addKit(sku: string, lines: KitLine[], actor: AppUser) {
  return mutate(actor, (state) => {
    const name = sku.trim();
    if (!name) throw new Error("Укажите артикул");
    const id = `fin:${name}`;
    if (state.items.some((item) => item.id === id || item.sku === name) || state.kits.some((kit) => kit.sku === name)) {
      throw new Error("Такой артикул уже есть");
    }
    const parsed = lines.map((line) => ({ componentItemId: line.componentItemId, qty: requireInt(line.qty) }));
    const maxOrder = Math.max(0, ...state.items.map((item) => item.sortOrder));
    state.items.push({
      id,
      sku: name,
      name,
      stockKind: "finished",
      category: "finished",
      strapSize: null,
      cost: null,
      lastPurchaseCost: null,
      needsReview: false,
      onHand: 0,
      reserved: 0,
      sortOrder: maxOrder + 1,
      hidden: false,
    });
    state.kits.push({
      finishedItemId: id,
      sku: name,
      status: parsed.length > 0 ? "ok" : "needs_setup",
      lines: parsed,
    });
    state.kits.sort((a, b) => a.sku.localeCompare(b.sku, "ru"));
  });
}

export function deleteKit(sku: string, actor: AppUser) {
  return mutate(actor, (state) => {
    const kit = state.kits.find((entry) => entry.sku === sku);
    if (!kit) throw new Error("Комплект не найден");
    const finishedId = kit.finishedItemId;
    state.kits = state.kits.filter((entry) => entry.sku !== sku);
    state.items = state.items.filter((item) => item.id !== finishedId);
    for (const shipment of state.shipments) {
      shipment.lines = shipment.lines.filter((line) => line.finishedItemId !== finishedId);
    }
  });
}

export function addWarehouseItem(
  input: {
    name: string;
    category: ItemCategory;
    strapSize: number | null;
    cost: number | null;
    qty?: number;
  },
  actor: AppUser,
) {
  return mutate(actor, (state) => {
    const name = input.name.trim();
    if (!name) throw new Error("Укажите название");
    const strapSize = input.category === "strap" ? requireStrapSize(input.strapSize) : null;
    const id = input.category === "strap" ? `strap:${strapSize}:${name}` : `main:${name}`;
    if (state.items.some((item) => item.id === id || item.sku === name)) throw new Error("Такая позиция уже есть");
    const maxOrder = Math.max(0, ...state.items.map((item) => item.sortOrder));
    const item: Item = {
      id,
      sku: input.category === "strap" ? `${name} ${strapSize} mm` : name,
      name,
      stockKind: "main",
      category: input.category,
      strapSize,
      cost: input.cost,
      lastPurchaseCost: input.cost,
      needsReview: false,
      onHand: 0,
      reserved: 0,
      sortOrder: maxOrder + 1,
      hidden: false,
    };
    state.items.push(item);
    const qty = requireInt(input.qty ?? 0, 0);
    if (qty > 0) log(state, item, qty, "Поступление при создании", name, actor.name);
  });
}

export function deleteWarehouseItem(id: string, actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const usedInKit = state.kits.some((kit) => kit.lines.some((line) => line.componentItemId === id) || kit.finishedItemId === id);
    if (usedInKit) throw new Error("Нельзя удалить: позиция входит в состав комплекта");
    const usedInShip = state.shipments.some((ship) => ship.lines.some((line) => line.finishedItemId === id));
    if (usedInShip) throw new Error("Нельзя удалить: позиция есть в поставке");
    const item = itemById(state, id);
    if (!item) throw new Error("Позиция не найдена");
    if (item.stockKind === "finished") throw new Error("Готовый артикул удаляется через комплекты");
    state.items = state.items.filter((entry) => entry.id !== id);
  });
}

export function reorderWarehouseItems(orderedIds: string[], actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const order = new Map(orderedIds.map((id, index) => [id, index]));
    for (const item of state.items) {
      const next = order.get(item.id);
      if (next != null) item.sortOrder = next;
    }
  });
}

function retargetItemId(state: AppState, oldId: string, newId: string) {
  if (oldId === newId) return;
  for (const kit of state.kits) {
    if (kit.finishedItemId === oldId) kit.finishedItemId = newId;
    for (const line of kit.lines) {
      if (line.componentItemId === oldId) line.componentItemId = newId;
    }
  }
  for (const shipment of state.shipments) {
    for (const line of shipment.lines) {
      if (line.finishedItemId === oldId) line.finishedItemId = newId;
    }
  }
  for (const movement of state.movements) {
    if (movement.itemId === oldId) movement.itemId = newId;
  }
}

export function updateWarehouseItem(
  id: string,
  patch: { name?: string; onHand?: number; cost?: number | null; hidden?: boolean; strapSize?: number },
  actor: AppUser,
  expectedOnHand?: number,
  canAdjustStock = false,
) {
  requireWarehouseEdit(actor, patch, expectedOnHand, canAdjustStock);
  return mutate(actor, (state) => {
    const item = itemById(state, id);
    if (!item) throw new Error("Позиция не найдена");
    if (patch.onHand != null && expectedOnHand !== undefined && item.onHand !== expectedOnHand) {
      throw new Error("Остаток уже изменился. Обновите страницу и проверьте новое количество перед правкой.");
    }
    if (patch.name != null) {
      const name = patch.name.trim();
      if (!name) throw new Error("Название не может быть пустым");
      item.name = name;
      if (item.stockKind === "main" && item.category === "strap" && item.strapSize) {
        item.sku = `${name} ${item.strapSize} mm`;
      } else {
        item.sku = name;
      }
    }
    if (patch.strapSize != null) {
      if (item.category !== "strap") throw new Error("Размер можно менять только у ремешка");
      const nextSize = requireStrapSize(patch.strapSize);
      const newId = `strap:${nextSize}:${item.name}`;
      if (newId !== item.id && state.items.some((entry) => entry.id === newId)) {
        throw new Error("Ремешок с таким названием и размером уже есть");
      }
      const oldId = item.id;
      item.strapSize = nextSize;
      item.sku = `${item.name} ${nextSize} mm`;
      item.id = newId;
      retargetItemId(state, oldId, newId);
    }
    if (patch.cost !== undefined) {
      if (patch.cost == null) item.cost = null;
      else {
        const cost = Number(patch.cost);
        if (!Number.isFinite(cost) || cost < 0) throw new Error("Себестоимость должна быть числом 0 или больше");
        item.cost = roundMoney(cost);
      }
    }
    if (patch.hidden != null) item.hidden = patch.hidden;
    if (patch.onHand != null) {
      const next = requireInt(patch.onHand, 0);
      const delta = next - item.onHand;
      if (delta !== 0) log(state, item, delta, "Ручная правка остатка", null, actor.name);
    }
  });
}

export function setColumnWidth(key: string, width: number, actor: AppUser) {
  requireAdmin(actor);
  const state = readState();
  const w = Math.max(24, Math.min(640, Math.round(width)));
  state.layout.columnWidths = { ...state.layout.columnWidths, [key]: w };
  writeState(state);
  return state;
}

export function setBlockWidth(key: string, width: number, actor: AppUser) {
  requireAdmin(actor);
  const state = readState();
  const w = Math.max(180, Math.min(900, Math.round(width)));
  state.layout.blockWidths = { ...state.layout.blockWidths, [key]: w };
  writeState(state);
  return state;
}

export function setProjectName(name: string, actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const title = name.trim();
    if (!title) throw new Error("Укажите название проекта");
    state.layout.projectName = title;
  });
}

export function setBlockTitle(id: BlockId, title: string, actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    if (!["watches", "straps", "assembled", "shipments"].includes(id)) throw new Error("Неизвестный блок");
    const next = title.trim();
    if (!next) throw new Error("Укажите название блока");
    state.layout.blockTitles = { ...state.layout.blockTitles, [id]: next };
  });
}

export function setShowHidden(showHidden: boolean, actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    state.layout.showHidden = showHidden;
  });
}

export function moveLayoutBlock(id: WarehouseBlockId, direction: "left" | "right", actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const order = [...state.layout.blockOrder];
    const index = order.indexOf(id);
    const swap = direction === "left" ? index - 1 : index + 1;
    if (index < 0 || swap < 0 || swap >= order.length) return;
    [order[index], order[swap]] = [order[swap], order[index]];
    state.layout.blockOrder = order;
  });
}

export function moveLayoutColumn(group: "watch" | "strap", column: StockColumnId, direction: "left" | "right", actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const key = group === "watch" ? "watchColumns" : "strapColumns";
    const cols = [...state.layout[key]];
    const index = cols.indexOf(column);
    const swap = direction === "left" ? index - 1 : index + 1;
    if (index < 0 || swap < 0 || swap >= cols.length) return;
    [cols[index], cols[swap]] = [cols[swap], cols[index]];
    state.layout[key] = cols;
  });
}

export function receiveBatch(lines: { itemId: string; qty: number; cost: number | null }[], actor: AppUser) {
  return mutate(actor, (state) => {
    if (lines.length === 0) throw new Error("Добавьте хотя бы одну позицию");
    const at = new Date().toISOString();
    const receiptId = nowId("rec");
    const receiptLines: ReceiptLine[] = [];
    for (const line of lines) {
      const item = itemById(state, line.itemId);
      if (!item || item.stockKind !== "main") throw new Error("Выберите модель с основного склада");
      const amount = requireInt(line.qty);
      const purchase = Number(line.cost);
      if (line.cost == null || !Number.isFinite(purchase) || purchase < 0) {
        throw new Error(`Укажите закупочную цену для «${item.name}»`);
      }
      const qtyBefore = item.onHand;
      item.cost = averageCostAfterReceipt(item.onHand, item.cost, amount, purchase);
      item.lastPurchaseCost = roundMoney(purchase);
      log(state, item, amount, RECEIPT_REASON, null, actor.name, { at, receiptId });
      receiptLines.push({
        itemId: item.id,
        qty: amount,
        purchaseCost: roundMoney(purchase),
        qtyBefore,
        qtyAfter: item.onHand,
        averageCostAfter: item.cost,
      });
    }
    state.receipts.unshift({
      id: receiptId,
      at,
      userName: actor.name,
      lines: receiptLines,
    });
  });
}

export const WB_FBS_SHIPMENT_NAME = "Актуальная FBS поставка WB";

const WB_FBS_ASSEMBLY_STATUSES = new Set(["confirm", "complete"]);
const WB_FBS_CANCELED_STATUSES = new Set([
  "cancel",
  "canceled",
  "canceled_by_client",
  "declined_by_client",
  "defect",
  "canceled_by_carrier",
]);

function compactSku(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function finishedByWbArticle(state: AppState, article: string) {
  const normalized = article.trim().toLowerCase();
  if (!normalized) return undefined;
  const finished = state.items.filter((item) => item.stockKind === "finished");
  const exact = finished.filter(
    (item) => item.sku.trim().toLowerCase() === normalized || item.name.trim().toLowerCase() === normalized,
  );
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return undefined;

  const compact = compactSku(article);
  const loose = finished.filter((item) => compactSku(item.sku) === compact || compactSku(item.name) === compact);
  return loose.length === 1 ? loose[0] : undefined;
}

function createWbFbsCollectingShipment(): Shipment {
  return {
    id: nowId("ship"),
    name: WB_FBS_SHIPMENT_NAME,
    channel: "FBS",
    source: "wb-fbs",
    wbFbsStage: "collecting",
    wbFboStatusId: null,
    status: "draft",
    lines: [],
    postedAt: null,
    packedToAssembled: false,
    externalOrderIds: [],
    canceledExternalOrderIds: [],
    externalSupplyId: null,
    wbFbsSupplyId: null,
    externalUpdatedAt: null,
  };
}

function wbFbsAssemblyName(state: AppState, at: string) {
  const formatter = new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = new Map(formatter.formatToParts(new Date(at)).map((part) => [part.type, part.value]));
  const stamp = `${parts.get("day")}.${parts.get("month")}.${parts.get("year")} ${parts.get("hour")}:${parts.get("minute")}`;
  const base = `FBS на сборке · WB · ${stamp}`;
  let name = base;
  let suffix = 2;
  while (state.shipments.some((shipment) => shipment.name === name)) {
    name = `${base} (${suffix})`;
    suffix += 1;
  }
  return name;
}

function isCanceledWbOrder(status: WbFbsOrderStatusInput | undefined) {
  return Boolean(
    status &&
      (WB_FBS_CANCELED_STATUSES.has(status.supplierStatus.toLowerCase()) ||
        WB_FBS_CANCELED_STATUSES.has(status.wbStatus.toLowerCase())),
  );
}

function isWbOrderInAssembly(status: WbFbsOrderStatusInput | undefined) {
  return Boolean(
    status &&
      !isCanceledWbOrder(status) &&
      WB_FBS_ASSEMBLY_STATUSES.has(status.supplierStatus.toLowerCase()),
  );
}

function removeWbFbsOrderIds(state: AppState, shipment: Shipment, orderIds: Set<number>) {
  const removedIds = shipment.externalOrderIds.filter((id) => orderIds.has(id));
  if (removedIds.length === 0 && shipment.canceledExternalOrderIds.length === 0) return false;

  shipment.lines = shipment.lines
    .map((line): Shipment["lines"][number] | null => {
      const externalOrderIds = line.externalOrderIds.filter((id) => !orderIds.has(id));
      if (externalOrderIds.length === 0) return null;
      return {
        ...line,
        qty: externalOrderIds.length,
        ...assemblyFields(state,externalOrderIds.map(id=>({key:fbsUnitKey("wb",shipment.wbCabinetId??"legacy",id,line.finishedItemId),qty:1}))),
        externalOrderIds,
      };
    })
    .filter((line): line is Shipment["lines"][number] => line !== null);
  shipment.externalOrderIds = shipment.externalOrderIds.filter((id) => !orderIds.has(id));
  shipment.canceledExternalOrderIds = [];

  const handled = new Set(state.wbFbs.handledOrderIds);
  for (const id of removedIds) handled.add(id);
  state.wbFbs.handledOrderIds = [...handled].sort((a, b) => a - b);

  if (shipment.externalOrderIds.length === 0) {
    state.shipments = state.shipments.filter((entry) => entry.id !== shipment.id);
  }
  return true;
}

export function readWbFbsTrackedOrderIds() {
  const ids = readState().shipments
    .filter((shipment) => shipment.source === "wb-fbs")
    .flatMap((shipment) => shipment.externalOrderIds);
  return [...new Set(ids)].sort((a, b) => a - b);
}

function wbFbsOrderArticleMap(state: AppState, orders: WbFbsOrderInput[]) {
  const map = new Map<number, string>();
  for (const shipment of state.shipments) {
    if (shipment.source !== "wb-fbs") continue;
    for (const line of shipment.lines) {
      const item = state.items.find((entry) => entry.id === line.finishedItemId);
      const article = item?.sku ?? "";
      if (!article) continue;
      for (const id of line.externalOrderIds) map.set(id, article);
    }
  }
  for (const order of orders) {
    const article = String(order.article ?? "").trim();
    if (article) map.set(order.id, article);
  }
  return map;
}

function wbFbsLinesFromOrderIds(
  state: AppState,
  orderIds: number[],
  articleByOrder: Map<number, string>,
  oldLines: Shipment["lines"],
  unknown: Map<string, number>,
  cabinetId = "legacy",
) {
  const matched = new Map<string, { item: Item; orderIds: number[] }>();
  for (const id of orderIds) {
    const article = articleByOrder.get(id) ?? "";
    const item = finishedByWbArticle(state, article);
    if (!item) {
      const label = article || "(артикул не указан)";
      unknown.set(label, (unknown.get(label) ?? 0) + 1);
      continue;
    }
    const group = matched.get(item.id) ?? { item, orderIds: [] };
    group.orderIds.push(id);
    matched.set(item.id, group);
  }
  const oldByItem = new Map(oldLines.map((line) => [line.finishedItemId, line]));
  const lines = [...matched.values()]
    .sort((a, b) => a.item.sku.localeCompare(b.item.sku, "ru"))
    .map(({ item, orderIds: ids }) => {
      const old = oldByItem.get(item.id);
      return {
        id: old?.id ?? nowId("sline"),
        finishedItemId: item.id,
        qty: ids.length,
        ...assemblyFields(state,ids.map(id=>({key:fbsUnitKey("wb",cabinetId,id,item.id),qty:1}))),
        externalOrderIds: [...ids].sort((a, b) => a - b),
      };
    });
  return {
    lines,
    nextOrderIds: lines.flatMap((line) => line.externalOrderIds).sort((a, b) => a - b),
  };
}

function applyWbFbsAssemblyGroups(
  state: AppState,
  groups: WbFbsSupplyOrdersInput[],
  articleByOrder: Map<number, string>,
  statusById: Map<number, WbFbsOrderStatusInput>,
  unknown: Map<string, number>,
  cabinetId = "legacy",
) {
  let changed = false;
  const usedShipmentIds = new Set<string>();
  const groupedIds = new Set<number>();
  const handled = new Set(state.wbFbs.handledOrderIds);
  const assemblies = () =>
    state.shipments.filter((entry) => entry.source === "wb-fbs" && entry.wbFbsStage === "assembly" && entry.status === "draft");

  const sortedGroups = [...groups]
    .map((group) => ({
      supplyId: group.supplyId.trim(),
      orderIds: [...new Set(group.orderIds)]
        .filter((id) => id > 0 && !handled.has(id) && isWbOrderInAssembly(statusById.get(id)))
        .sort((a, b) => a - b),
    }))
    .filter((group) => group.supplyId && group.orderIds.length > 0)
    .sort((a, b) => b.orderIds.length - a.orderIds.length);

  for (const group of sortedGroups) {
    for (const id of group.orderIds) groupedIds.add(id);
    const idSet = new Set(group.orderIds);
    const available = assemblies().filter((entry) => !usedShipmentIds.has(entry.id));
    let shipment = available.find((entry) => entry.wbFbsSupplyId === group.supplyId);
    if (!shipment) {
      shipment = [...available].sort((a, b) => {
        const overlap = (entry: Shipment) => entry.externalOrderIds.filter((id) => idSet.has(id)).length;
        return overlap(b) - overlap(a);
      })[0];
      if (shipment && shipment.externalOrderIds.filter((id) => idSet.has(id)).length === 0) shipment = undefined;
    }
    if (!shipment) {
      shipment = {
        ...createWbFbsCollectingShipment(),
        name: wbFbsAssemblyName(state, new Date().toISOString()),
        wbFbsStage: "assembly",
        wbFbsSupplyId: group.supplyId,
      };
      state.shipments.unshift(shipment);
      changed = true;
    }
    usedShipmentIds.add(shipment.id);
    const { lines, nextOrderIds } = wbFbsLinesFromOrderIds(
      state,
      group.orderIds,
      articleByOrder,
      shipment.lines,
      unknown,
      cabinetId,
    );
    if (nextOrderIds.length === 0) {
      state.shipments = state.shipments.filter((entry) => entry.id !== shipment.id);
      usedShipmentIds.delete(shipment.id);
      changed = true;
      continue;
    }
    const name =
      shipment.wbFbsStage === "assembly" && shipment.name.startsWith("FBS на сборке")
        ? shipment.name
        : wbFbsAssemblyName(state, new Date().toISOString());
    const shipmentChanged =
      shipment.name !== name ||
      shipment.channel !== "FBS" ||
      shipment.source !== "wb-fbs" ||
      shipment.wbFbsStage !== "assembly" ||
      shipment.wbFbsSupplyId !== group.supplyId ||
      shipment.status !== "draft" ||
      JSON.stringify(shipment.lines) !== JSON.stringify(lines) ||
      JSON.stringify(shipment.externalOrderIds) !== JSON.stringify(nextOrderIds);
    if (shipmentChanged) {
      shipment.name = name;
      shipment.channel = "FBS";
      shipment.source = "wb-fbs";
      shipment.wbFbsStage = "assembly";
      shipment.wbFbsSupplyId = group.supplyId;
      shipment.status = "draft";
      shipment.lines = lines;
      shipment.externalOrderIds = nextOrderIds;
      shipment.canceledExternalOrderIds = [];
      shipment.postedAt = null;
      shipment.packedToAssembled = false;
      changed = true;
    }
  }

  for (const entry of [...assemblies()]) {
    if (usedShipmentIds.has(entry.id)) continue;
    const remain = entry.externalOrderIds.filter(
      (id) => !handled.has(id) && !groupedIds.has(id) && isWbOrderInAssembly(statusById.get(id)),
    );
    if (remain.length === 0) {
      state.shipments = state.shipments.filter((shipment) => shipment.id !== entry.id);
      changed = true;
      continue;
    }
    const { lines, nextOrderIds } = wbFbsLinesFromOrderIds(state, remain, articleByOrder, entry.lines, unknown, cabinetId);
    if (JSON.stringify(entry.lines) !== JSON.stringify(lines) || JSON.stringify(entry.externalOrderIds) !== JSON.stringify(nextOrderIds)) {
      entry.lines = lines;
      entry.externalOrderIds = nextOrderIds;
      changed = true;
    }
  }

  return changed;
}

export function applyWbFbsShipmentSync(
  state: AppState,
  orders: WbFbsOrderInput[],
  orderStatuses: WbFbsOrderStatusInput[] = [],
  supplyOrders: WbFbsSupplyOrdersInput[] = [],
  cabinetId = "legacy",
): WbFbsShipmentSyncResult {
  const beforeAssembly=JSON.stringify(state.fbsAssembly??{});
  let changed = false;
  for(const entry of state.shipments){
    if(entry.source!=="wb-fbs"||entry.status!=="draft")continue;
    if(entry.wbCabinetId&&entry.wbCabinetId!==cabinetId)throw new Error("WB_CABINET_CHANGED");
    if(entry.wbCabinetId!==cabinetId){entry.wbCabinetId=cabinetId;changed=true;}
    for(const line of entry.lines)rememberAssembly(state,line,line.externalOrderIds.map(id=>({key:fbsUnitKey("wb",cabinetId,id,line.finishedItemId),qty:1})));
  }
    const uniqueOrders = new Map<number, WbFbsOrderInput>();
    for (const order of orders) {
      const id = asInt(order.id, Number.NaN);
      if (!Number.isFinite(id) || id <= 0) continue;
      if (!uniqueOrders.has(id)) uniqueOrders.set(id, { id, article: String(order.article ?? "").trim() });
    }

    const statusById = new Map<number, WbFbsOrderStatusInput>();
    for (const status of orderStatuses) {
      const id = asInt(status.id, Number.NaN);
      if (!Number.isFinite(id) || id <= 0) continue;
      statusById.set(id, {
        id,
        supplierStatus: String(status.supplierStatus ?? "").toLowerCase(),
        wbStatus: String(status.wbStatus ?? "").toLowerCase(),
      });
    }

    const articleByOrder = wbFbsOrderArticleMap(state, [...uniqueOrders.values()]);
    const unknown = new Map<string, number>();
    const openSupplyGroups = supplyOrders.filter((group) => group.supplyId.trim() && group.orderIds.length > 0);
    const assignedToSupply = new Set(openSupplyGroups.flatMap((group) => group.orderIds));

    let shipment = state.shipments.find(
      (entry) => entry.source === "wb-fbs" && entry.wbFbsStage !== "assembly",
    );
    if (!shipment) {
      shipment = createWbFbsCollectingShipment();
      state.shipments.unshift(shipment);
      changed = true;
    }

    if (openSupplyGroups.length > 0) {
      if (applyWbFbsAssemblyGroups(state, openSupplyGroups, articleByOrder, statusById, unknown, cabinetId)) changed = true;
      const leftoverConfirmIds = shipment.externalOrderIds.filter(
        (id) => !assignedToSupply.has(id) && isWbOrderInAssembly(statusById.get(id)),
      );
      if (leftoverConfirmIds.length > 0) {
        let orphan = state.shipments.find(
          (entry) =>
            entry.source === "wb-fbs" &&
            entry.wbFbsStage === "assembly" &&
            entry.status === "draft" &&
            !entry.wbFbsSupplyId,
        );
        if (!orphan) {
          orphan = {
            ...createWbFbsCollectingShipment(),
            name: wbFbsAssemblyName(state, new Date().toISOString()),
            wbFbsStage: "assembly",
            wbFbsSupplyId: null,
          };
          state.shipments.unshift(orphan);
        }
        const mergedIds = [...new Set([...orphan.externalOrderIds, ...leftoverConfirmIds])]
          .filter((id) => !assignedToSupply.has(id) && isWbOrderInAssembly(statusById.get(id)))
          .sort((a, b) => a - b);
        const { lines, nextOrderIds } = wbFbsLinesFromOrderIds(
          state,
          mergedIds,
          articleByOrder,
          orphan.lines,
          unknown,
          cabinetId,
        );
        const orphanChanged =
          orphan.wbFbsStage !== "assembly" ||
          orphan.status !== "draft" ||
          orphan.wbFbsSupplyId !== null ||
          JSON.stringify(orphan.lines) !== JSON.stringify(lines) ||
          JSON.stringify(orphan.externalOrderIds) !== JSON.stringify(nextOrderIds);
        if (orphanChanged) {
          orphan.wbFbsStage = "assembly";
          orphan.status = "draft";
          orphan.wbFbsSupplyId = null;
          orphan.lines = lines;
          orphan.externalOrderIds = nextOrderIds;
          orphan.canceledExternalOrderIds = [];
          orphan.postedAt = null;
          orphan.packedToAssembled = false;
          changed = true;
        }
      }
    } else {
      const shouldRotate =
        shipment.externalOrderIds.length > 0 &&
        shipment.externalOrderIds.some((id) => isWbOrderInAssembly(statusById.get(id)));
      if (shouldRotate) {
        shipment.name = wbFbsAssemblyName(state, new Date().toISOString());
        shipment.wbFbsStage = "assembly";
        shipment.status = "draft";
        shipment.postedAt = null;
        shipment.packedToAssembled = false;

        shipment = createWbFbsCollectingShipment();
        state.shipments.unshift(shipment);
        changed = true;
      }
    }

    // Confirmed orders first seen after a gap may be absent from both /new and local groups.
    const alreadyGrouped=new Set(state.shipments.filter(entry=>entry.source==="wb-fbs").flatMap(entry=>entry.externalOrderIds));
    const recoveredIds=[...uniqueOrders.keys()].filter(id=>statusById.get(id)?.supplierStatus==="confirm"&&!isCanceledWbOrder(statusById.get(id))&&!alreadyGrouped.has(id)&&!state.wbFbs.handledOrderIds.includes(id)&&!assignedToSupply.has(id));
    if(recoveredIds.length){
      let orphan=state.shipments.find(entry=>entry.source==="wb-fbs"&&entry.status==="draft"&&entry.wbFbsStage==="assembly"&&!entry.wbFbsSupplyId);
      if(!orphan){orphan={...createWbFbsCollectingShipment(),name:wbFbsAssemblyName(state,new Date().toISOString()),wbFbsStage:"assembly",wbCabinetId:cabinetId};state.shipments.unshift(orphan);}
      const rebuilt=wbFbsLinesFromOrderIds(state,[...new Set([...orphan.externalOrderIds,...recoveredIds])],articleByOrder,orphan.lines,unknown,cabinetId);
      orphan.lines=rebuilt.lines;orphan.externalOrderIds=rebuilt.nextOrderIds;changed=true;
    }

    const activeIds = new Set(uniqueOrders.keys());
    const handled = new Set(state.wbFbs.handledOrderIds);
    const activeHandledOrders = [...activeIds].filter((id) => handled.has(id)).length;
    const assemblyOrderIds = new Set(
      state.shipments
        .filter((entry) => entry.source === "wb-fbs" && entry.wbFbsStage === "assembly")
        .flatMap((entry) => entry.externalOrderIds),
    );
    const queued = [...uniqueOrders.values()].filter(
      (order) =>
        !handled.has(order.id) &&
        !assemblyOrderIds.has(order.id) &&
        !assignedToSupply.has(order.id) &&
        !isWbOrderInAssembly(statusById.get(order.id)),
    );

    const { lines: nextLines, nextOrderIds } = wbFbsLinesFromOrderIds(
      state,
      queued.map((order) => order.id),
      articleByOrder,
      shipment.lines,
      unknown,
      cabinetId,
    );

    const shipmentChanged =
      shipment.name !== WB_FBS_SHIPMENT_NAME ||
      shipment.channel !== "FBS" ||
      shipment.source !== "wb-fbs" ||
      shipment.wbFbsStage !== "collecting" ||
      shipment.status !== "draft" ||
      shipment.postedAt !== null ||
      shipment.packedToAssembled ||
      shipment.canceledExternalOrderIds.length > 0 ||
      JSON.stringify(shipment.lines) !== JSON.stringify(nextLines) ||
      JSON.stringify(shipment.externalOrderIds) !== JSON.stringify(nextOrderIds);

    if (shipmentChanged) {
      shipment.name = WB_FBS_SHIPMENT_NAME;
      shipment.channel = "FBS";
      shipment.source = "wb-fbs";
      shipment.wbFbsStage = "collecting";
      shipment.wbFbsSupplyId = null;
      shipment.status = "draft";
      shipment.lines = nextLines;
      shipment.postedAt = null;
      shipment.packedToAssembled = false;
      shipment.externalOrderIds = nextOrderIds;
      shipment.canceledExternalOrderIds = [];
      changed = true;
    }

    for (const entry of [...state.shipments]) {
      if (entry.source !== "wb-fbs" || entry.wbFbsStage !== "assembly") continue;
      const canceledIds = new Set(entry.canceledExternalOrderIds);
      for (const id of entry.externalOrderIds) {
        if (isCanceledWbOrder(statusById.get(id))) canceledIds.add(id);
      }
      if (canceledIds.size > 0 && removeWbFbsOrderIds(state, entry, canceledIds)) changed = true;
    }

    const unknownArticles = [...unknown.entries()]
      .map(([article, qty]) => ({ article, qty }))
      .sort((a, b) => a.article.localeCompare(b.article, "ru"));
  return {
    changed:changed||beforeAssembly!==JSON.stringify(state.fbsAssembly??{}),
    activeOrders: uniqueOrders.size,
    queuedOrders: queued.length,
    matchedOrders: nextOrderIds.length,
    handledOrders: activeHandledOrders,
    unknownArticles,
  };
}

export function syncWbFbsShipment(
  orders: WbFbsOrderInput[],
  orderStatuses: WbFbsOrderStatusInput[] = [],
  supplyOrders: WbFbsSupplyOrdersInput[] = [],
  cabinetId = "legacy",
): WbFbsShipmentSyncResult {
  return mutateExternal((state) => {
    const result = applyWbFbsShipmentSync(state, orders, orderStatuses, supplyOrders, cabinetId);
    return { changed: result.changed, result };
  });
}

export function clearWbFbsShipment() {
  return mutateExternal((state) => {
    let changed = false;
    const shipment = state.shipments.find(
      (entry) => entry.source === "wb-fbs" && entry.wbFbsStage !== "assembly",
    );
    if (shipment) {
      changed =
        changed ||
        shipment.lines.length > 0 ||
        shipment.externalOrderIds.length > 0 ||
        shipment.status !== "draft" ||
        shipment.postedAt !== null ||
        shipment.packedToAssembled ||
        shipment.canceledExternalOrderIds.length > 0;
      shipment.name = WB_FBS_SHIPMENT_NAME;
      shipment.wbFbsStage = "collecting";
      shipment.lines = [];
      shipment.externalOrderIds = [];
      shipment.canceledExternalOrderIds = [];
      shipment.status = "draft";
      shipment.postedAt = null;
      shipment.packedToAssembled = false;
    }
    return { changed, result: undefined };
  });
}

const CREATE_WB_FBO_STATUSES = new Set([2]);
const KEEP_WB_FBO_STATUSES = new Set([2, 3]);

export type WbFboGoodInput = {
  article: string;
  qty: number;
};

export type WbFboSupplyInput = {
  id: number;
  warehouseName: string;
  statusId: number;
  boxTypeId: number;
  updatedAt: string;
  goodsLoaded: boolean;
  goods: WbFboGoodInput[];
};

export type WbFboShipmentSyncResult = {
  changed: boolean;
  activeSupplies: number;
  matchedSupplies: number;
  handledSupplies: number;
  unknownArticles: WbFbsUnknownArticle[];
};

function wbFboShipmentName(supply: WbFboSupplyInput, previousName?: string) {
  const warehouse = supply.warehouseName.trim();
  if (!warehouse && previousName) return previousName;
  return `FBW · ${warehouse || "WB"} · ${supply.id}`;
}

export function applyWbFboShipmentSync(state: AppState, supplies: WbFboSupplyInput[]): WbFboShipmentSyncResult {
  let changed = false;
  const handled = new Set(state.wbFbo.handledSupplyIds);
  const unknown = new Map<string, number>();
  const open = supplies.filter(
    (supply) => CREATE_WB_FBO_STATUSES.has(supply.statusId) && supply.boxTypeId !== 0 && supply.id > 0,
  );
  const keptIds = new Set(
    supplies.filter((supply) => KEEP_WB_FBO_STATUSES.has(supply.statusId) && supply.id > 0).map((supply) => supply.id),
  );
  let matchedSupplies = 0;

  for (const supply of open) {
    if (handled.has(supply.id)) continue;
    const posted = state.shipments.find(
      (entry) => entry.source === "wb-fbo" && entry.externalSupplyId === supply.id && entry.status === "posted",
    );
    if (posted) {
      handled.add(supply.id);
      continue;
    }

    let shipment = state.shipments.find(
      (entry) => entry.source === "wb-fbo" && entry.externalSupplyId === supply.id,
    );
    if (!shipment) {
      shipment = {
        id: nowId("ship"),
        name: wbFboShipmentName(supply),
        channel: "FBW",
        source: "wb-fbo",
        wbFbsStage: null,
        wbFboStatusId: supply.statusId,
        status: "draft",
        lines: [],
        postedAt: null,
        packedToAssembled: false,
        externalOrderIds: [],
        canceledExternalOrderIds: [],
        externalSupplyId: supply.id,
        wbFbsSupplyId: null,
        externalUpdatedAt: null,
      };
      state.shipments.unshift(shipment);
      changed = true;
    }

    if (!supply.goodsLoaded) {
      const nextName = wbFboShipmentName(supply, shipment.name);
      if (shipment.wbFboStatusId !== supply.statusId || shipment.name !== nextName) {
        shipment.wbFboStatusId = supply.statusId;
        shipment.name = nextName;
        changed = true;
      }
      matchedSupplies += 1;
      continue;
    }

    const matched = new Map<string, { item: Item; qty: number }>();
    for (const good of supply.goods) {
      const qty = Math.max(0, asInt(good.qty));
      if (qty <= 0) continue;
      const item = finishedByWbArticle(state, good.article);
      if (!item) {
        const label = good.article.trim() || "(артикул не указан)";
        unknown.set(label, (unknown.get(label) ?? 0) + qty);
        continue;
      }
      const group = matched.get(item.id) ?? { item, qty: 0 };
      group.qty += qty;
      matched.set(item.id, group);
    }
    matchedSupplies += 1;

    const oldLines = new Map(shipment.lines.map((line) => [line.finishedItemId, line]));
    const nextLines = [...matched.values()]
      .sort((a, b) => a.item.sku.localeCompare(b.item.sku, "ru"))
      .map(({ item, qty }) => {
        const old = oldLines.get(item.id);
        return {
          id: old?.id ?? nowId("sline"),
          finishedItemId: item.id,
          qty,
          assembled: Boolean(old?.assembled && old.qty === qty),
          externalOrderIds: [],
        };
      });
    const nextName = wbFboShipmentName(supply, shipment.name);
    const shipmentChanged =
      shipment.name !== nextName ||
      shipment.channel !== "FBW" ||
      shipment.source !== "wb-fbo" ||
      shipment.status !== "draft" ||
      shipment.wbFboStatusId !== supply.statusId ||
      shipment.externalSupplyId !== supply.id ||
      shipment.externalUpdatedAt !== supply.updatedAt ||
      JSON.stringify(shipment.lines) !== JSON.stringify(nextLines);

    if (shipmentChanged) {
      shipment.name = nextName;
      shipment.channel = "FBW";
      shipment.source = "wb-fbo";
      shipment.status = "draft";
      shipment.wbFboStatusId = supply.statusId;
      shipment.externalSupplyId = supply.id;
      shipment.externalUpdatedAt = supply.updatedAt;
      shipment.lines = nextLines;
      changed = true;
    }
  }

  for (const shipment of [...state.shipments]) {
    if (shipment.source !== "wb-fbo" || shipment.status !== "draft" || shipment.externalSupplyId == null) continue;
    if (keptIds.has(shipment.externalSupplyId)) {
      const found = supplies.find((supply) => supply.id === shipment.externalSupplyId);
      if (found && shipment.wbFboStatusId !== found.statusId) {
        shipment.wbFboStatusId = found.statusId;
        changed = true;
      }
      continue;
    }
    state.shipments = state.shipments.filter((entry) => entry.id !== shipment.id);
    changed = true;
  }

  state.wbFbo.handledSupplyIds = [...handled].sort((a, b) => a - b);
  return {
    changed,
    activeSupplies: open.length,
    matchedSupplies,
    handledSupplies: handled.size,
    unknownArticles: [...unknown.entries()]
      .map(([article, qty]) => ({ article, qty }))
      .sort((a, b) => a.article.localeCompare(b.article, "ru")),
  };
}

export function syncWbFboSupplies(supplies: WbFboSupplyInput[]): WbFboShipmentSyncResult {
  return mutateExternal((state) => {
    const result = applyWbFboShipmentSync(state, supplies);
    return { changed: result.changed, result };
  });
}

export function applyManualShipmentCreation(state: AppState, name: string, channel: Shipment["channel"]) {
  if (channel === "FBS") {
    throw new Error("FBS-поставки загружаются из WB. Ручное создание недоступно.");
  }
  const title = name.trim() || `Поставка ${state.shipments.length + 1}`;
  state.shipments.unshift({
    id: nowId("ship"),
    name: title,
    channel,
    source: "manual",
    wbFbsStage: null,
    wbFboStatusId: null,
    status: "draft",
    lines: [],
    postedAt: null,
    packedToAssembled: false,
    externalOrderIds: [],
    canceledExternalOrderIds: [],
    externalSupplyId: null,
    wbFbsSupplyId: null,
    externalUpdatedAt: null,
  });
}

export function addShipment(name: string, channel: Shipment["channel"], actor: AppUser) {
  return mutate(actor, (state) => {
    applyManualShipmentCreation(state, name, channel);
  });
}

export function applyShipmentDeletion(state: AppState, id: string, actor: AppUser, expectedSnapshot?: string) {
  const shipment = state.shipments.find((entry) => entry.id === id);
  if (!shipment) throw new Error("Поставка не найдена");
  const fbs = shipment.channel === "FBS" || shipment.source === "wb-fbs";
  if (fbs) requireAdmin(actor);
  if (shipment.status === "posted") throw new Error("Проведённую поставку нельзя удалить");
  if (shipment.source === "wb-fbo") {
    throw new Error("Поставка из WB удаляется сама, если её отменили или удалили в кабинете");
  }
  if (fbs && expectedSnapshot !== shipmentDeletionSnapshot(shipment)) {
    throw new Error("Поставка изменилась. Обновите страницу, проверьте её состав и повторите удаление");
  }
  if (shipment.source === "wb-fbs") {
    // Local exclusion only: WB orders and warehouse balances are not modified.
    const handled = new Set(state.wbFbs.handledOrderIds);
    for (const orderId of [...shipment.externalOrderIds, ...shipment.lines.flatMap((line) => line.externalOrderIds)]) {
      handled.add(orderId);
    }
    state.wbFbs.handledOrderIds = [...handled].sort((a, b) => a - b);
  }
  if(shipment.source==="ozon-fbs")state.ozonFbs={...state.ozonFbs,handled:[...new Set([...(state.ozonFbs?.handled??[]),...(shipment.ozonPostingIds??[]).map(id=>shipment.ozonClientId+":"+id)])]};
  state.shipments = state.shipments.filter((entry) => entry.id !== id);
}

export function deleteShipment(id: string, actor: AppUser, expectedSnapshot?: string) {
  return mutate(actor, (state) => {
    applyShipmentDeletion(state, id, actor, expectedSnapshot);
  });
}

function resolveShipmentItemId(state: AppState, itemId: string, skuQuery: string) {
  if (itemId) {
    const item = itemById(state, itemId);
    if (!item) throw new Error("Выберите товар");
    return item.id;
  }
  const q = skuQuery.trim().toLowerCase();
  if (!q) throw new Error("Введите или выберите артикул");
  const exact = state.items.find((item) => item.sku.toLowerCase() === q || item.name.toLowerCase() === q);
  if (exact) return exact.id;
  const partial = state.items.filter((item) => item.sku.toLowerCase().includes(q) || item.name.toLowerCase().includes(q));
  if (partial.length === 1) return partial[0].id;
  if (partial.length === 0) throw new Error(`Артикул «${skuQuery.trim()}» не найден`);
  throw new Error("Найдено несколько артикулов — уточните название");
}

export function addShipmentLine(shipmentId: string, finishedItemId: string, qty: number, actor: AppUser, skuQuery = "") {
  return mutate(actor, (state) => {
    const shipment = state.shipments.find((entry) => entry.id === shipmentId);
    if (!shipment || shipment.status !== "draft") throw new Error("Можно менять только черновик поставки");
    if (shipment.source === "wb-fbs" || shipment.source === "wb-fbo" || shipment.source === "ozon-fbs") {
      throw new Error("Состав автоматической поставки обновляется из WB");
    }
    const resolvedId = resolveShipmentItemId(state, finishedItemId, skuQuery);
    const amount = requireInt(qty);
    const existing = shipment.lines.find((line) => line.finishedItemId === resolvedId);
    if (shipment.channel === "STOCK" && itemById(state, resolvedId)?.stockKind !== "finished") {
      throw new Error("Для сборки на склад выберите готовый товар из «Комплектов»");
    }
    if (existing) {
      if (existing.assembled) throw new Error("Сначала снимите отметку «Собрано», затем добавьте количество");
      existing.qty += amount;
    }
    else {
      shipment.lines.push({
        id: nowId("sline"),
        finishedItemId: resolvedId,
        qty: amount,
        assembled: false,
        externalOrderIds: [],
      });
    }
  });
}

export function applyShipmentLineUpdate(
  state: AppState,
  shipmentId: string,
  lineId: string,
  qty: number,
  assembled: boolean,
  expectedAssembled?: boolean,
) {
  const shipment = state.shipments.find((entry) => entry.id === shipmentId);
  if (!shipment || shipment.status !== "draft") throw new Error("Можно менять только черновик поставки");
  const line = shipment.lines.find((entry) => entry.id === lineId);
  if (!line) throw new Error("Строка поставки не найдена");
  const amount = requireInt(qty);
  if (expectedAssembled !== undefined && (line.assembled !== expectedAssembled || line.qty !== amount)) {
    throw new Error("Строка уже изменена. Обновите страницу и проверьте количество и отметку сборки");
  }
  if (line.assembled && amount !== line.qty) {
    throw new Error("Сначала снимите отметку «Собрано», затем измените количество");
  }
  if ((shipment.source === "wb-fbs" || shipment.source === "wb-fbo" || shipment.source === "ozon-fbs") && amount !== line.qty) {
    throw new Error("Количество в автоматической поставке обновляется из WB");
  }
  line.qty = amount;
  line.assembled = assembled;
  markFbsAssembly(state,shipment,line,assembled);
}

export function updateShipmentLine(shipmentId: string, lineId: string, qty: number, assembled: boolean, actor: AppUser, expectedAssembled?: boolean) {
  return mutate(actor, (state) => {
    applyShipmentLineUpdate(state, shipmentId, lineId, qty, assembled, expectedAssembled);
  });
}

export function deleteShipmentLine(shipmentId: string, lineId: string, actor: AppUser) {
  return mutate(actor, (state) => {
    const shipment = state.shipments.find((entry) => entry.id === shipmentId);
    if (!shipment || shipment.status !== "draft") throw new Error("Можно менять только черновик поставки");
    if (shipment.source === "wb-fbs" || shipment.source === "wb-fbo" || shipment.source === "ozon-fbs") {
      throw new Error("Состав автоматической поставки обновляется из WB");
    }
    const line = shipment.lines.find((entry) => entry.id === lineId);
    if (line?.assembled) throw new Error("Сначала снимите отметку «Собрано», затем уберите товар");
    shipment.lines = shipment.lines.filter((line) => line.id !== lineId);
  });
}

export function postShipments(ids: string[], actor: AppUser) {
  return mutate(actor, (state) => {
    applyShipmentOperation(state, ids, "post", actor.name);
  });
}

export function packShipmentsToAssembled(ids: string[], actor: AppUser) {
  return mutate(actor, (state) => {
    applyShipmentOperation(state, ids, "pack", actor.name);
  });
}

type ShipmentExecutionPlan = {
  shipment: Shipment;
  lines: {
    line: Shipment["lines"][number];
    fromFinishedStock: number;
    toAssemble: number;
  }[];
  componentNeeds: Map<string, number>;
};

function prepareShipmentPlans(state: AppState, ids: string[]): ShipmentExecutionPlan[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw new Error("Выберите хотя бы одну поставку");
  const shipments = unique.map((id) => {
    const shipment = state.shipments.find((entry) => entry.id === id);
    if (!shipment) throw new Error("Поставка не найдена");
    if (shipment.status === "posted") throw new Error(`Поставка «${shipment.name}» уже проведена`);
    if(shipment.source==="ozon-fbs"&&shipment.ozonUnknown?.length)throw new Error("Сопоставьте все товары Ozon с комплектами склада");
    if ((shipment.source === "wb-fbs"||shipment.source==="ozon-fbs") && shipment.wbFbsStage === "collecting") {
      throw new Error(`Поставку «${shipment.name}» нельзя провести, пока она копит новые заказы`);
    }
    if (shipment.lines.length === 0) throw new Error(`В поставке «${shipment.name}» нет товаров`);
    if (shipment.canceledExternalOrderIds.length > 0) {
      throw new Error(`Сначала удалите отменённые заказы из поставки «${shipment.name}»`);
    }
    return shipment;
  });
  shipments.sort((a, b) => {
    const aCollecting = a.source === "wb-fbs" && a.wbFbsStage === "collecting" ? 1 : 0;
    const bCollecting = b.source === "wb-fbs" && b.wbFbsStage === "collecting" ? 1 : 0;
    return aCollecting - bCollecting;
  });
  const summary=calcNeeds(state,shipments);
  const shortage=summary.rows.find(row=>row.toBuy>0);
  if(shortage)throw new Error(`Не хватает «${shortage.item.name}»: нужно ${shortage.needed}, есть ${shortage.onHand}; доступно после резервов ${shortage.available}`);
  const coverage = finishedCoverageForShipments(state, shipments);
  const plans: ShipmentExecutionPlan[] = [];
  const totalNeeds = new Map<string, number>();

  for (const shipment of shipments) {
    const componentNeeds = new Map<string, number>();
    const lines: ShipmentExecutionPlan["lines"] = [];
    for (const line of shipment.lines) {
      const item = itemById(state, line.finishedItemId);
      if (!item) throw new Error("В поставке есть неизвестный товар");
      const lineCoverage = coverage.get(shipmentLineKey(shipment.id, line.id)) ?? {
        fromFinishedStock: 0,
        toAssemble: line.qty,
      };
      lines.push({ line, ...lineCoverage });
      if (item.stockKind !== "finished") {
        if (shipment.channel === "STOCK") {
          throw new Error("Отдельные часы и ремешки нельзя перенести в склад упакованных");
        }
        totalNeeds.set(item.id, (totalNeeds.get(item.id) ?? 0) + line.qty);
        if (lineCoverage.toAssemble > 0) {
          throw new Error(`Не хватает «${item.name}»: нужно ${line.qty}, есть ${item.onHand}`);
        }
        continue;
      }
      if (!line.assembled) {
        throw new Error(`Отметьте «Собрано» для ${item.sku} в поставке «${shipment.name}»`);
      }
      if (lineCoverage.toAssemble <= 0) continue;

      const kit = state.kits.find((entry) => entry.finishedItemId === line.finishedItemId);
      if (!kit || kit.status !== "ok" || kit.lines.length === 0) {
        throw new Error(`Сначала настройте состав для ${item.sku}`);
      }

      for (const bom of kit.lines) {
        const qty = bom.qty * lineCoverage.toAssemble;
        componentNeeds.set(bom.componentItemId, (componentNeeds.get(bom.componentItemId) ?? 0) + qty);
        totalNeeds.set(bom.componentItemId, (totalNeeds.get(bom.componentItemId) ?? 0) + qty);
      }
    }
    plans.push({ shipment, lines, componentNeeds });
  }

  for (const [componentId, qty] of totalNeeds) {
    const item = itemById(state, componentId);
    if (!item) throw new Error("Комплектующая не найдена");
    if (item.onHand < qty) throw new Error(`Не хватает «${item.name}»: нужно ${qty}, есть ${item.onHand}`);
  }

  return plans;
}

export function applyShipmentOperation(
  state: AppState,
  ids: string[],
  operation: ShipmentOperation,
  userName: string,
) {
  const plans = prepareShipmentPlans(state, ids);
  if (operation === "post" && plans.some((plan) => plan.shipment.channel === "STOCK")) {
    throw new Error("Сборки на склад завершайте кнопкой «Добавить в склад»");
  }
  if (operation === "pack") {
    if (plans.some((plan) => plan.shipment.channel === "FBS")) {
      throw new Error("FBS-поставки нельзя отправить в склад упакованных. Проведите их кнопкой «Провести выбранные».");
    }
    if (plans.some((plan) => plan.shipment.channel !== "STOCK" || plan.shipment.source !== "manual")) {
      throw new Error("Добавлять собранные товары можно только во вкладке «Склад»");
    }
    const hasWarehouseParts = plans.some((plan) =>
      plan.lines.some(({ line }) => itemById(state, line.finishedItemId)?.stockKind !== "finished"),
    );
    if (hasWarehouseParts) {
      throw new Error(
        "Отдельные часы и ремешки нельзя перенести в склад упакованных. Нажмите «Провести выбранные» — они спишутся со склада.",
      );
    }
  }
  const at = new Date().toISOString();
  const reason = operation === "pack" ? SHIPMENT_PACK_REASON : SHIPMENT_POST_REASON;
  const documents: ShipmentDocument[] = [];

  for (const plan of plans) {
    const documentId = nowId("shipdoc");
    documents.push({
      id: documentId,
      at,
      userName,
      shipmentId: plan.shipment.id,
      shipmentName: plan.shipment.name,
      ...(plan.shipment.source==="ozon-fbs"?{ozonClientId:plan.shipment.ozonClientId,ozonPostingIds:[...(plan.shipment.ozonPostingIds??[])]}:{}),
      channel: plan.shipment.channel,
      operation,
      lines: plan.lines.map(({ line, fromFinishedStock, toAssemble }) => ({
        finishedItemId: line.finishedItemId,
        qty: line.qty,
        fromFinishedStock,
        assembledForShipment: toAssemble,
        externalOrderIds: [...line.externalOrderIds],
      })),
    });

    for (const [componentId, qty] of plan.componentNeeds) {
      const item = itemById(state, componentId);
      if (item) {
        log(state, item, -qty, reason, plan.shipment.name, userName, {
          at,
          shipmentDocumentId: documentId,
        });
      }
    }

    for (const { line, fromFinishedStock, toAssemble } of plan.lines) {
      const item = itemById(state, line.finishedItemId);
      if (!item) continue;
      const delta =
        item.stockKind !== "finished"
          ? -fromFinishedStock
          : operation === "pack"
            ? toAssemble
            : -fromFinishedStock;
      if (delta !== 0) {
        log(state, item, delta, reason, plan.shipment.name, userName, {
          at,
          shipmentDocumentId: documentId,
        });
      }
    }
  }

  state.shipmentDocuments.unshift(...documents);
  completeShipments(
    state,
    plans.map((plan) => plan.shipment),
  );
}

function completeShipments(state: AppState, shipments: Shipment[]) {
  const handled = new Set(state.wbFbs.handledOrderIds);
  const handledSupplies = new Set(state.wbFbo.handledSupplyIds);
  const handledOzon = new Set(state.ozonFbs?.handled??[]);
  const completedIds = new Set(shipments.map((shipment) => shipment.id));
  for (const shipment of shipments) {
    if(shipment.source==="ozon-fbs")for(const id of shipment.ozonPostingIds??[])handledOzon.add(shipment.ozonClientId+":"+id);
    if (shipment.source === "wb-fbs") {
      for (const orderId of [...shipment.externalOrderIds, ...shipment.lines.flatMap((line) => line.externalOrderIds)]) {
        handled.add(orderId);
      }
    }
    if (shipment.source === "wb-fbo" && shipment.externalSupplyId) {
      handledSupplies.add(shipment.externalSupplyId);
    }
  }
  state.wbFbs.handledOrderIds = [...handled].sort((a, b) => a - b);
  state.wbFbo.handledSupplyIds = [...handledSupplies].sort((a, b) => a - b);
  state.ozonFbs={...state.ozonFbs,handled:[...handledOzon]};
  // The immutable shipment document is already in history; do not leave an empty reusable draft.
  state.shipments = state.shipments.filter((shipment) => !completedIds.has(shipment.id));
}

export function applyReturnedToAssembled(
  state: AppState,
  finishedItemId: string,
  qty: number,
  reference: string | null,
  userName: string,
) {
  const item = itemById(state, finishedItemId);
  if (!item || item.stockKind !== "finished") throw new Error("Выберите готовый товар");
  const amount = requireInt(qty);
  log(state, item, amount, "Возврат пригодного к продаже", reference, userName);
}

export function addReturnedToAssembled(finishedItemId: string, qty: number, reference: string | null, actor: AppUser) {
  return mutate(actor, (state) => {
    applyReturnedToAssembled(state, finishedItemId, qty, reference, actor.name);
  });
}

export function reverseMovement(id: string, actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const movement = state.movements.find((row) => row.id === id);
    if (!movement) throw new Error("Запись не найдена");
    if (movement.reversed) throw new Error("Это действие уже отменено");
    if (movement.delta === 0) throw new Error("Эту запись нельзя отменить");
    const item = itemById(state, movement.itemId);
    if (!item) throw new Error("Товар из этой записи уже удалён");
    movement.reversed = true;
    log(state, item, -movement.delta, `Отмена: ${movement.reason}`, movement.id, actor.name);
  });
}

export function addEmployee(name: string, actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const title = name.trim();
    if (!title) throw new Error("Укажите имя сотрудника");
    if (state.users.some((user) => user.name.toLowerCase() === title.toLowerCase())) {
      throw new Error("Такое имя уже есть");
    }
    state.users.push({ id: nowId("user"), name: title, role: "employee" });
  });
}

export function renameUser(id: string, name: string, actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const user = state.users.find((entry) => entry.id === id);
    if (!user) throw new Error("Пользователь не найден");
    const title = name.trim();
    if (!title) throw new Error("Укажите имя");
    user.name = title;
  });
}

export function removeEmployee(id: string, actor: AppUser) {
  requireAdmin(actor);
  return mutate(actor, (state) => {
    const user = state.users.find((entry) => entry.id === id);
    if (!user) throw new Error("Пользователь не найден");
    if (user.role === "admin") throw new Error("Администратора удалить нельзя");
    state.users = state.users.filter((entry) => entry.id !== id);
  });
}

export function syncOzonPostings(clientId:string,postings:OzonPosting[],mapping:Record<string,string>={}){return mutateExternal(state=>{const result=applyOzonPostings(state,clientId,postings,mapping);return {changed:result.changed,result};});}

export function syncOzonSnapshot(snapshot:OzonSnapshot,mapping:Record<string,string>={}){return mutateExternal(state=>{const result=applyOzonSnapshot(state,snapshot,mapping);return {changed:result.changed,result};});}
