import { CATEGORY_LABEL, KIND_LABEL, type Item } from "@/lib/types";

function groupedInt(value: number) {
  return String(Math.trunc(Math.abs(value))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** Количество и счётчики: целое, без знаков после запятой. */
export function formatQty(value: number) {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value + Number.EPSILON);
  const body = groupedInt(rounded);
  return rounded < 0 ? `-${body}` : body;
}

/** Средневзв. себес. и суммы по себестоимости: один знак, запятая. */
export function formatCost(value: number) {
  if (!Number.isFinite(value)) return "0,0";
  const rounded = Math.round((value + Number.EPSILON) * 10) / 10;
  const negative = rounded < 0;
  const [intPart, fracPart] = Math.abs(rounded).toFixed(1).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const body = `${grouped},${fracPart}`;
  return negative ? `-${body}` : body;
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? "";
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  });

export function formatDate(value: string) {
  const parts = dateTimeFormatter.formatToParts(new Date(value));
  return `${datePart(parts, "day")}.${datePart(parts, "month")}.${datePart(parts, "year")}, ${datePart(parts, "hour")}:${datePart(parts, "minute")}:${datePart(parts, "second")}`;
}

/** Календарная дата в Europe/Moscow, YYYY-MM-DD — для фильтра истории. */
const moscowDayFormatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

export function moscowDateKey(value: string) {
  return moscowDayFormatter.format(new Date(value));
}

/** Сдвиг календарной даты Москвы на целое число дней, YYYY-MM-DD. */
export function moscowDateShift(days: number, now = new Date()) {
  const today = moscowDateKey(now.toISOString());
  const [year, month, day] = today.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function formatMoney(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatCost(value)} ₽`;
}

export function itemTitle(item: Item) {
  if (item.category === "strap" && item.strapSize) {
    return `${item.name} (${item.strapSize} mm)`;
  }
  return item.name;
}

export function itemMeta(item: Item) {
  return `${KIND_LABEL[item.stockKind]} · ${CATEGORY_LABEL[item.category]}`;
}
