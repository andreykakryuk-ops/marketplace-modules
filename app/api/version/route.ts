import {deploymentVersion} from "@/lib/deployment-version";
export const dynamic="force-dynamic";
export function GET(){return Response.json({version:deploymentVersion()},{headers:{"Cache-Control":"no-store"}});}
