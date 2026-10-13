import test from 'node:test';
import assert from 'node:assert/strict';
import {requireWarehouseEdit} from '../lib/warehouse-edit';
import type {AppUser} from '../lib/types';
const employee:AppUser={id:'worker',name:'Test worker',role:'employee'};
test('manual quantity edit is denied by default and after revoked grant',()=>{
 for(const grant of [undefined,false])assert.throws(()=>requireWarehouseEdit(employee,{onHand:7},5,grant),/Нет допуска/);
 assert.doesNotThrow(()=>requireWarehouseEdit(employee,{onHand:0},5,true));
});
test('quantity grant cannot change price, identity, visibility or mixed fields',()=>{
 for(const patch of [{cost:1},{name:'Changed'},{hidden:true},{strapSize:44},{onHand:7,cost:1},{}])assert.throws(()=>requireWarehouseEdit(employee,patch,5,true),/Нет допуска/);
});
test('employee quantity adjustment requires exact integer and previous value',()=>{
 for(const value of [-1,1.5,NaN,Infinity,'5',Number.MAX_SAFE_INTEGER+1])assert.throws(()=>requireWarehouseEdit(employee,{onHand:value},5,true),/целым/);
 for(const previous of [undefined,-1,NaN,1.5])assert.throws(()=>requireWarehouseEdit(employee,{onHand:7},previous,true),/Обновите/);
});
test('administrator retains existing edit capability',()=>assert.doesNotThrow(()=>requireWarehouseEdit({...employee,role:'admin'},{cost:10,name:'Name'},undefined)));
