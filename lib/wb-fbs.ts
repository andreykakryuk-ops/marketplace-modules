import "server-only";
import {canonicalArticle} from './article-mapping';
import {readMarketplaceSettings} from './connectors';
import {readState} from './store';
import {collectRecoveryOrders,readRecoveryResponse} from "./wb-fbs-recovery.cjs";
import {warehouseWbConnection} from "./wb-shared-connection";

import fs from "node:fs";
import path from "node:path";
import {
  clearWbFbsShipment,
  readWbFbsTrackedOrderIds,
  syncWbFbsShipment,
  type WbFbsOrderInput,
  type WbFbsOrderStatusInput,
  type WbFbsShipmentSyncResult,
  type WbFbsSupplyOrdersInput,
} from "@/lib/store";
import type { WbFbsStatus, WbFbsUnknownArticle } from "@/lib/types";
import { writeJsonFileAtomic } from "@/lib/atomic-file";

const WB_FBS_ORDERS_URL = "https://marketplace-api.wildberries.ru/api/v3/orders/new";
const WB_FBS_STATUSES_URL = "https://marketplace-api.wildberries.ru/api/v3/orders/status";
const WB_FBS_SUPPLIES_URL = "https://marketplace-api.wildberries.ru/api/v3/supplies";
const WB_FBS_HOST = "https://marketplace-api.wildberries.ru";
const CONFIG_PATH = path.join(process.cwd(), "data", "wb-fbs-config.json");
const AUTO_SYNC_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const SUPPLY_GAP_MS = 250;

type WbFbsConfig = {
  token: string;
  enabled: boolean;
  lastAttemptAt: string | null;
  lastSyncedAt: string | null;
  lastRecoveryAt: string | null;
  lastError: string | null;
  activeOrders: number;
  queuedOrders: number;
  matchedOrders: number;
  handledOrders: number;
  unknownArticles: WbFbsUnknownArticle[];
};

export type WbFbsSyncResponse = {
  ok: boolean;
  changed: boolean;
  status: WbFbsStatus;
};

type WbOrderResponse = {
  orders?: unknown;
};

type WbOrder = {
  id?: unknown;
  article?: unknown;
  deliveryType?: unknown;
};

type WbOrderStatus = {
  id?: unknown;
  supplierStatus?: unknown;
  wbStatus?: unknown;
};

const CANCELED_WB_STATUSES = new Set([
  "cancel",
  "canceled",
  "canceled_by_client",
  "declined_by_client",
  "defect",
  "canceled_by_carrier",
]);

const EMPTY_CONFIG: WbFbsConfig = {
  token: "",
  enabled: false,
  lastAttemptAt: null,
  lastSyncedAt: null,
  lastRecoveryAt: null,
  lastError: null,
  activeOrders: 0,
  queuedOrders: 0,
  matchedOrders: 0,
  handledOrders: 0,
  unknownArticles: [],
};

function cloneEmptyConfig(): WbFbsConfig {
  return { ...EMPTY_CONFIG, unknownArticles: [] };
}

function asNonNegativeInt(value: unknown) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeUnknownArticles(value: unknown): WbFbsUnknownArticle[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const article = String((row as { article?: unknown }).article ?? "").trim();
      const qty = asNonNegativeInt((row as { qty?: unknown }).qty);
      return article && qty > 0 ? { article, qty } : null;
    })
    .filter((row): row is WbFbsUnknownArticle => row !== null);
}

function readLegacyConfig(): WbFbsConfig {
  if (!fs.existsSync(CONFIG_PATH)) return cloneEmptyConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<WbFbsConfig>;
    return {
      token: String(raw.token ?? "").trim(),
      enabled: Boolean(raw.enabled),
      lastAttemptAt: raw.lastAttemptAt ? String(raw.lastAttemptAt) : null,
      lastSyncedAt: raw.lastSyncedAt ? String(raw.lastSyncedAt) : null,
      lastRecoveryAt: raw.lastRecoveryAt ? String(raw.lastRecoveryAt) : null,
      lastError: raw.lastError ? String(raw.lastError) : null,
      activeOrders: asNonNegativeInt(raw.activeOrders),
      queuedOrders: asNonNegativeInt(raw.queuedOrders),
      matchedOrders: asNonNegativeInt(raw.matchedOrders),
      handledOrders: asNonNegativeInt(raw.handledOrders),
      unknownArticles: normalizeUnknownArticles(raw.unknownArticles),
    };
  } catch {
    return { ...cloneEmptyConfig(), lastError: "Не удалось прочитать настройки WB Seller API" };
  }
}

function readConfig(): WbFbsConfig {const old=readLegacyConfig(),shared=warehouseWbConnection();return shared?{...old,token:shared.token,enabled:!shared.paused}:old;}

function writeConfig(config: WbFbsConfig) {
  writeJsonFileAtomic(CONFIG_PATH, {...config,token:warehouseWbConnection()?'':config.token}, 0o600);
}

function statusOf(config: WbFbsConfig): WbFbsStatus {
  const configured = Boolean(config.token);
  return {
    configured,
    enabled: configured && config.enabled,
    lastSyncedAt: config.lastSyncedAt,
    lastError: config.lastError,
    activeOrders: config.activeOrders,
    queuedOrders: config.queuedOrders,
    matchedOrders: config.matchedOrders,
    handledOrders: config.handledOrders,
    unknownArticles: config.unknownArticles,
  };
}

export function readWbFbsStatus(): WbFbsStatus {
  return statusOf(readConfig());
}

function wbErrorMessage(status: number, _body: string, retryAfter: string | null) {
  if (status === 401) return "WB отклонил API-ключ: ключ неверный или истёк";
  if (status === 402) return "WB API требует доступ по действующим условиям кабинета продавца";
  if (status === 403) return "У API-ключа нет доступа к категории «Маркетплейс»";
  if (status === 429) {
    return retryAfter
      ? `WB временно ограничил запросы. Повторите через ${retryAfter} сек.`
      : "WB временно ограничил запросы. Повторите позже";
  }
  return `WB API вернул ошибку ${status}`;
}

async function fetchNewFbsOrders(token: string): Promise<WbFbsOrderInput[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(WB_FBS_ORDERS_URL, {
      method: "GET",
      headers: {
        Authorization: token,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(wbErrorMessage(response.status, body, response.headers.get("x-ratelimit-retry")));
    }

    const payload = (await response.json()) as WbOrderResponse;
    if (!Array.isArray(payload.orders)) throw new Error("WB API вернул ответ без списка заказов");
    return payload.orders
      .map((raw): WbFbsOrderInput | null => {
        if (!raw || typeof raw !== "object") return null;
        const order = raw as WbOrder;
        if (order.deliveryType != null && String(order.deliveryType).toLowerCase() !== "fbs") return null;
        const id = Math.round(Number(order.id));
        if (!Number.isFinite(id) || id <= 0) return null;
        return { id, article: String(order.article ?? "").trim() };
      })
      .filter((order): order is WbFbsOrderInput => order !== null);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("WB API не ответил за 15 секунд");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOrderStatuses(token: string, orderIds: number[]): Promise<WbFbsOrderStatusInput[]> {
  const uniqueOrderIds = [...new Set(orderIds)];
  if (uniqueOrderIds.length === 0) return [];
  const statuses = new Map<number, WbFbsOrderStatusInput>();

  for (let offset = 0; offset < uniqueOrderIds.length; offset += 1000) {
    await sleep(SUPPLY_GAP_MS);
    const batch = uniqueOrderIds.slice(offset, offset + 1000);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(WB_FBS_STATUSES_URL, {
        method: "POST",
        headers: {
          Authorization: token,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ orders: batch }),
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(wbErrorMessage(response.status, body, response.headers.get("x-ratelimit-retry")));
      }

      const payload = (await response.json()) as { orders?: unknown };
      if (!Array.isArray(payload.orders)) throw new Error("WB API вернул ответ без статусов заказов");
      for (const raw of payload.orders) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as WbOrderStatus;
        const id = Math.round(Number(row.id));
        if (!Number.isFinite(id) || id <= 0) continue;
        statuses.set(id, {
          id,
          supplierStatus: String(row.supplierStatus ?? "").toLowerCase(),
          wbStatus: String(row.wbStatus ?? "").toLowerCase(),
        });
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("WB API не ответил за 15 секунд");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (uniqueOrderIds.some((id) => !statuses.has(id))) {
    throw new Error("WB API вернул статусы не для всех FBS-заказов");
  }
  return [...statuses.values()];
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchOpenFbsSupplyOrders(token: string): Promise<WbFbsSupplyOrdersInput[]> {
  const openIds: string[] = [];
  let next = 0;
  for (let page = 0; page < 20; page += 1) {
    if (page > 0) await sleep(SUPPLY_GAP_MS);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${WB_FBS_SUPPLIES_URL}?limit=1000&next=${next}`, {
        method: "GET",
        headers: {
          Authorization: token,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(wbErrorMessage(response.status, body, response.headers.get("x-ratelimit-retry")));
      }
      const payload = (await response.json()) as { next?: unknown; supplies?: unknown };
      const rows = Array.isArray(payload.supplies) ? payload.supplies : [];
      for (const raw of rows) {
        if (!raw || typeof raw !== "object") continue;
        const row = raw as { id?: unknown; done?: unknown };
        const id = String(row.id ?? "").trim();
        if (!id || row.done === true) continue;
        openIds.push(id);
      }
      const nextValue = Math.round(Number(payload.next));
      if (!Number.isFinite(nextValue) || nextValue <= 0 || nextValue === next || rows.length === 0) break;
      next = nextValue;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("WB API не ответил за 15 секунд");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  const result: WbFbsSupplyOrdersInput[] = [];
  for (const [index, supplyId] of openIds.entries()) {
    if (index > 0) await sleep(SUPPLY_GAP_MS);
    const orderIds = await fetchSupplyOrderIds(token, supplyId);
    if (orderIds.length > 0) result.push({ supplyId, orderIds });
  }
  return result;
}

function parseSupplyOrderIds(payload: unknown): number[] {
  if (!payload || typeof payload !== "object") return [];
  const row = payload as { orderIds?: unknown; orders?: unknown };
  const fromIds = Array.isArray(row.orderIds) ? row.orderIds : [];
  const fromOrders = Array.isArray(row.orders) ? row.orders : [];
  const raw = fromIds.length > 0 ? fromIds : fromOrders;
  return raw
    .map((entry) => {
      if (entry && typeof entry === "object" && "id" in entry) {
        return Math.round(Number((entry as { id?: unknown }).id));
      }
      return Math.round(Number(entry));
    })
    .filter((id) => Number.isFinite(id) && id > 0);
}

async function fetchSupplyOrderIds(token: string, supplyId: string): Promise<number[]> {
  const encoded = encodeURIComponent(supplyId);
  const urls = [
    `${WB_FBS_HOST}/api/marketplace/v3/supplies/${encoded}/order-ids`,
    `${WB_FBS_SUPPLIES_URL}/${encoded}/order-ids`,
    `${WB_FBS_SUPPLIES_URL}/${encoded}/orders`,
  ];
  for (const [index, url] of urls.entries()) {
    if (index > 0) await sleep(SUPPLY_GAP_MS);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: token,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.status === 404) continue;
      if (!response.ok) {
        const body = await response.text();
        throw new Error(wbErrorMessage(response.status, body, response.headers.get("x-ratelimit-retry")));
      }
      return parseSupplyOrderIds(await response.json());
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("WB API не ответил за 15 секунд");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
  return [];
}

async function fetchRecoveryOrders(token:string){
 const now=new Date(),from=new Date(now);const wanted=from.getUTCDate();from.setUTCDate(1);from.setUTCMonth(from.getUTCMonth()-3);from.setUTCDate(Math.min(wanted,new Date(Date.UTC(from.getUTCFullYear(),from.getUTCMonth()+1,0)).getUTCDate()));from.setUTCSeconds(from.getUTCSeconds()+60);
 return collectRecoveryOrders(async query=>{
  await sleep(SUPPLY_GAP_MS);
  const response=await fetch(WB_FBS_HOST+"/api/v3/orders?"+new URLSearchParams(Object.fromEntries(Object.entries(query).map(([key,value])=>[key,String(value)]))),{headers:{Authorization:token,Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(REQUEST_TIMEOUT_MS)});
  if(!response.ok)throw new Error(wbErrorMessage(response.status,"",response.headers.get("x-ratelimit-retry")));
  return readRecoveryResponse(response);
 },Math.floor(from.getTime()/1000),Math.floor(now.getTime()/1000));
}

async function fetchCurrentFbsOrders(token: string, recover=false) {
  const newOrders = await fetchNewFbsOrders(token);
  const recoveryOrders=recover?await fetchRecoveryOrders(token):[];
  const candidates=[...new Map([...recoveryOrders,...newOrders].map(order=>[order.id,order])).values()];
  const trackedOrderIds = readWbFbsTrackedOrderIds();
  let supplyOrders: WbFbsSupplyOrdersInput[] = [];
  try {
    supplyOrders = await fetchOpenFbsSupplyOrders(token);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/ошибку 404|path not found/i.test(message)) throw error;
  }
  const statuses = await fetchOrderStatuses(token, [
    ...candidates.map((order) => order.id),
    ...trackedOrderIds,
    ...supplyOrders.flatMap((group) => group.orderIds),
  ]);
  const statusById = new Map(statuses.map((status) => [status.id, status]));
  const orders = candidates.filter((order) => {
    const status = statusById.get(order.id);
    return (
      ["new","confirm"].includes(status?.supplierStatus??"") &&
      !CANCELED_WB_STATUSES.has(status?.supplierStatus??"") &&
      !CANCELED_WB_STATUSES.has(status?.wbStatus??"")
    );
  });
  return { orders, statuses, supplyOrders };
}

function applySyncResult(config: WbFbsConfig, result: WbFbsShipmentSyncResult, at: string): WbFbsConfig {
  return {
    ...config,
    enabled: true,
    lastAttemptAt: at,
    lastSyncedAt: at,
    lastError: null,
    activeOrders: result.activeOrders,
    queuedOrders: result.queuedOrders,
    matchedOrders: result.matchedOrders,
    handledOrders: result.handledOrders,
    unknownArticles: result.unknownArticles,
  };
}

let syncInFlight: Promise<WbFbsSyncResponse> | null = null;

async function performSync(force: boolean): Promise<WbFbsSyncResponse> {
  let config = readConfig();
  if (!config.token || !config.enabled) {
    return { ok: true, changed: false, status: statusOf(config) };
  }

  if (!force && config.lastAttemptAt) {
    const elapsed = Date.now() - Date.parse(config.lastAttemptAt);
    if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < AUTO_SYNC_INTERVAL_MS - 2_000) {
      return { ok: true, changed: false, status: statusOf(config) };
    }
  }

  const attemptedAt = new Date().toISOString();
  config = { ...config, lastAttemptAt: attemptedAt };
  writeConfig(config);
  try {
    const recover=force||!config.lastRecoveryAt||Date.now()-Date.parse(config.lastRecoveryAt)>3600000;
    const snapshot = await fetchCurrentFbsOrders(config.token,recover);
    const mapping=readMarketplaceSettings().wbArticles??{},items=readState().items;
    const result = syncWbFbsShipment(snapshot.orders.map(o=>({...o,article:canonicalArticle(o.article,mapping,items)})), snapshot.statuses, snapshot.supplyOrders, warehouseWbConnection()?.storeId??"legacy");
    config = applySyncResult(config, result, attemptedAt);
    if(recover)config.lastRecoveryAt=attemptedAt;
    writeConfig(config);
    return { ok: true, changed: result.changed, status: statusOf(config) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить FBS-заказы";
    config = { ...config, lastAttemptAt: attemptedAt, lastError: message };
    writeConfig(config);
    return { ok: false, changed: false, status: statusOf(config) };
  }
}

export function syncWbFbs(force = false): Promise<WbFbsSyncResponse> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = performSync(force).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export async function configureWbFbs(tokenValue: string): Promise<WbFbsSyncResponse> {
  const token = tokenValue.trim();
  if (token.length < 20) throw new Error("Вставьте полный API-ключ WB");

  const snapshot = await fetchCurrentFbsOrders(token,true);
  const result = syncWbFbsShipment(snapshot.orders, snapshot.statuses, snapshot.supplyOrders, warehouseWbConnection()?.storeId??"legacy");
  const at = new Date().toISOString();
  const config = applySyncResult({ ...cloneEmptyConfig(), token }, result, at);
  config.lastRecoveryAt=at;
  writeConfig(config);
  return { ok: true, changed: result.changed, status: statusOf(config) };
}

export function disconnectWbFbs(): WbFbsStatus {
  clearWbFbsShipment();
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
  return statusOf(cloneEmptyConfig());
}

declare global {
  var __wbFbsSyncTimer: ReturnType<typeof setInterval> | undefined;
}

export function startWbFbsScheduler() {
  if (process.env.WB_BROWSER_TEST==='1'||process.env.NEXT_PHASE==='phase-production-build'||globalThis.__wbFbsSyncTimer) return;
  void syncWbFbs();
  globalThis.__wbFbsSyncTimer = setInterval(() => {
    void syncWbFbs();
  }, AUTO_SYNC_INTERVAL_MS);
  globalThis.__wbFbsSyncTimer.unref?.();
}
