import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyOzonPostings} from '../lib/ozon/fbs-sync';
import type {AppState} from '../lib/types';
import type {OzonPosting} from '../lib/ozon/runtime.cjs';
const posting=(status='awaiting_packaging'):OzonPosting=>({number:'123-1-1',orderId:'123',status,substatus:'',createdAt:'2026-09-29T10:00:00Z',shipmentDate:'2026-09-30T10:00:00Z',warehouseId:'5',warehouseName:'Test',products:[{sku:'42',offerId:'KIT',name:'Synthetic',quantity:2,price:10000}]});
test('Ozon FBS transitions, cancellation and repeated snapshots never change physical quantities',()=>{
 const state={items:[{id:'kit',sku:'KIT',stockKind:'finished',onHand:8}],shipments:[]} as unknown as AppState;
 assert.equal(applyOzonPostings(state,'99',[posting()]).changed,true);assert.equal(state.shipments[0].wbFbsStage,'collecting');
 assert.equal(applyOzonPostings(state,'99',[posting()]).changed,false);
 applyOzonPostings(state,'99',[posting('awaiting_deliver')]);const ready=state.shipments.find(s=>s.wbFbsStage==='assembly')!;assert.equal(ready.lines[0].qty,2);
 ready.status='posted';applyOzonPostings(state,'99',[posting('awaiting_deliver')]);assert.equal(state.shipments.filter(s=>s.wbFbsStage==='assembly').length,1);
 assert.equal(state.items[0].onHand,8);
 const fresh={...state,shipments:[],ozonFbs:{handled:['99:123-1-1']}};applyOzonPostings(fresh,'99',[posting()]);assert.equal(fresh.shipments.length,0);
});
test('Ozon historical delivered orders are not imported as new active shipments',()=>{const state={items:[],shipments:[]} as unknown as AppState;applyOzonPostings(state,'99',[posting('delivered')]);assert.equal(state.shipments.length,0);});

test('Ozon partial cancellation preserves remaining assembly and unknown SKUs block posting',()=>{
 const state={items:[{id:'kit',sku:'KIT',stockKind:'finished',onHand:8}],shipments:[]} as unknown as AppState;
 const a=posting('awaiting_deliver'),b={...posting('awaiting_deliver'),number:'123-2-1'};
 applyOzonPostings(state,'99',[a,b]);const s=state.shipments[0];assert.equal(s.lines[0].qty,4);s.lines[0].assembled=true;
 applyOzonPostings(state,'99',[a,{...b,status:'cancelled'}]);assert.equal(s.lines[0].qty,2);assert.equal(s.lines[0].assembled,true);
 applyOzonPostings(state,'99',[{...a,products:[...a.products,{sku:'999',offerId:'UNKNOWN',name:'Unknown',quantity:1,price:100}]}]);assert.deepEqual(s.ozonUnknown,['UNKNOWN']);
 assert.equal(state.items[0].onHand,8);
});

import {fulfillmentState} from './fixtures/fulfillment';
import {applyShipmentOperation,normalizeState} from '../lib/store';
test('posting Ozon supply persists handled IDs and document identity before the next sync',()=>{
 const state=fulfillmentState(),p=posting('awaiting_deliver');p.products[0].offerId='SKU-A';
 applyOzonPostings(state,'99',[p]);const s=state.shipments.find(s=>s.source==='ozon-fbs')!;s.lines[0].assembled=true;
 const before=state.items.find(i=>i.id==='fin:SKU-A')!.onHand;
 applyShipmentOperation(state,[s.id],'post','Synthetic');
 assert.equal(state.items.find(i=>i.id==='fin:SKU-A')!.onHand,before-2);
 const restored=normalizeState(JSON.parse(JSON.stringify(state)));assert.ok(restored.ozonFbs!.handled.includes('99:'+p.number));
 assert.equal(restored.shipmentDocuments[0].ozonClientId,'99');assert.deepEqual(restored.shipmentDocuments[0].ozonPostingIds,[p.number]);
 assert.equal(applyOzonPostings(restored,'99',[p]).changed,false);
 assert.ok(!restored.shipments.some(s=>s.source==='ozon-fbs'));assert.equal(restored.items.find(i=>i.id==='fin:SKU-A')!.onHand,before-2);
});

test('Ozon assembly survives collecting transition, split, reorder and restart; new units remain unmarked',()=>{
 const state={items:[{id:'kit',sku:'KIT',stockKind:'finished',onHand:8}],shipments:[]} as unknown as AppState;
 const a=posting(),b={...posting(),number:'123-2-1'};
 applyOzonPostings(state,'99',[a,b]);const line=state.shipments[0].lines[0];line.assembled=true;
 applyOzonPostings(state,'99',[{...b,status:'awaiting_deliver',warehouseId:'6'},{...a,status:'awaiting_deliver'}]);
 const ready=state.shipments.filter(s=>s.wbFbsStage==='assembly');assert.equal(ready.length,2);assert.ok(ready.every(s=>s.lines[0].assembled&&s.lines[0].assembledQty===2));
 const restored=normalizeState(JSON.parse(JSON.stringify(state)));
 const grown={...a,status:'awaiting_deliver',products:[{...a.products[0],quantity:3}]};
 applyOzonPostings(restored,'99',[grown,{...b,status:'awaiting_deliver',warehouseId:'6'}]);
 const changed=restored.shipments.find(s=>s.ozonPostingIds?.includes(a.number))!.lines[0];
 assert.equal(changed.qty,3);assert.equal(changed.assembledQty,2);assert.equal(changed.assembled,false);
 assert.equal(restored.items[0].onHand,8);
 assert.equal(applyOzonPostings(restored,'99',[{...b,status:'awaiting_deliver',warehouseId:'6'},grown]).changed,false);
});
import {applyOzonSnapshot} from '../lib/ozon/postings-application';
import type {OzonSnapshot} from '../lib/ozon/runtime.cjs';
test('Ozon apply marker commits with warehouse result, rejects stale and incomplete snapshots',()=>{
 const state={items:[{id:'kit',sku:'KIT',stockKind:'finished',onHand:8}],shipments:[]} as unknown as AppState;
 const snap={schemaVersion:1,clientId:'99',revision:10,postingsRevision:10,products:[],stocks:[],accruals:{},postings:[posting()],updated:{postings:'2026-10-06T10:00:00Z'}} as OzonSnapshot;
 applyOzonSnapshot(state,snap,{},'2026-10-06T10:01:00Z');
 const saved=JSON.stringify(state);
 assert.equal(applyOzonSnapshot(state,snap).changed,false);assert.equal(JSON.stringify(state),saved);
 assert.equal(applyOzonSnapshot(state,{...snap,revision:9,postingsRevision:9}).applied,false);assert.equal(JSON.stringify(state),saved);
 assert.throws(()=>applyOzonSnapshot(state,{...snap,revision:11,postingsRevision:11,updated:{postings:'2026-10-06T10:02:00Z'},postings:[]}),/POSTINGS_TRACKED_MISSING/);
 assert.equal(JSON.stringify(state),saved);
 assert.equal(state.ozonFbs!.applied!['99'].appliedAt,'2026-10-06T10:01:00Z');assert.equal(state.items[0].onHand,8);
});

test('legacy global stock revision cannot advance postings application; invalid source/apply times leave state intact',()=>{
 const state={items:[{id:'kit',sku:'KIT',stockKind:'finished',onHand:8}],shipments:[]} as unknown as AppState;
 const legacy={schemaVersion:1,clientId:'99',revision:10,products:[],stocks:[],accruals:{},postings:[posting()],updated:{postings:'2026-10-06T10:00:00Z'}} as OzonSnapshot;
 applyOzonSnapshot(state,legacy,{},'2026-10-06T10:01:00Z');
 const saved=JSON.stringify(state);
 assert.equal(applyOzonSnapshot(state,{...legacy,revision:11,updated:{...legacy.updated,stocks:'2026-10-06T10:02:00Z'}},{},'2026-10-06T10:02:00Z').changed,false);
 assert.equal(JSON.stringify(state),saved);assert.equal(state.ozonFbs!.applied!['99'].appliedAt,'2026-10-06T10:01:00Z');
 assert.throws(()=>applyOzonSnapshot(state,{...legacy,revision:12,updated:{postings:'invalid-date'}}),/INVALID_POSTINGS_SNAPSHOT/);
 assert.throws(()=>applyOzonSnapshot(state,legacy,{},'invalid-date'),/INVALID_POSTINGS_SNAPSHOT/);
 assert.equal(JSON.stringify(state),saved);
});

test('first seen delivering posting is explicitly pending physical-history reconciliation without a virtual reserve',()=>{
 const state={items:[{id:'kit',sku:'KIT',stockKind:'finished',onHand:8}],shipments:[]} as unknown as AppState;
 const snap={schemaVersion:1,clientId:'99',revision:10,postingsRevision:10,products:[],stocks:[],accruals:{},postings:[posting('delivering')],updated:{postings:'2026-10-06T10:00:00Z'}} as OzonSnapshot;
 applyOzonSnapshot(state,snap,{},'2026-10-06T10:01:00Z');
 assert.equal(state.shipments.length,0);assert.equal(state.items[0].onHand,8);
 assert.equal(state.ozonFbs?.applied?.['99'].reconciliationRequired,1);
 assert.deepEqual(state.ozonFbs?.reconciliation?.['99'].postings,[{number:'123-1-1',status:'delivering',createdAt:'2026-09-29T10:00:00Z'}]);
 const saved=JSON.stringify(state);assert.equal(applyOzonSnapshot(state,snap).changed,false);assert.equal(JSON.stringify(state),saved);
});
