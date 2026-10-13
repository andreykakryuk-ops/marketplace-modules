import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import {writeJsonFileAtomic} from './atomic-file';
export type MarketplaceSettings={wb?:{token:string;storeId:string;enabled:boolean;fboEnabled:boolean;checkedAt:string};wbArticles?:Record<string,string>};
const file=path.join(process.cwd(),'data','marketplace-settings.json');
export function readMarketplaceSettings():MarketplaceSettings{try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('CONFIG_STORAGE');return JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {};throw Error('CONFIG_STORAGE');}}
export function saveWbSettings(value:NonNullable<MarketplaceSettings['wb']>){writeJsonFileAtomic(file,{...readMarketplaceSettings(),wb:value},0o600);}
export function saveWbArticle(article:string,finishedItemId:string){const s=readMarketplaceSettings();writeJsonFileAtomic(file,{...s,wbArticles:{...s.wbArticles,[article]:finishedItemId}},0o600);}
export function readOzonConnection():{clientId:string;apiKey:string;revision:number;verifiedAt:string;syncPaused?:boolean}|null{const p=path.join(process.cwd(),'data','ozon','connection.json');try{const stat=fs.lstatSync(p);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>32768)throw Error('CONFIG_STORAGE');return JSON.parse(fs.readFileSync(p,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return null;throw Error('CONFIG_STORAGE');}}
export function saveOzonConnection(value:NonNullable<ReturnType<typeof readOzonConnection>>){writeJsonFileAtomic(path.join(process.cwd(),'data','ozon','connection.json'),value,0o600);}
