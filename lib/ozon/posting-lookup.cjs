'use strict';
// Read-only official contract, checked 2026-10-06:
// https://docs.ozon.ru/api/seller/#operation/PostingAPI_GetFbsPostingV3
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {postings}=require('./normalize.cjs');
async function lookupPosting(read,number){
 if(typeof number!=='string'||!number||number.length>120||!/^[\w-]+$/.test(number))throw Error('POSTINGS_TRACKED_MISSING');
 const body=await read('/v3/posting/fbs/get',{posting_number:number,with:{analytics_data:false,barcodes:false,financial_data:false,legal_info:false,product_exemplars:false,related_postings:false,translit:false}});
 const result=body?.result;
 if(result?.posting_number!==number)throw Error('POSTINGS_IDENTITY_MISMATCH');
 if(!Array.isArray(result.products))throw Error('INVALID_RESPONSE');
 const products=result.products.map(p=>{
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error('INVALID_RESPONSE');
  const value=typeof p.price==='string'?p.price.match(/^(\d+)(?:\.(\d{1,4}))?$/):null;
  if(!value||p.currency_code!=='RUB'||/[1-9]/.test((value[2]??'').slice(2)))throw Error('INVALID_RESPONSE');
  return {...p,price:{currency:'RUB',amount:value[1]+'.'+(value[2]??'').padEnd(2,'0').slice(0,2)}};
 });
 // Reuse the existing posting normalizer. Contact/buyer fields are never persisted.
 return postings({postings:[{...result,products}],has_next:false,cursor:''}).rows[0];
}
module.exports={lookupPosting};
