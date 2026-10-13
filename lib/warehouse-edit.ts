import type {AppUser} from './types';

// The grant is supplied only by the authenticated Server Action after reading
// the current access file. It permits exactly one field, never an admin patch.
export function requireWarehouseEdit(user:AppUser,patch:Record<string,unknown>,expectedOnHand:number|undefined,canAdjustStock=false){
 if(user.role==='admin')return;
 if(!canAdjustStock||Object.keys(patch).length!==1||!Object.hasOwn(patch,'onHand'))throw Error('Нет допуска к ручному изменению остатков');
 if(!Number.isSafeInteger(patch.onHand)||Number(patch.onHand)<0)throw Error('Остаток должен быть целым числом 0 или больше');
 if(!Number.isSafeInteger(expectedOnHand)||Number(expectedOnHand)<0)throw Error('Обновите страницу перед изменением остатка');
}
