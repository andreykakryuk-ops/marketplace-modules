import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveShipmentSelection,selectedShipmentTokens} from '../lib/shipment-selection';
import {fulfillmentState} from './fixtures/fulfillment';
test('selected WB orders follow split, merge and renaming; another cabinet is separate',()=>{
 const a=fulfillmentState().shipments[0];Object.assign(a,{source:'wb-fbs',wbCabinetId:'cabinet-a',externalOrderIds:[1,2,3,4]});
 const tokens=selectedShipmentTokens([a],[a.id]);
 const split=[{...a,id:'new-1',externalOrderIds:[1]},{...a,id:'new-2',externalOrderIds:[2,3,4]},{...a,id:'new-3',externalOrderIds:[5]},{...a,id:'other',wbCabinetId:'cabinet-b'}];
 assert.deepEqual(resolveShipmentSelection(split,[a.id],tokens),['new-1','new-2']);
 assert.deepEqual(resolveShipmentSelection([{...a,id:'merged',externalOrderIds:[1,5]}],[],tokens),['merged']);
 assert.deepEqual(resolveShipmentSelection(split,[],[]),[]);
});
test('Ozon selection is tenant-bound and cannot collide with WB or manual cards',()=>{
 const a=fulfillmentState().shipments[0];Object.assign(a,{source:'ozon-fbs',ozonClientId:'a',ozonPostingIds:['1-2-3']});
 const tokens=selectedShipmentTokens([a],[a.id]);
 assert.deepEqual(resolveShipmentSelection([{...a,id:'new'},{...a,id:'other',ozonClientId:'b'},{...a,id:'manual',source:'manual'}],[],tokens),['new']);
});
