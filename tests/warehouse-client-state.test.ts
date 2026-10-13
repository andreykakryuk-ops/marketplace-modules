import test from "node:test";
import assert from "node:assert/strict";
import {warehouseClientState} from "../lib/warehouse-client-state";
import {DEFAULT_LAYOUT,type AppState} from "../lib/types";
test("working pages omit historical documents and synchronization ledgers without changing live state",()=>{
 const source={items:[],kits:[],layout:DEFAULT_LAYOUT,importedAt:"",sourceFile:"test",movements:Array.from({length:2000},()=>({reference:"history-only"})),shipments:[],receipts:[{id:"private-receipt"}],shipmentDocuments:[{id:"private-document"}],users:[{id:"private-user"}],wbFbs:{handledOrderIds:[123]},wbFbo:{handledSupplyIds:[456]},ozonFbs:{handled:["private-posting"]},fbsAssembly:{"private-unit":1}} as unknown as AppState;
 const before=JSON.stringify(source),view=warehouseClientState(source),wire=JSON.stringify(view);
 assert.equal(JSON.stringify(source),before);
 assert.equal(view.items,source.items);assert.equal(view.kits,source.kits);assert.equal(view.layout,source.layout);
 assert.ok(!wire.includes("private-"));assert.ok(!wire.includes("history-only"));
 assert.ok(wire.length<before.length/20);
 assert.deepEqual(view.wbFbs.handledOrderIds,[]);assert.equal(view.fbsAssembly,undefined);
});
