'use strict';
// Official contract: https://docs.ozon.ru/api/seller/#operation/AccessAPI_RolesByToken
const ALLOWED=new Set(['/v1/roles','/v4/posting/fbs/list','/v3/posting/fbs/get']);
function createReadClient({clientId,apiKey,request=fetch}){
 if(!/^[1-9]\d{0,15}$/.test(clientId)||typeof apiKey!=='string'||!apiKey||apiKey.length>1024||/[\s\u0000-\u001f]/.test(apiKey))throw Error('INVALID_CREDENTIALS');
 return async function read(endpoint,body={}){
  if(!ALLOWED.has(endpoint))throw Error('METHOD_NOT_ALLOWED');
  let response;try{response=await request('https://api-seller.ozon.ru'+endpoint,{method:'POST',headers:{'Client-Id':clientId,'Api-Key':apiKey,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(15000),cache:'no-store'});}catch{throw Error('CONNECTION');}
  if(response.status!==200){await response.body?.cancel();throw Error(response.status===401||response.status===403?'ACCESS_DENIED':response.status===429?'RATE_LIMIT':'SOURCE');}
  if(!response.body)throw Error('SOURCE');
  const reader=response.body.getReader(),decoder=new TextDecoder();let text='',size=0;
  try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16*1024*1024)throw Error('RESPONSE_LIMIT');text+=decoder.decode(part.value,{stream:true});}
   try{return JSON.parse(text+decoder.decode());}catch{throw Error('INVALID_RESPONSE');}
  }catch(e){throw Error(['RESPONSE_LIMIT','INVALID_RESPONSE'].includes(e.message)?e.message:'CONNECTION');}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 };
}
function accessSummary(data,now=Date.now()){
 if(!data||!Array.isArray(data.roles)||data.roles.some(r=>!r||typeof r.name!=='string'||!Array.isArray(r.methods)||r.methods.some(m=>typeof m!=='string'||!m.startsWith('/'))))throw Error('INVALID_RESPONSE');
 const expiry=data.expires_at??null;
 if(expiry!==null&&(typeof expiry!=='string'||!Number.isFinite(Date.parse(expiry))))throw Error('INVALID_RESPONSE');
 if(expiry&&Date.parse(expiry)<=now)throw Error('KEY_EXPIRED');
 const methods=new Set(data.roles.flatMap(r=>r.methods));
 return {expiresAt:expiry,capabilities:{fbs:methods.has('/v4/posting/fbs/list'),stocks:methods.has('/v1/analytics/stocks'),finance:methods.has('/v1/finance/accrual/by-day')&&methods.has('/v1/finance/accrual/types')}};
}
module.exports={createReadClient,accessSummary};
