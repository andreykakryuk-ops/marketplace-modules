import Link from "next/link";
import { notFound } from "next/navigation";
import { KitEditor } from "@/components/KitEditor";
import { PageHint } from "@/components/PageHint";
import { getSessionUser } from "@/lib/session";
import { readState } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function KitEditPage({ params }: { params: Promise<{ sku: string }> }) {
  await getSessionUser({permission:'kits'});
  const { sku } = await params;
  const decoded = decodeURIComponent(sku);
  const state = readState();
  const kit = state.kits.find((entry) => entry.sku === decoded);
  if (!kit) notFound();

  return (
    <div className="page-flow" style={{ padding: 12, maxWidth: 920 }}>
      <PageHint>
        <p className="hint">
          {kit.sku} — состав комплекта. Количество целыми числами. Себес. закупки — последняя цена оприходования, по ней
          считается сводка поставок.
        </p>
      </PageHint>
      <p>
        <Link href="/kits" style={{ color: "#1a73e8" }}>
          ← К комплектам
        </Link>
        {" · "}
        <Link href="/" style={{ color: "#1a73e8" }}>
          К складу
        </Link>
      </p>
      <h1 style={{ fontSize: 18, margin: "8px 0 12px" }}>{kit.sku}</h1>
      <KitEditor kit={kit} components={state.items} />
    </div>
  );
}
