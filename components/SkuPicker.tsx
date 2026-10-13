"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { itemTitle } from "@/lib/format";
import type { Item } from "@/lib/types";

function compact(value: string) {
  return value.toLowerCase().replaceAll("_", "").replaceAll(" ", "").replaceAll("-", "");
}

function matchesItem(item: Item, query: string, label: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const c = compact(q);
  return (
    item.sku.toLowerCase().includes(q) ||
    item.name.toLowerCase().includes(q) ||
    label.toLowerCase().includes(q) ||
    compact(item.sku).includes(c) ||
    compact(item.name).includes(c) ||
    compact(label).includes(c) ||
    (item.strapSize != null && String(item.strapSize).includes(q))
  );
}

function skuLabel(item: Item) {
  return item.sku;
}

export function SkuPicker({
  items,
  name = "finishedItemId",
  queryName = "skuQuery",
  placeholder = "Введите или вставьте артикул",
  value,
  onChange,
  label,
  required = false,
  sortByTitle = false,
}: {
  items: Item[];
  name?: string;
  queryName?: string | null;
  placeholder?: string;
  value?: string;
  onChange?: (item: Item | null) => void;
  label?: (item: Item) => string;
  required?: boolean;
  sortByTitle?: boolean;
}) {
  const getLabel = label ?? skuLabel;
  const controlled = value !== undefined;
  const [innerId, setInnerId] = useState("");
  const selectedId = controlled ? value : innerId;
  const selected = items.find((item) => item.id === selectedId);
  const selectedLabel = selected ? getLabel(selected) : "";
  const [queryState, setQueryState] = useState({ selection: selectedId, text: selectedLabel });
  const query = queryState.selection === selectedId ? queryState.text : selectedLabel;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  function setQuery(text: string) {
    setQueryState({ selection: selectedId, text });
  }

  const filtered = useMemo(() => {
    const sorted = [...items].sort((a, b) =>
      sortByTitle ? itemTitle(a).localeCompare(itemTitle(b), "ru") : a.sku.localeCompare(b.sku, "ru"),
    );
    const searching = query.trim() !== "" && query !== selectedLabel;
    if (!searching) return sorted;
    return sorted.filter((item) => matchesItem(item, query, getLabel(item)));
  }, [getLabel, items, query, selectedLabel, sortByTitle]);

  useEffect(() => {
    function hide(event: PointerEvent) {
      if (!boxRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQueryState({ selection: selectedId, text: selectedLabel });
      }
    }
    document.addEventListener("pointerdown", hide);
    return () => document.removeEventListener("pointerdown", hide);
  }, [selectedId, selectedLabel]);

  function pick(item: Item) {
    if (!controlled) setInnerId(item.id);
    onChange?.(item);
    setQuery(getLabel(item));
    setOpen(false);
  }

  return (
    <div className="sku-picker" ref={boxRef}>
      <input type="hidden" name={name} value={selectedId} />
      {queryName ? <input type="hidden" name={queryName} value={query} /> : null}
      <input
        type="text"
        className="cell-input"
        autoComplete="off"
        placeholder={placeholder}
        required={required && !selectedId ? true : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={(event) => {
          setOpen(true);
          event.currentTarget.select();
        }}
        onPaste={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            setQuery(selectedLabel);
            return;
          }
          if (!open) {
            if (event.key === "ArrowDown") setOpen(true);
            return;
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActive((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
          }
          if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (event.key === "Enter" && filtered[active]) {
            event.preventDefault();
            pick(filtered[active]);
          }
        }}
      />
      {open ? (
        <ul className="sku-suggest">
          {filtered.length === 0 ? (
            <li className="empty">Ничего не найдено</li>
          ) : (
            filtered.map((item, index) => (
              <li key={item.id} className={index === active ? "active" : ""}>
                <button type="button" onClick={() => pick(item)} onPointerDown={event => { if (event.pointerType === "mouse") event.preventDefault(); }}>
                  {getLabel(item)}
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
