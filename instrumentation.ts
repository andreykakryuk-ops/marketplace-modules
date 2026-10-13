export async function register(){if(process.env.NEXT_RUNTIME!=='nodejs'||process.env.NEXT_PHASE==='phase-production-build'||process.env.FBS_SYNC_ENABLED==='0'||process.env.WB_BROWSER_TEST==='1')return;
const {readUndoMeta}=await import('./lib/store');readUndoMeta();
const {startWbFbsScheduler}=await import('./lib/wb-fbs');const {startWbFboScheduler}=await import('./lib/wb-fbo');const {startOzonScheduler}=await import('./lib/ozon');
startWbFbsScheduler();startWbFboScheduler();startOzonScheduler();}
