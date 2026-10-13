import 'server-only';import path from 'node:path';import {createWarehousePreferences} from './warehouse-preferences.cjs';
export const warehousePreferences=createWarehousePreferences({directory:path.join(process.cwd(),'data','warehouse-preferences')});
