import test from 'node:test';
import assert from 'node:assert/strict';
import {calcNeeds,finishedCoverageForShipments,shipmentLineKey,shipmentReservationView} from '../lib/bom';
import {applyShipmentOperation} from '../lib/store';
import {fulfillmentState} from './fixtures/fulfillment';
function fixture(){
 const s=fulfillmentState(20);s.items[1].onHand=0;
 const fbs=s.shipments[0];Object.assign(fbs,{source:'wb-fbs',channel:'FBS',wbFbsStage:'assembly',externalOrderIds:[1,2,3,4]});
 fbs.lines[0].qty=4;fbs.lines[0].externalOrderIds=[1,2,3,4];
 const fbo=structuredClone(fbs);Object.assign(fbo,{id:'fbo',source:'manual',channel:'FBO',externalOrderIds:[],wbFbsStage:null});fbo.lines[0].qty=3;fbo.lines[0].externalOrderIds=[];
 s.shipments.push(fbo);return {s,fbs,fbo};
}
test('20 physical, 4 FBS reserved, selected FBS4+FBO3 leaves 13; unselecting FBS keeps its reservation',()=>{
 const {s,fbs,fbo}=fixture(),before=structuredClone(s);
 for(const selected of [[fbs,fbo],[fbo],[fbs,fbo,fbs]]){
  const row=calcNeeds(s,selected).rows[0];
  assert.equal(row.onHand,20);assert.equal(row.reserved,4);assert.equal(row.available,16);assert.equal(row.additional,3);assert.equal(row.remaining,13);assert.equal(row.toBuy,0);
 }
 assert.equal(calcNeeds(s,[fbs,fbo]).rows[0].needed,7);
 assert.deepEqual(s,before);
});
test('posting selected FBS releases virtual reservation and deducts physical once',()=>{
 const {s,fbs,fbo}=fixture();
 applyShipmentOperation(s,[fbs.id],'post','Test');
 const row=calcNeeds(s,[fbo]).rows[0];assert.equal(row.onHand,16);assert.equal(row.reserved,0);assert.equal(row.remaining,13);
 assert.throws(()=>applyShipmentOperation(s,[fbs.id],'post','Test'));
 assert.equal(s.items[0].onHand,16);
});
test('server refuses FBO stealing another open FBS reserve and reports negative projection',()=>{
 const {s,fbo}=fixture();s.items[0].onHand=6;
 const row=calcNeeds(s,[fbo]).rows[0];assert.equal(row.remaining,-1);assert.equal(row.toBuy,1);
 const before=structuredClone(s);assert.throws(()=>applyShipmentOperation(s,[fbo.id],'post','Test'),/после резервов/);assert.deepEqual(s,before);
});
test('ready units are allocated to FBS once; three two-component kits require six components',()=>{
 const {s,fbs,fbo}=fixture();s.items[1].onHand=4;s.kits[0].lines[0].qty=2;
 const row=calcNeeds(s,[fbs,fbo]).rows[0];assert.equal(row.needed,6);assert.equal(row.reserved,0);
 assert.equal(finishedCoverageForShipments(s,[fbo]).get(shipmentLineKey(fbs.id,fbs.lines[0].id))?.fromFinishedStock,4);
 applyShipmentOperation(s,[fbo.id],'post','Test');assert.equal(s.items[1].onHand,4);assert.equal(s.items[0].onHand,14);
});
test('unattributed imported reservation is not automatically credited to selected FBS',()=>{
 const {s,fbs}=fixture();s.items[0].reserved=2;
 const row=calcNeeds(s,[fbs]).rows[0];assert.equal(row.reserved,6);assert.equal(row.additional,0);assert.equal(row.available,14);
});

test('permission-filtered client computes same reserve and shortage without hidden order identities',()=>{
 const {s,fbs,fbo}=fixture();s.items[1].onHand=2;
 const expected=calcNeeds(s,[fbo]),view=shipmentReservationView(s,[fbo]);
 const filtered={...s,shipments:[fbo],shipmentReservationView:view};
 assert.deepEqual(calcNeeds(filtered,[fbo]),expected);
 assert.deepEqual(Object.keys(view.coverage),[]);
 assert.ok(!JSON.stringify(view).includes(fbs.id));
});
