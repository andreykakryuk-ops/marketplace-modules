import "server-only";
import fs from "node:fs";
import path from "node:path";
let saved:string|undefined;
export function deploymentVersion():string {
 if(saved)return saved;
 try {return saved=fs.readFileSync(path.join(process.cwd(),".next","BUILD_ID"),"utf8").trim();}
 catch {return "development";}
}
