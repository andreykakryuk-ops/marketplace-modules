import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    readState();
    return Response.json(
      { ok: true },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return Response.json(
      { ok: false },
      {
        status: 503,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
