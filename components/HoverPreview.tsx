"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function HoverPreview({
  label, content, editable = false, children,
}: {
  label: string; content: ReactNode; editable?: boolean; children: ReactNode;
}) {
  const id = useId();
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number; width: number; maxHeight: number } | null>(null);

  function cancelClose() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  function open() {
    cancelClose();
    const rect = anchor.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, window.innerWidth - 16);
    const maxHeight = Math.min(320, window.innerHeight - 16);
    const fitsRight = rect.right + width + 16 <= window.innerWidth;
    const fitsLeft = rect.left >= width + 16;
    const left = fitsRight ? rect.right + 8 : fitsLeft ? rect.left - width - 8 : 8;
    const preferredTop = fitsRight || fitsLeft ? rect.top : rect.bottom + 8;
    const top = Math.max(8, Math.min(preferredTop, window.innerHeight - maxHeight - 8));
    setPosition({ left, top, width, maxHeight });
  }

  function closeSoon() {
    cancelClose();
    timer.current = setTimeout(() => setPosition(null), 180);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  useEffect(() => {
    if (!position) return;
    function close(event: Event) {
      if (event.type === "scroll" && event.target instanceof Node && panel.current?.contains(event.target)) return;
      setPosition(null);
    }
    function key(event: KeyboardEvent) {
      if (event.key === "Escape") setPosition(null);
    }
    function outside(event: PointerEvent) {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !panel.current?.contains(event.target)) setPosition(null);
    }
    document.addEventListener("pointerdown", outside);
    window.visualViewport?.addEventListener("resize", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.visualViewport?.removeEventListener("resize", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", key);
    };
  }, [position]);

  return (
    <div
      ref={anchor}
      className="item-usage-anchor"
      tabIndex={editable ? undefined : 0}
      aria-describedby={position ? id : undefined}
      onPointerUp={event => { if (event.target instanceof Node && anchor.current?.contains(event.target) && (event.pointerType === "touch" || event.pointerType === "pen")) open(); }}
      onMouseEnter={() => { if (window.matchMedia("(hover: hover) and (pointer: fine)").matches) open(); }}
      onMouseLeave={closeSoon}
      onFocus={event => { if (anchor.current?.contains(event.target)) open(); }}
      onBlur={closeSoon}
    >
      {children}
      {position ? createPortal(
        <div
          ref={panel}
          id={id}
          role="tooltip"
          aria-label={label}
          className="item-usage-preview"
          style={position}
          onMouseEnter={cancelClose}
          onMouseLeave={closeSoon}
        >
          <button type="button" className="preview-close" aria-label="Закрыть подсказку"
            onPointerDown={event => { event.stopPropagation(); event.preventDefault(); }}
            onPointerUp={event => { event.stopPropagation(); event.preventDefault(); cancelClose(); setPosition(null); }}
            onClick={event => { event.stopPropagation(); cancelClose(); setPosition(null); }}>×</button>
          {content}
        </div>, document.body,
      ) : null}
    </div>
  );
}
