import {readMarketplaceSettings} from './connectors';
import {canonicalArticle} from './article-mapping';
import {readState} from './store';
import "server-only";
import {warehouseWbConnection} from "./wb-shared-connection";
import {mergeSupplyRows} from "@/lib/analytics/wb-inbound.cjs";

import fs from "node:fs";
import path from "node:path";
import {
  syncWbFboSupplies,
  type WbFboGoodInput,
  type WbFboShipmentSyncResult,
  type WbFboSupplyInput,
} from "@/lib/store";
import type { WbFboStatus, WbFbsUnknownArticle } from "@/lib/types";
import { writeJsonFileAtomic } from "@/lib/atomic-file";
import {
  WB_FBO_LIST_LIMIT,
  WB_FBO_LIST_STATUSES,
  mergeWbFboSupplyRows,
  wbFboListDateFilters,
  wbFboSupplyIdentity,
  type WbFboDateFilter,
} from "@/lib/wb-fbo-query";

const WB_FBO_SUPPLIES_URL = "https://supplies-api.wildberries.ru/api/v1/supplies";
const CONFIG_PATH = path.join(process.cwd(), "data", "wb-fbo-config.json");
const INBOUND_PATH = path.join(process.cwd(), "data", "wb-fbo-inbound.json");
const AUTO_SYNC_INTERVAL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 15_000;
const GOODS_GAP_MS = 2_100;
const MAX_GOODS_FETCHES = 20;

function mappedSupplies(supplies:WbFboSupplyInput[]){const mapping=readMarketplaceSettings().wbArticles??{},items=readState().items;return supplies.map(s=>({...s,goods:s.goods.map(g=>({...g,article:canonicalArticle(g.article,mapping,items)}))}));}

type WbFboConfig = {
  token: string;
  enabled: boolean;
  lastAttemptAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  activeSupplies: number;
  matchedSupplies: number;
  handledSupplies: number;
  unknownArticles: WbFbsUnknownArticle[];
};

export type WbFboSyncResponse = {
  ok: boolean;
  changed: boolean;
  status: WbFboStatus;
};

type WbSupply = {
  supplyID?: unknown;
  preorderID?: unknown;
  statusID?: unknown;
  boxTypeID?: unknown;
  updatedDate?: unknown;
  createDate?: unknown;
};

type WbSupplyDetails = WbSupply & {
  warehouseName?: unknown;
  warehouseID?: unknown;
};

type WbGood = {
  vendorCode?: unknown;
  barcode?: unknown;
  nmID?: unknown;
  quantity?: unknown;
  acceptedQuantity?: unknown;
};

const EMPTY_CONFIG: WbFboConfig = {
  token: "",
  enabled: false,
  lastAttemptAt: null,
  lastSyncedAt: null,
  lastError: null,
  activeSupplies: 0,
  matchedSupplies: 0,
  handledSupplies: 0,
  unknownArticles: [],
};

function cloneEmptyConfig(): WbFboConfig {
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

function readLegacyConfig(): WbFboConfig {
  if (!fs.existsSync(CONFIG_PATH)) return cloneEmptyConfig();
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8")) as Partial<WbFboConfig>;
    return {
      token: String(raw.token ?? "").trim(),
      enabled: Boolean(raw.enabled),
      lastAttemptAt: raw.lastAttemptAt ? String(raw.lastAttemptAt) : null,
      lastSyncedAt: raw.lastSyncedAt ? String(raw.lastSyncedAt) : null,
      lastError: raw.lastError ? String(raw.lastError) : null,
      activeSupplies: asNonNegativeInt(raw.activeSupplies),
      matchedSupplies: asNonNegativeInt(raw.matchedSupplies),
      handledSupplies: asNonNegativeInt(raw.handledSupplies),
      unknownArticles: normalizeUnknownArticles(raw.unknownArticles),
    };
  } catch {
    return { ...cloneEmptyConfig(), lastError: "Не удалось прочитать настройки WB поставок FBO" };
  }
}

function readConfig(): WbFboConfig {const old=readLegacyConfig(),shared=warehouseWbConnection();return shared?{...old,token:shared.token,enabled:!shared.paused&&readMarketplaceSettings().wb?.fboEnabled===true}:old;}

function writeConfig(config: WbFboConfig) {
  writeJsonFileAtomic(CONFIG_PATH, {...config,token:warehouseWbConnection()?'':config.token}, 0o600);
}

function statusOf(config: WbFboConfig): WbFboStatus {
  const configured = Boolean(config.token);
  return {
    configured,
    enabled: configured && config.enabled,
    lastSyncedAt: config.lastSyncedAt,
    lastError: config.lastError,
    activeSupplies: config.activeSupplies,
    matchedSupplies: config.matchedSupplies,
    handledSupplies: config.handledSupplies,
    unknownArticles: config.unknownArticles,
  };
}

export function readWbFboStatus(): WbFboStatus {
  return statusOf(readConfig());
}

function wbErrorMessage(status: number, _body: string, retryAfter: string | null) {
  if (status === 401) return "WB отклонил API-ключ: ключ неверный или истёк";
  if (status === 402) return "WB API требует доступ по действующим условиям кабинета продавца";
  if (status === 403) {
    return "У единого API-ключа WB нет доступа к категории «Поставки». Добавьте права в настройках подключения.";
  }
  if (status === 429) {
    return retryAfter
      ? `WB временно ограничил запросы. Повторите через ${retryAfter} сек.`
      : "WB временно ограничил запросы. Повторите позже";
  }
  return `WB API вернул ошибку ${status}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let previousRequestAt = 0;
async function wbFetch(url: string, token: string, init: RequestInit) {
  const gap = GOODS_GAP_MS - (Date.now() - previousRequestAt);
  if (gap > 0) await sleep(gap);
  previousRequestAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        Authorization: token,
        Accept: "application/json",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(wbErrorMessage(response.status, body, response.headers.get("x-ratelimit-retry")));
    }
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("WB API не ответил за 15 секунд");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function supplyIdOf(raw: WbSupply) {
  return wbFboSupplyIdentity(raw);
}

async function fetchSupplyListPage(token: string, filter: WbFboDateFilter, offset: number): Promise<WbSupply[]> {
  const response = await wbFetch(`${WB_FBO_SUPPLIES_URL}?limit=${WB_FBO_LIST_LIMIT}&offset=${offset}`, token, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      statusIDs: WB_FBO_LIST_STATUSES,
      dates: [filter],
    }),
  });
  const payload = (await response.json()) as unknown;
  if (!Array.isArray(payload)) throw new Error("WB API вернул ответ без списка поставок FBO");
  return payload.filter((row): row is WbSupply => Boolean(row) && typeof row === "object");
}

async function fetchSupplyListByDate(token: string, filter: WbFboDateFilter): Promise<WbSupply[]> {
  const pages: WbSupply[] = [];
  for (let offset = 0; offset < 20_000; offset += WB_FBO_LIST_LIMIT) {
    if (offset > 0) await sleep(GOODS_GAP_MS);
    const page = await fetchSupplyListPage(token, filter, offset);
    pages.push(...page);
    if (page.length < WB_FBO_LIST_LIMIT) break;
  }
  return pages;
}

async function fetchSupplyList(token: string): Promise<WbSupply[]> {
  const filters = wbFboListDateFilters();
  const pages: WbSupply[][] = [];
  for (const [index, filter] of filters.entries()) {
    if (index > 0) await sleep(GOODS_GAP_MS);
    pages.push(await fetchSupplyListByDate(token, filter));
  }
  return mergeWbFboSupplyRows(pages);
}

async function fetchSupplyDetails(token: string, id: number, isPreorder: boolean): Promise<WbSupplyDetails> {
  const url = `https://supplies-api.wildberries.ru/api/v1/supplies/${id}?isPreorderID=${isPreorder ? "true" : "false"}`;
  const response = await wbFetch(url, token, { method: "GET" });
  const payload = (await response.json()) as WbSupplyDetails;
  if (!payload || typeof payload !== "object") throw new Error("WB API вернул поставку FBO без данных");
  return payload;
}

type SupplyGoods = { legacy: WbFboGoodInput[]; raw: WbGood[] };
async function fetchSupplyGoods(token: string, id: number, isPreorder: boolean): Promise<SupplyGoods> {
  const goods = new Map<string, number>();
  const rawGoods: WbGood[] = [];
  let complete = false;
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const url = `https://supplies-api.wildberries.ru/api/v1/supplies/${id}/goods?limit=1000&offset=${offset}&isPreorderID=${isPreorder ? "true" : "false"}`;
    const response = await wbFetch(url, token, { method: "GET" });
    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) throw new Error("WB API вернул ответ без товаров поставки");
    if (payload.length === 0) { complete = true; break; }
    if (payload.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("WB API вернул некорректный состав поставки");
    rawGoods.push(...(payload as WbGood[]).map(row => ({vendorCode:row.vendorCode,barcode:row.barcode,nmID:row.nmID,quantity:row.quantity,acceptedQuantity:row.acceptedQuantity})));
    for (const raw of payload) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as WbGood;
      const article = String(row.vendorCode ?? "").trim() || String(row.barcode ?? "").trim();
      const qty = asNonNegativeInt(row.quantity);
      if (!article || qty <= 0) continue;
      goods.set(article, (goods.get(article) ?? 0) + qty);
    }
    if (payload.length < 1000) { complete = true; break; }
  }
  if (!complete) throw new Error("WB API: состав поставки превышает проверенный лимит страниц");
  return { legacy: [...goods.entries()].map(([article, qty]) => ({ article, qty })), raw: rawGoods };

}

type ObservedSupply = WbSupplyDetails & {goods: WbGood[];goodsComplete: true;goodsFetchedAt: string};
async function fetchCurrentFboSupplies(token: string, observed = new Map<string, ObservedSupply>()): Promise<WbFboSupplyInput[]> {
  const listed = await fetchSupplyList(token);
  const parsed = listed
    .map((raw) => {
      const identity = supplyIdOf(raw);
      if (!identity) return null;
      return {
        ...identity,
        statusId: asNonNegativeInt(raw.statusID),
        boxTypeId: asNonNegativeInt(raw.boxTypeID),
        updatedAt: String(raw.updatedDate ?? raw.createDate ?? ""),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .sort((a, b) => b.id - a.id);

  const result: WbFboSupplyInput[] = [];
  let goodsFetches = 0;
  for (const supply of parsed) {
    if (goodsFetches >= MAX_GOODS_FETCHES || supply.statusId !== 2) {
      result.push({
        id: supply.id,
        warehouseName: "",
        statusId: supply.statusId,
        boxTypeId: supply.boxTypeId,
        updatedAt: supply.updatedAt,
        goodsLoaded: false,
        goods: [],
      });
      continue;
    }

    if (goodsFetches > 0) await sleep(GOODS_GAP_MS);
    const details = await fetchSupplyDetails(token, supply.id, supply.isPreorder);
    await sleep(GOODS_GAP_MS);
    const goods = await fetchSupplyGoods(token, supply.id, supply.isPreorder);
    goodsFetches += 1;
    observed.set(`${supply.isPreorder ? "p" : "s"}:${supply.id}`, {...inboundSupplyFields(details), ...(supply.isPreorder ? {preorderID:supply.id} : {supplyID:supply.id}), statusID:asNonNegativeInt(details.statusID)||supply.statusId, goods:goods.raw, goodsComplete:true,goodsFetchedAt:new Date().toISOString()});
    result.push({
      id: supply.id,
      warehouseName: String(details.warehouseName ?? "").trim(),
      statusId: asNonNegativeInt(details.statusID) || supply.statusId,
      boxTypeId: asNonNegativeInt(details.boxTypeID) || supply.boxTypeId,
      updatedAt: supply.updatedAt,
      goodsLoaded: true,
      goods: goods.legacy,
    });
  }
  return result;
}


function inboundSupplyFields(row:WbSupplyDetails):WbSupplyDetails {
 const result:WbSupplyDetails = {};
 for(const key of ["supplyID","preorderID","statusID","boxTypeID","createDate","updatedDate","warehouseName","warehouseID"] as const)if(Object.hasOwn(row,key))result[key]=row[key];
 return result;
}
type InboundSnapshot = {schemaVersion:1;storeId:string;listComplete:boolean;fetchedAt:string;supplies:Array<WbSupplyDetails & {goods?:WbGood[];goodsComplete?:boolean;goodsFetchedAt?:string}>;lastError?:string|null};
function readInboundSnapshot(): InboundSnapshot | null {
 try {
  const info = fs.lstatSync(INBOUND_PATH);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 16*1024*1024) return null;
  const value = JSON.parse(fs.readFileSync(INBOUND_PATH,"utf8"));
  return value && value.schemaVersion===1 && typeof value.storeId==="string" && Array.isArray(value.supplies) ? value : null;
 } catch { return null; }
}
export function readWbFboInbound(storeId:string): InboundSnapshot | null {
 const shared=warehouseWbConnection(),snapshot=readInboundSnapshot();
 return shared && shared.storeId===storeId && !shared.paused && snapshot?.storeId===storeId ? snapshot : null;
}
async function refreshInboundSnapshot(token:string,observed:Map<string,ObservedSupply>) {
 const shared=warehouseWbConnection();
 if(!shared || shared.token!==token || shared.paused)return;
 const old=readInboundSnapshot(),prior=old?.storeId===shared.storeId?old:null;
 const key=(row:WbSupply)=>{const identity=supplyIdOf(row);return identity?`${identity.isPreorder?"p":"s"}:${identity.id}`:null;};
 try{
  const pages:WbSupply[][]=[];let complete=false;
  for(let offset=0;offset<20000;offset+=WB_FBO_LIST_LIMIT){
   const response=await wbFetch(`${WB_FBO_SUPPLIES_URL}?limit=${WB_FBO_LIST_LIMIT}&offset=${offset}`,token,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({statusIDs:[2,3,4,6],dates:[]})});
   const payload:unknown=await response.json();
   if(!Array.isArray(payload)||payload.some(row=>!row||typeof row!=="object"||Array.isArray(row)))throw Error("INVALID_SUPPLY_LIST");
   pages.push(payload as WbSupply[]);
   if(payload.length<WB_FBO_LIST_LIMIT){complete=true;break;}
  }
  const listed=mergeSupplyRows(pages.map(page=>page.map(inboundSupplyFields)));
  const cached=new Map<string,InboundSnapshot["supplies"][number]>((prior?.supplies??[]).flatMap(row=>{const k=key(row);return k?[[k,row] as const]:[];}));
  const supplies:InboundSnapshot["supplies"]=listed.map(row=>{
   const k=key(row);
   if(!k)throw Error("INVALID_SUPPLY_ID");
   const loaded=observed.get(k),previous=cached.get(k);
   if(loaded&&asNonNegativeInt(loaded.statusID)===asNonNegativeInt(row.statusID))return {...loaded,...row};
   const unchanged=previous&&previous.statusID===row.statusID&&previous.updatedDate===row.updatedDate;
   return {...(unchanged?previous:{}),...row};
  });
  const order=supplies.map((row,index)=>({row,index})).sort((a,b)=>(Date.parse(a.row.goodsFetchedAt??"")||0)-(Date.parse(b.row.goodsFetchedAt??"")||0));
  let fetched=0;
  for(const {row,index}of order){
   if(fetched>=MAX_GOODS_FETCHES)break;
   const k=key(row);
   if(k&&observed.has(k)&&row.goodsComplete)continue;
   const identity=supplyIdOf(row);if(!identity)throw Error("INVALID_SUPPLY_ID");
   const details=await fetchSupplyDetails(token,identity.id,identity.isPreorder);
   const goods=await fetchSupplyGoods(token,identity.id,identity.isPreorder);
   supplies[index]={...row,...inboundSupplyFields(details),goods:goods.raw,goodsComplete:true,goodsFetchedAt:new Date().toISOString()};
   fetched++;
  }
  const current=warehouseWbConnection();
  if(!current || current.storeId!==shared.storeId || current.token!==token || current.paused)throw Error("SUPPLY_CONNECTION_CHANGED");
  writeJsonFileAtomic(INBOUND_PATH,{schemaVersion:1,storeId:shared.storeId,listComplete:complete,fetchedAt:new Date().toISOString(),supplies,lastError:null},0o600);
 }catch{
  // A failed read cannot turn an earlier quantity into zero or erase a supply.
  if(prior)writeJsonFileAtomic(INBOUND_PATH,{...prior,listComplete:false,lastError:"SUPPLY_REFRESH_FAILED"},0o600);
 }
}

function applySyncResult(config: WbFboConfig, result: WbFboShipmentSyncResult, at: string): WbFboConfig {
  return {
    ...config,
    enabled: true,
    lastAttemptAt: at,
    lastSyncedAt: at,
    lastError: null,
    activeSupplies: result.activeSupplies,
    matchedSupplies: result.matchedSupplies,
    handledSupplies: result.handledSupplies,
    unknownArticles: result.unknownArticles,
  };
}

let syncInFlight: Promise<WbFboSyncResponse> | null = null;

async function performSync(force: boolean): Promise<WbFboSyncResponse> {
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
    const observed = new Map<string, ObservedSupply>();
    const supplies = await fetchCurrentFboSupplies(config.token, observed);
    const result = syncWbFboSupplies(mappedSupplies(supplies));
    await refreshInboundSnapshot(config.token, observed);
    config = applySyncResult(config, result, attemptedAt);
    writeConfig(config);
    return { ok: true, changed: result.changed, status: statusOf(config) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить поставки FBO";
    config = { ...config, lastAttemptAt: attemptedAt, lastError: message };
    writeConfig(config);
    return { ok: false, changed: false, status: statusOf(config) };
  }
}

export function syncWbFbo(force = false): Promise<WbFboSyncResponse> {
  if (syncInFlight) return syncInFlight;
  syncInFlight = performSync(force).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export async function configureWbFbo(tokenValue: string): Promise<WbFboSyncResponse> {
  const token = tokenValue.trim();
  if (token.length < 20) throw new Error("Вставьте полный API-ключ WB");

  const observed = new Map<string, ObservedSupply>();
  const supplies = await fetchCurrentFboSupplies(token, observed);
  const result = syncWbFboSupplies(mappedSupplies(supplies));
  await refreshInboundSnapshot(token, observed);
  const at = new Date().toISOString();
  const config = applySyncResult({ ...cloneEmptyConfig(), token }, result, at);
  writeConfig(config);
  return { ok: true, changed: result.changed, status: statusOf(config) };
}

export function disconnectWbFbo(): WbFboStatus {
  if (fs.existsSync(CONFIG_PATH)) fs.unlinkSync(CONFIG_PATH);
  return statusOf(cloneEmptyConfig());
}

declare global {
  var __wbFboSyncTimer: ReturnType<typeof setInterval> | undefined;
}

export function startWbFboScheduler() {
  if (process.env.WB_BROWSER_TEST==='1'||process.env.NEXT_PHASE==='phase-production-build'||globalThis.__wbFboSyncTimer) return;
  void syncWbFbo();
  globalThis.__wbFboSyncTimer = setInterval(() => {
    void syncWbFbo();
  }, AUTO_SYNC_INTERVAL_MS);
  globalThis.__wbFboSyncTimer.unref?.();
}
