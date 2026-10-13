import { lastBuyPrice, roundMoney } from "@/lib/cost";
import { itemTitle } from "@/lib/format";
import type { AppState, Item, Kit, Shipment } from "@/lib/types";

export type NeedRow = {
  item: Item;
  needed: number;
  onHand: number;
  reserved:number;
  available:number;
  additional:number;
  remaining: number;
  toBuy: number;
  buyCost: number;
};

export type ShipmentLineCoverage = {
  fromFinishedStock: number;
  toAssemble: number;
};

export function shipmentLineKey(shipmentId: string, lineId: string) {
  return `${shipmentId}:${lineId}`;
}

export function shipmentItemOf(state: AppState, itemId: string) {
  return state.items.find((item) => item.id === itemId);
}

export function isWarehousePart(item: Item | undefined) {
  return Boolean(item && item.stockKind !== "finished");
}

export function allocateFinishedStock(state: AppState, shipments: Shipment[]): Map<string, ShipmentLineCoverage> {
  const available = new Map(state.items.map((item) => [item.id, Math.max(0, item.onHand-item.reserved)]));
  const coverage = new Map<string, ShipmentLineCoverage>();

  for (const shipment of shipments) {
    for (const line of shipment.lines) {
      if (shipment.channel === "STOCK") {
        coverage.set(shipmentLineKey(shipment.id, line.id), { fromFinishedStock: 0, toAssemble: line.qty });
        continue;
      }
      const ready = available.get(line.finishedItemId) ?? 0;
      const fromFinishedStock = Math.min(line.qty, ready);
      coverage.set(shipmentLineKey(shipment.id, line.id), {
        fromFinishedStock,
        toAssemble: line.qty - fromFinishedStock,
      });
      available.set(line.finishedItemId, ready - fromFinishedStock);
    }
  }

  return coverage;
}

export function draftShipments(state: AppState): Shipment[] {
  return state.shipments.filter((shipment) => shipment.status === "draft");
}

function fbsDrafts(state:AppState):Shipment[]{
 return state.shipments.filter(s=>s.status==='draft'&&(s.source==='wb-fbs'||s.source==='ozon-fbs'))
  .sort((a,b)=>Number(isWbFbsCollecting(a))-Number(isWbFbsCollecting(b))||a.id.localeCompare(b.id));
}
export function finishedCoverageForShipments(state:AppState,shipments:Shipment[]){
 const view=state.shipmentReservationView;
 if(view){
  const nonFbs=shipments.filter(s=>s.status==='draft'&&s.source!=='wb-fbs'&&s.source!=='ozon-fbs');
  const free={...state,items:state.items.map(i=>({...i,onHand:i.onHand-(view.finished[i.id]??0)}))};
  return new Map([...Object.entries(view.coverage),...allocateFinishedStock(free,nonFbs)]);
 }
 const fbs=fbsDrafts(state),ids=new Set(fbs.map(s=>s.id));
 return allocateFinishedStock(state,[...fbs,...shipments.filter(s=>s.status==='draft'&&!ids.has(s.id))]);
}
function componentDemand(state:AppState,shipments:Shipment[],coverage:Map<string,ShipmentLineCoverage>){
 const needed=new Map<string,number>(),missingKits:string[]=[];
 for(const shipment of shipments.filter(s=>s.status==='draft')){
  for(const line of shipment.lines){
   const item=shipmentItemOf(state,line.finishedItemId);
   if(isWarehousePart(item)&&item){needed.set(item.id,(needed.get(item.id)??0)+line.qty);continue;}
   const qty=coverage.get(shipmentLineKey(shipment.id,line.id))?.toAssemble??line.qty;
   if(qty<=0)continue;
   const kit=state.kits.find(k=>k.finishedItemId===line.finishedItemId);
   if(!kit||kit.status!=='ok'||!kit.lines.length){const sku=item?.sku??line.finishedItemId;if(!missingKits.includes(sku))missingKits.push(sku);continue;}
   for(const bom of kit.lines)needed.set(bom.componentItemId,(needed.get(bom.componentItemId)??0)+bom.qty*qty);
  }
 }
 return {needed,missingKits};
}
export function shipmentReservationView(state:AppState,visible:Shipment[]):NonNullable<AppState['shipmentReservationView']>{
 const fbs=fbsDrafts(state),allCoverage=allocateFinishedStock(state,fbs),allowed=new Set(visible.map(s=>s.id));
 const components=Object.fromEntries(componentDemand(state,fbs,allCoverage).needed),finished:Record<string,number>={},coverage:Record<string,ShipmentLineCoverage>={};
 for(const s of fbs)for(const line of s.lines){
  const key=shipmentLineKey(s.id,line.id),value=allCoverage.get(key)!;
  if(shipmentItemOf(state,line.finishedItemId)?.stockKind==='finished')finished[line.finishedItemId]=(finished[line.finishedItemId]??0)+value.fromFinishedStock;
  if(allowed.has(s.id))coverage[key]=value;
 }
 return {components,finished,coverage};
}
export function calcNeeds(state: AppState, shipments: Shipment[]): { rows: NeedRow[]; missingKits: string[]; totalBuyCost: number } {
 // onHand is physical. FBS drafts reserve virtually; posting releases reservation by removing drafts.
 // The imported reserved field is independent and unattributed; it is not assigned to these orders.
 const selected=[...new Map(shipments.filter(s=>s.status==='draft').map(s=>[s.id,s])).values()];
 const fbs=fbsDrafts(state),coverage=finishedCoverageForShipments(state,selected);
 const {needed,missingKits}=componentDemand(state,selected,coverage);
 const fbsNeeds=state.shipmentReservationView?new Map(Object.entries(state.shipmentReservationView.components)):componentDemand(state,fbs,coverage).needed;
 const selectedFbs=componentDemand(state,selected.filter(s=>s.source==='wb-fbs'||s.source==='ozon-fbs'),coverage).needed;
 const rows:NeedRow[]=[...needed].map(([id,qty])=>{
  const item=shipmentItemOf(state,id);if(!item)return null;
  const reserved=item.reserved+(fbsNeeds.get(id)??0),available=item.onHand-reserved;
  const additional=qty-(selectedFbs.get(id)??0),remaining=available-additional,toBuy=Math.max(0,-remaining);
  return {item,needed:qty,onHand:item.onHand,reserved,available,additional,remaining,toBuy,buyCost:toBuy*lastBuyPrice(item)};
 }).filter((row):row is NeedRow=>row!==null).sort((a,b)=>itemTitle(a.item).localeCompare(itemTitle(b.item),'ru'));
 return {rows,missingKits,totalBuyCost:rows.reduce((n,row)=>n+row.buyCost,0)};
}

export function toBuyMap(state: AppState, shipments: Shipment[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of calcNeeds(state, shipments).rows) {
    map.set(row.item.id, row.toBuy);
  }
  return map;
}

export function kitAverageCost(state: AppState, kit: Kit): number | null {
  if (kit.lines.length === 0) return null;
  const total = kit.lines.reduce((sum, line) => {
    const component = state.items.find((entry) => entry.id === line.componentItemId);
    return sum + line.qty * (component?.cost ?? 0);
  }, 0);
  return roundMoney(total);
}

export function kitLastBuyCost(state: AppState, kit: Kit): number {
  return kit.lines.reduce((sum, line) => {
    const component = state.items.find((entry) => entry.id === line.componentItemId);
    return sum + line.qty * (component ? lastBuyPrice(component) : 0);
  }, 0);
}

export function finishedLastBuyCost(state: AppState, finishedItemId: string): number | null {
  const item = shipmentItemOf(state, finishedItemId);
  if (isWarehousePart(item) && item) return lastBuyPrice(item);
  const kit = state.kits.find((entry) => entry.finishedItemId === finishedItemId);
  if (!kit || kit.lines.length === 0) return null;
  return kitLastBuyCost(state, kit);
}

export function isWbFbsCollecting(shipment: Shipment) {
  return (shipment.source === "wb-fbs"||shipment.source==="ozon-fbs") && shipment.wbFbsStage === "collecting";
}

export function shipmentFinishedLinesMarked(state: AppState, shipment: Shipment) {
  if (shipment.lines.length === 0) return false;
  return shipment.lines.every((line) => {
    const item = shipmentItemOf(state, line.finishedItemId);
    if (!item) return false;
    if (isWarehousePart(item)) return true;
    return line.assembled;
  });
}

export function markedAssembledQty(shipment: Shipment) {
  return shipment.lines.reduce((sum, line) => sum + (line.assembled ? line.qty : line.assembledQty??0), 0);
}

export function shipmentLastBuyCost(state: AppState, shipment: Shipment): number {
  return shipment.lines.reduce((sum, line) => {
    const unit = finishedLastBuyCost(state, line.finishedItemId);
    return sum + (unit ?? 0) * line.qty;
  }, 0);
}

export type ShipmentOverview = {
  total: number;
  posted: number;
  ready: number;
  selectedCount: number;
  selectedQty: number;
  selectedCost: number;
  selectedAssembled: number;
  selectedMarkedAssembled: number;
  selectedToAssemble: number;
};

export function calcShipmentOverview(state: AppState, visible: Shipment[], selected: Shipment[]): ShipmentOverview {
  const selectedDrafts = selected.filter((shipment) => shipment.status === "draft");
  const coverage = finishedCoverageForShipments(state, selectedDrafts);
  let selectedQty = 0;
  let selectedCost = 0;
  let selectedAssembled = 0;
  let selectedMarkedAssembled = 0;
  let selectedToAssemble = 0;
  for (const shipment of selected) {
    selectedCost += shipmentLastBuyCost(state, shipment);
    selectedMarkedAssembled += markedAssembledQty(shipment);
    for (const line of shipment.lines) {
      selectedQty += line.qty;
      if (shipment.status !== "draft") {
        selectedAssembled += line.qty;
        continue;
      }
      const lineCoverage = coverage.get(shipmentLineKey(shipment.id, line.id)) ?? {
        fromFinishedStock: 0,
        toAssemble: line.qty,
      };
      selectedAssembled += lineCoverage.fromFinishedStock;
      selectedToAssemble += lineCoverage.toAssemble;
    }
  }
  const ready = visible.filter((shipment) => {
    if (shipment.status !== "draft" || isWbFbsCollecting(shipment) || shipment.lines.length === 0) return false;
    return shipmentFinishedLinesMarked(state, shipment);
  }).length;
  return {
    total: visible.length,
    posted: visible.filter((shipment) => shipment.status === "posted").length,
    ready,
    selectedCount: selected.length,
    selectedQty,
    selectedCost,
    selectedAssembled,
    selectedMarkedAssembled,
    selectedToAssemble,
  };
}

export function unitCostOf(state: AppState, item: Item): number {
  if (item.cost != null && Number.isFinite(item.cost)) return item.cost;
  if (item.stockKind !== "finished") return 0;
  const kit = state.kits.find((entry) => entry.finishedItemId === item.id);
  if (!kit || kit.lines.length === 0) return 0;
  return kit.lines.reduce((sum, line) => {
    const component = state.items.find((entry) => entry.id === line.componentItemId);
    return sum + line.qty * (component?.cost ?? 0);
  }, 0);
}

export function stockValue(state: AppState, item: Item): number {
  return item.onHand * unitCostOf(state, item);
}
