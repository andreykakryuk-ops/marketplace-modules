import 'server-only';
import fs from 'node:fs';import path from 'node:path';
import {readOzonConnection} from './connectors';
import {readState,syncOzonSnapshot} from './store';
import {createReadClient} from './ozon/read-client.cjs';
import {recoverPostings} from './ozon/postings-recovery.cjs';
import {writeJsonFileAtomic} from './atomic-file';
import type {OzonSnapshot} from './ozon/runtime.cjs';
const root=path.join(process.cwd(),'data','ozon');
let running:Promise<void>|null=null;
function readSnapshot():OzonSnapshot|null{try{return JSON.parse(fs.readFileSync(path.join(root,'snapshot.json'),'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw e;}}
export async function syncOzonFbs(){if(running)return running;running=(async()=>{
 const c=readOzonConnection();if(!c?.verifiedAt||c.syncPaused)return;
 const old=readSnapshot();if(old&&old.clientId!==c.clientId)throw Error('SELLER_CHANGED');
 const state=readState(),tracked=state.shipments.filter(s=>s.source==='ozon-fbs'&&s.status==='draft'&&s.ozonClientId===c.clientId).flatMap(s=>s.ozonPostingIds??[]);
 const read=createReadClient(c),now=new Date().toISOString(),start=new Date(Date.now()-28*86400000).toISOString().slice(0,10);
 const recovered=await recoverPostings(read,{start,end:now.slice(0,10),previous:old?.postings??[],tracked,lastSuccess:old?.updated.postings??null});
 const snapshot:OzonSnapshot={schemaVersion:1,clientId:c.clientId,revision:(old?.revision??0)+1,postingsRevision:(old?.revision??0)+1,products:[],stocks:[],accruals:{},postings:recovered.postings,updated:{postings:now}};
 const mappingFile=path.join(process.cwd(),'data','procurement.json');let mapping:Record<string,string>={};try{mapping=JSON.parse(fs.readFileSync(mappingFile,'utf8')).mapping??{};}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 writeJsonFileAtomic(path.join(root,'snapshot.json'),snapshot,0o600);
 syncOzonSnapshot(snapshot,mapping);
 writeJsonFileAtomic(path.join(root,'sync-status.json'),{at:now,error:null},0o600);
})().catch(e=>{writeJsonFileAtomic(path.join(root,'sync-status.json'),{at:new Date().toISOString(),error:['ACCESS_DENIED','RATE_LIMIT','SELLER_CHANGED','POSTINGS_TRACKED_MISSING'].includes(e.message)?e.message:'SOURCE'},0o600);throw Error('Не удалось обновить FBS Ozon. Проверьте статус в настройках.');}).finally(()=>{running=null;});return running;}
declare global{var __warehouseOzonTimer:ReturnType<typeof setInterval>|undefined;}
export function startOzonScheduler(){if(process.env.WB_BROWSER_TEST==='1'||process.env.FBS_SYNC_ENABLED==='0'||process.env.NEXT_PHASE==='phase-production-build'||globalThis.__warehouseOzonTimer)return;void syncOzonFbs().catch(()=>{});globalThis.__warehouseOzonTimer=setInterval(()=>void syncOzonFbs().catch(()=>{}),60000);globalThis.__warehouseOzonTimer.unref();}
