import "server-only";
import {shipmentRefreshKey} from "./shipment-refresh-key";

import { readStateRevision } from "@/lib/store";
import { readWbFbsStatus } from "@/lib/wb-fbs";
import { readWbFboStatus } from "@/lib/wb-fbo";

export function readShipmentStatus() {
  const wbFbsStatus = readWbFbsStatus();
  const wbFboStatus = readWbFboStatus();
  return {
    wbFbsStatus,
    wbFboStatus,
    refreshKey: shipmentRefreshKey(readStateRevision(),wbFbsStatus,wbFboStatus),
  };
}
