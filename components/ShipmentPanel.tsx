"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useOptimistic, useRef, useState, useTransition, type ReactNode } from "react";
import {
  addShipmentAction,
  addShipmentLineAction,
  configureWbFboAction,
  configureWbFbsAction,
  deleteShipmentAction,
  deleteShipmentLineAction,
  disconnectWbFboAction,
  disconnectWbFbsAction,
  packToAssembledAction,
  postShipmentsAction,
  syncWbFboAction,
  syncWbFbsAction,
  updateShipmentLineAction,
} from "@/app/actions";
import { KitCompositionPreview } from "@/components/KitCompositionPreview";
import { SkuPicker } from "@/components/SkuPicker";
import {
  finishedCoverageForShipments,
  calcNeeds,
  finishedLastBuyCost,
  isWbFbsCollecting,
  shipmentFinishedLinesMarked,
  shipmentLastBuyCost,
  shipmentLineKey,
  type ShipmentLineCoverage,
} from "@/lib/bom";
import { formatCost, formatQty, itemTitle } from "@/lib/format";
import type { AppState, Shipment, ShipmentLine, WbFboStatus, WbFbsStatus } from "@/lib/types";
import { keepExistingIds, useSessionDraft } from "@/lib/ui-session";
import { resolveShipmentSelection, selectedShipmentTokens } from "@/lib/shipment-selection";
import { shipmentDeletionSnapshot } from "@/lib/shipment-deletion";

type ShipUi = { selected: string[]; selectedOrders?:string[]; collapsed: string[] | null };
const EMPTY_SHIP: ShipUi = { selected: [], collapsed: null };

type CreateDraft = { name: string; channel: "FBW" | "FBO" };
const EMPTY_CREATE: CreateDraft = { name: "", channel: "FBW" };

type AddLineDraft = { itemId: string; qty: string };
const EMPTY_ADD_LINE: AddLineDraft = { itemId: "", qty: "" };

async function run(action: (data: FormData) => Promise<{ ok: true } | { ok: false; error: string }>, data: FormData) {
  const result = await action(data);
  if (!result.ok) window.alert(result.error);
}

function byFulfillmentPriority(shipments: Shipment[]) {
  return [...shipments].sort((a, b) => {
    const aCollecting = (a.source === "wb-fbs"||a.source==="ozon-fbs") && a.wbFbsStage === "collecting" ? 1 : 0;
    const bCollecting = (b.source === "wb-fbs"||b.source==="ozon-fbs") && b.wbFbsStage === "collecting" ? 1 : 0;
    return aCollecting - bCollecting;
  });
}

type HoveredShipmentLine = {
  shipmentId: string;
  lineId: string;
  finishedItemId: string;
};

export type ShipmentTab = "fbs" | "fbo" | "stock";

function isFboChannel(channel: Shipment["channel"]) {
  return channel === "FBO" || channel === "FBW";
}

function shipmentsForTab(shipments: Shipment[], tab: ShipmentTab) {
  return shipments.filter((shipment) => (tab === "stock" ? shipment.channel === "STOCK" : tab === "fbs" ? shipment.channel === "FBS" : isFboChannel(shipment.channel)));
}

export function ShipmentPanel({
  state,
  admin,
  tab,
  refreshKey,
  canManageWb=true,
}: {
  state: AppState;
  admin: boolean;
  tab: ShipmentTab;
  refreshKey: string;
  canManageWb?: boolean;
}) {
  return (
    <ShipmentTabPanel
      key={tab}
      state={state}
      admin={admin}
      tab={tab}
      canManageWb={canManageWb}
      refreshKey={refreshKey}
    />
  );
}

function ShipmentTabPanel({
  state: serverState,
  admin,
  tab,
  refreshKey,
  canManageWb=true,
}: {
  state: AppState;
  admin: boolean;
  tab: ShipmentTab;
  refreshKey: string;
  canManageWb?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const markInFlight = useRef(false);
  const [state, markOptimistic] = useOptimistic(
    serverState,
    (current, update: { shipmentId: string; lineId: string; assembled: boolean }) => ({
      ...current,
      shipments: current.shipments.map((shipment) => shipment.id !== update.shipmentId ? shipment : ({
        ...shipment,
        lines: shipment.lines.map((line) => line.id !== update.lineId ? line : { ...line, assembled: update.assembled, assembledQty:update.assembled?line.qty:0 }),
      })),
    }),
  );
  const [ui, setUi] = useSessionDraft<ShipUi>(`shipments.${tab}`, EMPTY_SHIP);
  const [create, setCreate] = useSessionDraft<CreateDraft>(`shipments.${tab}.create`, EMPTY_CREATE);
  const [hoveredLine, setHoveredLine] = useState<HoveredShipmentLine | null>(null);
  const [query, setQuery] = useSessionDraft(`shipments.${tab}.search`, "");
  const {
    visible, drafts, visibleIds, selected, forCalc, finishedCoverage, needs, catalog,
    canPost, canPack, collectingSelected, unmarkedSelected, allDraftSelected,
  } = useMemo(() => {
    const visible = shipmentsForTab(state.shipments, tab);
    const drafts = visible.filter((shipment) => shipment.status === "draft");
    const visibleIds = visible.map((shipment) => shipment.id);
    const selected = resolveShipmentSelection(visible, Array.isArray(ui.selected) ? ui.selected : [], Array.isArray(ui.selectedOrders)?ui.selectedOrders:[]);
    const selectedShipments = visible.filter((shipment) => selected.includes(shipment.id));
    const forCalc = byFulfillmentPriority(selectedShipments.filter((shipment) => shipment.status === "draft"));
    const prioritized = [...forCalc, ...byFulfillmentPriority(drafts.filter((shipment) => !selected.includes(shipment.id)))];
    const needs = calcNeeds(state, forCalc);
    const collectingSelected = forCalc.some(isWbFbsCollecting);
    const unmarkedSelected = forCalc.some((shipment) => !shipmentFinishedLinesMarked(state, shipment));
    const ready = forCalc.length > 0 && !collectingSelected && !unmarkedSelected &&
      forCalc.every((shipment) => shipment.canceledExternalOrderIds.length === 0) &&
      needs.missingKits.length === 0 && needs.rows.every((row) => row.toBuy === 0);
    return {
      visible, drafts, visibleIds, selected, forCalc, needs, collectingSelected, unmarkedSelected,
      finishedCoverage: finishedCoverageForShipments(state, prioritized),
      catalog: state.items.filter((item) => !item.hidden && (tab !== "stock" || item.stockKind === "finished")),
      canPost: ready && tab !== "stock",
      canPack: ready && tab === "stock" && forCalc.every((shipment) => shipment.lines.every((line) => state.items.find((item) => item.id === line.finishedItemId)?.stockKind === "finished")),
      allDraftSelected: drafts.length > 0 && drafts.every((shipment) => selected.includes(shipment.id)),
    };
  }, [state, tab, ui.selected, ui.selectedOrders]);
  useEffect(()=>{
    if(ui.selectedOrders===undefined&&ui.selected.length){
      setUi(current=>({...current,selectedOrders:selectedShipmentTokens(visible,current.selected)}));
    }
  },[ui.selectedOrders,ui.selected,visible,setUi]);
  const defaultCollapsed = visible.filter((shipment) => shipment.status !== "draft").map((shipment) => shipment.id);
  const collapsed = keepExistingIds(Array.isArray(ui.collapsed) ? ui.collapsed : defaultCollapsed, visibleIds);
  const hoverIds = useMemo(() => {
    if (!hoveredLine) return [];
    const kit = state.kits.find((entry) => entry.finishedItemId === hoveredLine.finishedItemId);
    return kit?.lines.map((line) => line.componentItemId) ?? [];
  }, [hoveredLine, state.kits]);
  const allCollapsed = visible.length > 0 && visible.every((shipment) => collapsed.includes(shipment.id));
  const shown = visible.filter((shipment) => !query.trim() ||
    [shipment.name, ...shipment.lines.map((line) => {
      const item = state.items.find((entry) => entry.id === line.finishedItemId);
      return item ? `${itemTitle(item)} ${item.sku}` : "";
    })].join(" ").toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru")));

  function markLine(shipment: Shipment, line: ShipmentLine) {
    if (pending || markInFlight.current) return;
    markInFlight.current = true;
    setMessage("");
    startTransition(async () => {
      markOptimistic({ shipmentId: shipment.id, lineId: line.id, assembled: !line.assembled });
      const data = new FormData();
      data.set("shipmentId", shipment.id);
      data.set("lineId", line.id);
      data.set("qty", String(line.qty));
      data.set("assembled", line.assembled ? "0" : "1");
      data.set("expectedAssembled", line.assembled ? "1" : "0");
      try {
        const result = await updateShipmentLineAction(data);
        setMessage(result.ok ? "Отметка сохранена." : result.error);
      } catch {
        window.dispatchEvent(new Event("warehouse-save-error"));
        setMessage("Не удалось подтвердить отметку. Обновите страницу и проверьте её перед повтором.");
      } finally {
        markInFlight.current = false;
      }
    });
  }

  function removeFbsShipment(shipment: Shipment) {
    if (!admin || pending || markInFlight.current) return;
    const details = shipment.source === "wb-fbs"
      ? "\nЗаказы этой поставки будут исключены из повторного импорта. Новые заказы продолжат поступать в новую поставку."
      : "";
    if (!window.confirm(`Удалить FBS-поставку «${shipment.name}» из склада?\nОстатки и заказы в кабинете WB не изменятся.${details}`)) return;
    markInFlight.current = true;
    setMessage("Удаляю поставку…");
    const data = new FormData();
    data.set("id", shipment.id);
    data.set("expectedSnapshot", shipmentDeletionSnapshot(shipment));
    startTransition(async () => {
      try {
        const result = await deleteShipmentAction(data);
        if (result.ok) {
          setSelected((current) => current.filter((id) => id !== shipment.id));
          setHoveredLine(null);
        }
        setMessage(result.ok ? "Поставка удалена из склада. Остатки не изменены." : result.error);
      } catch {
        setMessage("Не удалось подтвердить удаление. Обновите страницу и проверьте список поставок.");
      } finally {
        markInFlight.current = false;
      }
    });
  }

  function setSelected(next: string[] | ((current: string[]) => string[])) {
    setUi((current) => {
      const resolved=resolveShipmentSelection(visible,Array.isArray(current.selected)?current.selected:[],current.selectedOrders??[]);
      const chosen=typeof next==="function"?next(resolved):next;
      return {...current,selected:chosen,selectedOrders:selectedShipmentTokens(visible,chosen)};
    });
  }

  function setCollapsed(next: string[] | ((current: string[]) => string[])) {
    setUi((current) => {
      const base = Array.isArray(current.collapsed) ? current.collapsed : defaultCollapsed;
      return { ...current, collapsed: typeof next === "function" ? next(base) : next };
    });
  }

  function toggle(id: string) {
    setSelected((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));
  }

  function hoverShipmentLine(shipmentId: string, line: ShipmentLine | null) {
    setHoveredLine(
      line
        ? {
            shipmentId,
            lineId: line.id,
            finishedItemId: line.finishedItemId,
          }
        : null,
    );
  }

  return (
    <div className="block shipment-block">
      <ShipmentPageRefresh refreshKey={refreshKey} paused={pending} />
      <nav className="shipment-subtabs">
        <Link href="/shipments" className={`shipment-subtab${tab === "fbs" ? " active" : ""}`}>
          FBS
        </Link>
        {canManageWb?<><Link href="/shipments?tab=fbo" className={`shipment-subtab${tab === "fbo" ? " active" : ""}`}>
          FBW / FBO
        </Link>
        <Link href="/shipments?tab=stock" className={`shipment-subtab${tab === "stock" ? " active" : ""}`}>
          Склад
        </Link></>:null}
      </nav>
      <p className="shipment-save-status" role="status" aria-live="polite">
        {pending ? "Сохраняю изменения…" : message}
      </p>
      <div className="ship-list-head">
        {canManageWb&&tab !== "fbs" ? <form
          className="add-row"
          action={async (data) => {
            const result = await addShipmentAction(data);
            if (!result.ok) {
              window.alert(result.error);
              return;
            }
            setCreate((current) => ({ ...current, name: "" }));
          }}
        >
          <input
            name="name"
            placeholder={tab === "stock" ? "Название партии для склада" : "Название поставки"}
            value={create.name}
            onChange={(event) => setCreate((current) => ({ ...current, name: event.target.value }))}
          />
          {tab === "stock" ? (
            <input type="hidden" name="channel" value="STOCK" />
          ) : (
            <select
              name="channel"
              value={create.channel}
              onChange={(event) =>
                setCreate((current) => ({ ...current, channel: event.target.value === "FBO" ? "FBO" : "FBW" }))
              }
            >
              <option value="FBW">FBW</option>
              <option value="FBO">FBO</option>
            </select>
          )}
          <PendingButton>Создать поставку</PendingButton>
        </form> : null}
        {visible.length > 0 ? (
          <button
            type="button"
            onClick={() => setCollapsed(allCollapsed ? [] : visible.map((shipment) => shipment.id))}
          >
            {allCollapsed ? "Показать поставки" : "Скрыть поставки"}
          </button>
        ) : null}
      </div>

      {visible.length > 0 ? (
        <div className="shipment-tools">
          <input aria-label="Поиск поставки или артикула" placeholder="Найти поставку или артикул" value={query} onChange={(event) => setQuery(event.target.value)} />
          <span>Выбрано: {selected.length}</span>
          {selected.length > 0 ? <button type="button" onClick={() => setSelected([])}>Снять выбор</button> : null}
          {query && selected.some((id) => !shown.some((shipment) => shipment.id === id)) ? <span className="warn-text">Часть выбранных поставок скрыта поиском</span> : null}
        </div>
      ) : null}
      {shown.length === 0 && visible.length > 0 ? <p className="hint">По этому запросу поставок нет.</p> : null}
      {visible.length === 0 ? (
        <p className="hint">
          {tab === "stock"
            ? "Пока нет партий для склада. Создайте первую поставку для сборки."
            : tab === "fbs"
            ? "Пока нет FBS-поставок. Они появятся автоматически после загрузки заказов из подключённых кабинетов WB и Ozon."
            : "Пока нет поставок FBW/FBO. Подключите WB «Поставки» или создайте поставку вручную."}
        </p>
      ) : null}

      {shown.map((shipment) => (
        <ShipmentCard
          key={shipment.id}
          state={state}
          shipment={shipment}
          admin={admin}
          onDelete={() => removeFbsShipment(shipment)}
          finished={catalog}
          pending={pending}
          onMarkLine={(line) => markLine(shipment, line)}
          checked={selected.includes(shipment.id)}
          collapsed={collapsed.includes(shipment.id)}
          finishedCoverage={finishedCoverage}
          onToggle={() => toggle(shipment.id)}
          onToggleCollapse={() =>
            setCollapsed((current) =>
              current.includes(shipment.id) ? current.filter((id) => id !== shipment.id) : [...current, shipment.id],
            )
          }
          onHoverLine={(line) => hoverShipmentLine(shipment.id, line)}
        />
      ))}

      <div className="needs-box">
        <div className="needs-box-head">
          <h3>Сводка по выбранным поставкам</h3>
          <p className="hint">Выбор относится ко всей карточке. При объединении заказов выбранной становится вся объединённая карточка. Отметка «Собрано» сохраняется отдельно.</p>

        </div>
        {drafts.length > 0 ? (
          <label className="hint">
            <input
              type="checkbox"
              checked={allDraftSelected}
              onChange={() => setSelected(allDraftSelected ? [] : drafts.map((shipment) => shipment.id))}
            />{" "}
            Выбрать все черновики
          </label>
        ) : null}
        {needs.missingKits.length > 0 ? (
          <p className="warn-text">Нет состава: {needs.missingKits.join(", ")}</p>
        ) : null}
        {needs.rows.length === 0 ? (
          needs.missingKits.length === 0 && forCalc.some((shipment) => shipment.lines.length > 0) ? (
            <p className="ready-text">Комплектующие не требуются: выбранное количество уже есть в «Собрано на складе».</p>
          ) : (
            <p className="hint">Отметьте поставки галочкой — сводка считает только выбранные.</p>
          )
        ) : (
          <table className="sheet-table">
            <thead>
              <tr className="headers">
                <th>Позиция</th>
                <th>Нужно</th>
                <th>Физически</th>
                <th>Резерв</th>
                <th>Доступно</th>
                <th>Дополнительно</th>
                <th>Останется</th>
                <th>Докупить</th>
                <th>Сумма закупки</th>
              </tr>
            </thead>
            <tbody>
              {needs.rows.map((row) => (
                <tr key={row.item.id} className={hoverIds.includes(row.item.id) ? "bom-hit" : ""}>
                  <td className="name">{itemTitle(row.item)}</td>
                  <td className="num">{formatQty(row.needed)}</td>
                  <td className="num">{formatQty(row.onHand)}</td>
                  <td className="num">{formatQty(row.reserved)}</td>
                  <td className="num">{formatQty(row.available)}</td>
                  <td className="num">{formatQty(row.additional)}</td>
                  <td className={`num${row.remaining < 0 ? " warn" : ""}`}>{formatQty(row.remaining)}</td>
                  <td className={`num${row.toBuy > 0 ? " warn" : ""}`}>{formatQty(row.toBuy)}</td>
                  <td className="num">{formatCost(row.buyCost)}</td>
                </tr>
              ))}
              <tr>
                <td className="name">Итого докупить</td>
                <td /><td /><td /><td />
                <td />
                <td />
                <td />
                <td />
                <td className="num">{formatCost(needs.totalBuyCost)}</td>
              </tr>
            </tbody>
          </table>
        )}
        {collectingSelected ? (
          <p className="warn-text">
            В выборе есть поставка «копит новые заказы». Снимите с неё галочку, чтобы провести готовые партии «на сборке».
          </p>
        ) : null}
        {unmarkedSelected ? (
          <p className="warn-text">
            Завершить поставку можно только после отметки «Собрано» на всех готовых строках.
          </p>
        ) : null}
        {needs.rows.some((row) => row.toBuy > 0) && forCalc.length > 0 ? (
          <p className="warn-text">Проведение недоступно: сначала пополните недостающие комплектующие.</p>
        ) : null}
        <div className="post-row">
          {tab !== "stock" ? <form
            action={async (data) => {
              for (const shipment of forCalc) data.append("shipmentId", shipment.id);
              await run(postShipmentsAction, data);
            }}
          >
            <PendingButton className="primary" disabled={!canPost || pending}>
              Провести выбранные
            </PendingButton>
          </form> : null}
          {tab === "stock" ? (
            <form
              action={async (data) => {
                for (const shipment of forCalc) data.append("shipmentId", shipment.id);
                await run(packToAssembledAction, data);
              }}
            >
              <PendingButton className="primary-blue" disabled={!canPack || pending}>
                Добавить в склад
              </PendingButton>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function WbFbsConnection({
  status,
  admin,
  stats,
  settings = false,
}: {
  status: WbFbsStatus;
  admin: boolean;
  stats: ReactNode;
  settings?: boolean;
}) {
  const [message, setMessage] = useState("");

  if (!status.configured) {
    return (
      <section className="wb-fbs-connect">
        <div>
          <strong>WB Seller API · FBS</strong>

        </div>
        {admin && settings ? (
          <form
            className="wb-fbs-token-form"
            action={async (data) => {
              setMessage("Проверяю ключ и загружаю FBS-заказы…");
              const result = await configureWbFbsAction(data);
              setMessage(result.ok ? "WB подключён. Актуальная FBS поставка обновлена." : result.error);
            }}
          >
            <input
              type="password"
              name="token"
              autoComplete="off"
              placeholder="API-ключ WB с доступом «Маркетплейс»"
              required
            />
            <button type="submit" className="primary">
              Подключить WB
            </button>
          </form>
        ) : (
          <p className="hint">{admin?<Link prefetch={false} href="/settings?section=shipments">Подключить в настройках</Link>:"Подключить WB может администратор."}</p>
        )}
        {message ? <p className="wb-fbs-message">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="wb-fbs-connect connected">
      <div className="wb-fbs-status-line">
        <strong>WB Seller API · FBS</strong>
        <span className={status.lastError ? "wb-fbs-badge error" : "wb-fbs-badge"}>
          {status.lastError ? "Ошибка обновления" : "Автообновление включено"}
        </span>
      </div>
      {stats}
      {status.lastError ? <p className="warn-text">{status.lastError}</p> : null}
      {status.unknownArticles.length > 0 ? (
        <div className="wb-fbs-unknown">
          <strong>Не найдены артикулы из WB:</strong>{" "}
          {status.unknownArticles.map((row) => `${row.article} × ${formatQty(row.qty)}`).join(", ")}. Создайте такие
          артикулы в «Комплектах», иначе они не попадут в поставку.
        </div>
      ) : null}
      <div className="wb-fbs-actions">

        <button
          type="button"
          onClick={async () => {
            setMessage("Обновляю статусы всех FBS-поставок…");
            const result = await syncWbFbsAction();
            setMessage(result.ok ? "Статусы всех FBS-поставок обновлены." : result.error);
          }}
        >
          Обновить статусы всех поставок
        </button>
        {admin && settings ? (
          <>
          <details>
            <summary>Заменить API-ключ</summary>
            <form
              className="wb-fbs-token-form"
              action={async (data) => {
                setMessage("Проверяю новый ключ…");
                const result = await configureWbFbsAction(data);
                setMessage(result.ok ? "API-ключ заменён." : result.error);
              }}
            >
              <input type="password" name="token" autoComplete="off" placeholder="Новый API-ключ WB" required />
              <button type="submit">Сохранить ключ</button>
            </form>
          </details>
          <button
            type="button"
            onClick={async () => {
              if (!window.confirm("Отключить WB Seller API и очистить автоматическую FBS поставку?")) return;
              const result = await disconnectWbFbsAction();
              setMessage(result.ok ? "WB Seller API отключён." : result.error);
            }}
          >
            Отключить
          </button>
          </>
        ) : null}
      </div>
      {message ? <p className="wb-fbs-message">{message}</p> : null}
    </section>
  );
}

export function WbFboConnection({
  status,
  admin,
  stats,
  settings = false,
}: {
  status: WbFboStatus;
  admin: boolean;
  stats: ReactNode;
  settings?: boolean;
}) {
  const [message, setMessage] = useState("");

  if (!status.configured) {
    return (
      <section className="wb-fbs-connect">
        <div>
          <strong>WB Seller API · FBW / FBO</strong>

        </div>
        {admin && settings ? (
          <form
            className="wb-fbs-token-form"
            action={async (data) => {
              setMessage("Проверяю ключ и загружаю поставки FBW/FBO…");
              const result = await configureWbFboAction(data);
              setMessage(result.ok ? "WB подключён. Поставки FBW/FBO обновлены." : result.error);
            }}
          >
            <input
              type="password"
              name="token"
              autoComplete="off"
              placeholder="API-ключ WB с доступом «Поставки»"
              required
            />
            <button type="submit" className="primary">
              Подключить WB
            </button>
          </form>
        ) : (
          <p className="hint">{admin?<Link prefetch={false} href="/settings?section=shipments">Подключить в настройках</Link>:"Подключить WB может администратор."}</p>
        )}
        {message ? <p className="wb-fbs-message">{message}</p> : null}
      </section>
    );
  }

  return (
    <section className="wb-fbs-connect connected">
      <div className="wb-fbs-status-line">
        <strong>WB Seller API · FBW / FBO</strong>
        <span className={status.lastError ? "wb-fbs-badge error" : "wb-fbs-badge"}>
          {status.lastError ? "Ошибка обновления" : "Автообновление включено"}
        </span>
      </div>
      {stats}
      {status.lastError ? <p className="warn-text">{status.lastError}</p> : null}
      {status.unknownArticles.length > 0 ? (
        <div className="wb-fbs-unknown">
          <strong>Не найдены артикулы из WB:</strong>{" "}
          {status.unknownArticles.map((row) => `${row.article} × ${formatQty(row.qty)}`).join(", ")}. Создайте такие
          артикулы в «Комплектах», иначе они не попадут в поставку и не зарезервируются.
        </div>
      ) : null}
      <div className="wb-fbs-actions">

        <button
          type="button"
          onClick={async () => {
            setMessage("Обновляю поставки FBW/FBO…");
            const result = await syncWbFboAction();
            setMessage(result.ok ? "Поставки FBW/FBO обновлены." : result.error);
          }}
        >
          Обновить поставки
        </button>
        {admin && settings ? (
          <>
            <details>
              <summary>Заменить API-ключ</summary>
              <form
                className="wb-fbs-token-form"
                action={async (data) => {
                  setMessage("Проверяю новый ключ…");
                  const result = await configureWbFboAction(data);
                  setMessage(result.ok ? "API-ключ заменён." : result.error);
                }}
              >
                <input type="password" name="token" autoComplete="off" placeholder="Новый API-ключ WB" required />
                <button type="submit">Сохранить ключ</button>
              </form>
            </details>
            <button
              type="button"
              onClick={async () => {
                if (!window.confirm("Отключить синхронизацию поставок FBW/FBO из WB?")) return;
                const result = await disconnectWbFboAction();
                setMessage(result.ok ? "WB Seller API для FBW/FBO отключён." : result.error);
              }}
            >
              Отключить
            </button>
          </>
        ) : null}
      </div>
      {message ? <p className="wb-fbs-message">{message}</p> : null}
    </section>
  );
}

function wbFboStatusLabel(statusId: number | null) {
  if (statusId === 1) return "не запланировано";
  if (statusId === 2) return "запланировано";
  if (statusId === 3) return "отгрузка разрешена";
  if (statusId === 4) return "идёт приёмка";
  if (statusId === 5) return "принято";
  if (statusId === 6) return "отгружено на воротах";
  return "из WB";
}

function wbFboStatusClass(statusId: number | null) {
  if (statusId === 4) return "fbo-accepting";
  if (statusId === 5 || statusId === 6) return "fbo-done";
  return "fbo-open";
}

function ShipmentCard({
  state,
  shipment,
  admin,
  onDelete,
  finished,
  checked,
  collapsed,
  finishedCoverage,
  onToggle,
  onToggleCollapse,
  onHoverLine,
  pending,
  onMarkLine,
}: {
  state: AppState;
  shipment: Shipment;
  admin: boolean;
  onDelete: () => void;
  finished: AppState["items"];
  checked: boolean;
  collapsed: boolean;
  finishedCoverage: Map<string, ShipmentLineCoverage>;
  onToggle: () => void;
  onToggleCollapse: () => void;
  onHoverLine: (line: ShipmentLine | null) => void;
  pending: boolean;
  onMarkLine: (line: ShipmentLine) => void;
}) {
  const draft = shipment.status === "draft";
  const fromWbFbs = shipment.source === "wb-fbs"||shipment.source==="ozon-fbs";
  const fromWbFbo = shipment.source === "wb-fbo";
  const automated = fromWbFbs || fromWbFbo;
  const collecting = fromWbFbs && shipment.wbFbsStage === "collecting";
  return (
    <section
      className={`ship-card${draft ? "" : " posted"}${fromWbFbs ? " wb-fbs-card" : ""}${fromWbFbo ? " wb-fbo-card" : ""}${collapsed ? " collapsed" : ""}`}
    >
      <header className="ship-card-head">
        <label>
          <input type="checkbox" checked={checked} onChange={onToggle} /> {shipment.name} · {shipment.channel === "STOCK" ? "Склад" : shipment.channel}
          {fromWbFbs ? (
            <>
              {" · "}
              {shipment.ozonUnknown?.length?<span role="status">Нет комплекта: {shipment.ozonUnknown.join(", ")}</span>:null}<span className={`wb-fbs-stage-badge ${collecting ? "collecting" : "assembly"}`}>
                {collecting ? "копит новые заказы" : "зафиксирована на сборке"}
              </span>
              {shipment.wbFbsSupplyId ? ` · ${shipment.wbFbsSupplyId}` : ""}
              {" · "}
              {formatQty(shipment.source==="ozon-fbs"?(shipment.ozonPostingIds?.length??0):shipment.externalOrderIds.length)} заказов
            </>
          ) : null}
          {fromWbFbo ? (
            <>
              {" · "}
              <span className={`wb-fbs-stage-badge ${wbFboStatusClass(shipment.wbFboStatusId)}`}>
                {wbFboStatusLabel(shipment.wbFboStatusId)}
              </span>
            </>
          ) : null}
          {draft ? "" : " · проведена"}
          {draft && shipment.lines.length > 0 ? <span className="shipment-progress">
            Собрано строк: {shipment.lines.filter((line) => line.assembled).length} / {shipment.lines.length}
          </span> : null}
          {shipment.packedToAssembled ? " · в упакованных" : ""}
        </label>
        <div className="ship-card-head-actions">
          {draft && shipment.channel === "FBS" && admin ? (
            <button type="button" onClick={onDelete} disabled={pending} title="Удалить только из склада; заказы в WB и остатки сохранятся">
              Удалить поставку
            </button>
          ) : null}
          {draft && shipment.channel !== "FBS" && !automated ? (
            <form action={(data) => run(deleteShipmentAction, data)}>
              <input type="hidden" name="id" value={shipment.id} />
              <button type="submit">Удалить</button>
            </form>
          ) : null}
          <button
            type="button"
            className="ship-card-toggle"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
          >
            {collapsed ? "Показать" : "Скрыть"}
          </button>
        </div>
      </header>
      {collapsed ? null : (
      <div className="ship-card-body">
      <div className="ship-card-table">
      <table className="sheet-table mobile-cards mobile-shipment-list">
        <thead>
          <tr className="headers">
            <th>Товар</th>
            <th>Кол-во</th>
            <th>Есть собрано</th>
            <th>Дособрать</th>
            <th>Себес.</th>
            <th>Собрано</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {shipment.lines.map((line) => {
            const item = finished.find((entry) => entry.id === line.finishedItemId) ?? state.items.find((entry) => entry.id === line.finishedItemId);
            const warehousePart = item?.stockKind !== "finished";
            const unit = finishedLastBuyCost(state, line.finishedItemId);
            const lineCost = unit == null ? null : unit * line.qty;
            const coverage = finishedCoverage.get(shipmentLineKey(shipment.id, line.id)) ?? {
              fromFinishedStock: 0,
              toAssemble: line.qty,
            };
            return (
              <tr
                key={line.id}
                className={line.assembled ? "assembled" : ""}
                onMouseEnter={() => onHoverLine(line)}
                onMouseLeave={() => onHoverLine(null)}
              >
                <td data-label="Товар" className="name">
                  <KitCompositionPreview state={state} itemId={line.finishedItemId} shipmentQty={line.qty} shipmentName={shipment.name}>
                    {item ? itemTitle(item) : line.finishedItemId}
                    {warehousePart ? <span className="wb-fbs-stage-badge fbo-open">со склада</span> : null}
                  </KitCompositionPreview>
                </td>
                <td data-label="Кол-во" className="num">
                  {draft && !automated && (warehousePart || !line.assembled) ? (
                    <ShipmentQtyField key={`${line.id}-${line.qty}`} shipmentId={shipment.id} line={line} />
                  ) : (
                    formatQty(line.qty)
                  )}
                </td>
                <td data-label="Есть собрано" className={`num${coverage.fromFinishedStock > 0 ? " finished-ready" : ""}`}>
                  {formatQty(coverage.fromFinishedStock)}
                </td>
                <td data-label="Дособрать" className={`num${coverage.toAssemble > 0 ? " warn" : " finished-ready"}`}>
                  {formatQty(coverage.toAssemble)}
                </td>
                <td data-label="Себес." className="num">{lineCost == null ? "—" : formatCost(lineCost)}</td>
                <td data-label="Сборка">
                  {warehousePart ? (
                    draft ? "со склада" : "списано"
                  ) : draft ? (
                    <button type="button" className="assembly-toggle" aria-pressed={line.assembled} disabled={pending} onClick={() => onMarkLine(line)}
                      title={line.assembled ? "Снять отметку сборки" : "Подтвердить сборку всей строки"}>
                      {line.assembled ? "Собрано" : line.assembledQty ? `Собрано ${formatQty(line.assembledQty)} из ${formatQty(line.qty)}` : "Отметить"}
                    </button>
                  ) : (
                    "Собрано"
                  )}
                </td>
                <td data-label="">
                  {draft && !automated && (warehousePart || !line.assembled) ? (
                    <form action={(data) => run(deleteShipmentLineAction, data)}>
                      <input type="hidden" name="shipmentId" value={shipment.id} />
                      <input type="hidden" name="lineId" value={line.id} />
                      <button type="submit">Убрать</button>
                    </form>
                  ) : null}
                </td>
              </tr>
            );
          })}
          {shipment.lines.length > 0 ? (
            <tr>
              <td data-label="Товар" className="total name">Итого</td>
              <td data-label="Кол-во" className="total num">{formatQty(shipment.lines.reduce((sum, line) => sum + line.qty, 0))}</td>
              <td data-label="Есть собрано" className="total num">
                {formatQty(
                  shipment.lines.reduce(
                    (sum, line) =>
                      sum +
                      (finishedCoverage.get(shipmentLineKey(shipment.id, line.id))?.fromFinishedStock ?? 0),
                    0,
                  ),
                )}
              </td>
              <td data-label="Дособрать" className="total num">
                {formatQty(
                  shipment.lines.reduce(
                    (sum, line) =>
                      sum + (finishedCoverage.get(shipmentLineKey(shipment.id, line.id))?.toAssemble ?? line.qty),
                    0,
                  ),
                )}
              </td>
              <td data-label="Себес." className="total num">{formatCost(shipmentLastBuyCost(state, shipment))}</td>
              <td data-label="Сборка" className="total" />
              <td data-label="" className="total" />
            </tr>
          ) : null}
        </tbody>
      </table>
      </div>
      {draft && !automated ? <AddShipmentLineForm shipmentId={shipment.id} finished={finished} /> : null}
      </div>
      )}
    </section>
  );
}

function ShipmentQtyField({ shipmentId, line }: { shipmentId: string; line: ShipmentLine }) {
  const [qty, setQty] = useSessionDraft(`shipments.line.${shipmentId}.${line.id}`, String(line.qty));

  return (
    <form
      action={(data) => run(updateShipmentLineAction, data)}
      onBlur={(event) => {
        if (qty === String(line.qty)) return;
        event.currentTarget.requestSubmit();
      }}
    >
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <input type="hidden" name="lineId" value={line.id} />
      <input type="hidden" name="assembled" value={line.assembled ? "1" : "0"} />
      <input
        className="cell-input num"
        name="qty"
        type="text"
        inputMode="numeric"
        value={qty}
        onChange={(event) => setQty(event.target.value)}
      />
    </form>
  );
}

function AddShipmentLineForm({ shipmentId, finished }: { shipmentId: string; finished: AppState["items"] }) {
  const [draft, setDraft] = useSessionDraft<AddLineDraft>(`shipments.addLine.${shipmentId}`, EMPTY_ADD_LINE);

  return (
    <form
      className="add-row"
      action={async (data) => {
        const result = await addShipmentLineAction(data);
        if (!result.ok) {
          window.alert(result.error);
          return;
        }
        setDraft(EMPTY_ADD_LINE);
      }}
    >
      <input type="hidden" name="shipmentId" value={shipmentId} />
      <SkuPicker
        items={finished}
        placeholder="Найти товар по названию или артикулу"
        label={itemTitle}
        sortByTitle
        value={draft.itemId}
        onChange={(item) => setDraft((current) => ({ ...current, itemId: item?.id ?? "" }))}
      />
      <input
        name="qty"
        type="text"
        inputMode="numeric"
        placeholder="Количество"
        value={draft.qty}
        onChange={(event) => setDraft((current) => ({ ...current, qty: event.target.value }))}
        required
      />
      <PendingButton>В поставку</PendingButton>
    </form>
  );
}

function PendingButton({ children, disabled = false, className }: { children: ReactNode; disabled?: boolean; className?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} disabled={disabled || pending}>{pending ? "Сохраняю…" : children}</button>;
}

function ShipmentPageRefresh({ refreshKey, paused }: { refreshKey: string; paused: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let running = false;
    let seen = refreshKey;
    const controller = new AbortController();
    async function refresh() {
      if (running || document.visibilityState !== "visible") return;
      running = true;
      try {
        const response = await fetch("/api/shipments/status", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const snapshot = await response.json() as { refreshKey: string };
        if (!stopped && snapshot.refreshKey !== seen) {
          seen = snapshot.refreshKey;
          router.refresh();
        }
      } catch {
        // Повторим чтение при следующем опросе; действия пользователя не блокируются.
      } finally {
        running = false;
      }
    }
    const onFocus = () => void refresh();
    const timer = window.setInterval(onFocus, 3_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [paused, refreshKey, router]);
  return null;
}
