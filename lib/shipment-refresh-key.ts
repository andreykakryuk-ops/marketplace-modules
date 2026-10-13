import {createHash} from 'node:crypto';
import type {WbFbsStatus,WbFboStatus} from './types';
export function shipmentRefreshKey(revision:string,fbs:WbFbsStatus,fbo:WbFboStatus){
 const semantic=(status:WbFbsStatus|WbFboStatus)=>Object.fromEntries(Object.entries(status).filter(([key])=>key!=='lastSyncedAt'));
 return createHash('sha256').update(JSON.stringify([revision,semantic(fbs),semantic(fbo)])).digest('hex');
}
