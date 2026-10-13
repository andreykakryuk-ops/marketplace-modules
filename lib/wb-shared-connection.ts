import 'server-only';import {readMarketplaceSettings} from './connectors';
export function warehouseWbConnection():{token:string;paused:boolean;storeId:string}|null{const wb=readMarketplaceSettings().wb;return wb?{token:wb.token,paused:!wb.enabled,storeId:wb.storeId}:null;}
