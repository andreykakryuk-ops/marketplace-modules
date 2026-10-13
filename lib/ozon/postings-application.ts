import type {AppState} from '../types';
import type {OzonSnapshot} from './runtime.cjs';
import {applyOzonPostings} from './fbs-sync';

export function applyOzonSnapshot(state:AppState,snapshot:OzonSnapshot,mapping:Record<string,string>={},at=new Date().toISOString()){
 const sourceUpdatedAt=snapshot.updated.postings;
 const previous=state.ozonFbs?.applied?.[snapshot.clientId];
 // An old snapshot has only a global revision: a stock refresh must not reapply the same postings.
 const revision=snapshot.postingsRevision??(previous?.sourceUpdatedAt===sourceUpdatedAt?previous.postingsRevision:snapshot.revision);
 if(!sourceUpdatedAt||!Number.isFinite(Date.parse(sourceUpdatedAt))||!Number.isFinite(Date.parse(at))||!Number.isSafeInteger(revision)||revision<1)throw Error('INVALID_POSTINGS_SNAPSHOT');
 if(previous&&(previous.postingsRevision>revision||Date.parse(previous.sourceUpdatedAt)>Date.parse(sourceUpdatedAt)))return {changed:false,applied:false};
 if(previous?.postingsRevision===revision&&previous.sourceUpdatedAt===sourceUpdatedAt)return {changed:false,applied:true};
 const known=new Set(snapshot.postings.map(p=>p.number));
 const tracked=state.shipments.filter(s=>s.source==='ozon-fbs'&&s.status==='draft'&&s.ozonClientId===snapshot.clientId).flatMap(s=>s.ozonPostingIds??[]);
 if(tracked.some(number=>!known.has(number)))throw Error('POSTINGS_TRACKED_MISSING');
 const result=applyOzonPostings(state,snapshot.clientId,snapshot.postings,mapping);
 state.ozonFbs??={handled:[]};
 state.ozonFbs.applied??={};
 state.ozonFbs.reconciliation??={};
 state.ozonFbs.reconciliation[snapshot.clientId]={sourceUpdatedAt,postings:result.unaccountedShipping};
 state.ozonFbs.applied[snapshot.clientId]={snapshotRevision:snapshot.revision,postingsRevision:revision,sourceUpdatedAt,appliedAt:at,postingsCount:snapshot.postings.length,reconciliationRequired:result.unaccountedShipping.length};
 return {changed:true,applied:true};
}
