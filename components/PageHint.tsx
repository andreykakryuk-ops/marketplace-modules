"use client";

import { useState, type ReactNode } from "react";

export function PageHint({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="page-hint">
      <button type="button" className="page-hint-toggle" onClick={() => setOpen((current) => !current)}>
        {open ? "Скрыть подсказку" : "Как это работает"}
      </button>
      {open ? <div className="page-hint-body">{children}</div> : null}
    </div>
  );
}
