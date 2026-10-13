import {getLoginAccount} from "@/lib/auth";
import {hasAccess} from "@/lib/access";
import {readSessionUser} from "@/lib/session";
import {procurementReport} from "@/lib/procurement-service";
export const dynamic="force-dynamic";
export async function GET(){
 const user=await readSessionUser();
 if(!user||getLoginAccount(user.id)?.mustChangePassword)return Response.json({error:"Требуется вход"},{status:401});
 if(!await hasAccess(user,"warehouse"))return Response.json({error:"Нет доступа"},{status:403});
 return Response.json(await procurementReport(),{headers:{"Cache-Control":"no-store"}});
}
