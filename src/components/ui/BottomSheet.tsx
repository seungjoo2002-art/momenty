"use client";

import { useEffect } from "react";

/** 하단에서 올라오는 시트. 배경을 누르거나 Esc로 닫힌다. */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 mx-auto flex max-w-[430px] flex-col justify-end" role="dialog" aria-modal aria-label={title}>
      <button type="button" aria-label="닫기" onClick={onClose} className="absolute inset-0 animate-fade-in bg-black/40" />
      <div className="relative animate-sheet-up rounded-t-[24px] bg-surface px-5 pt-2.5 pb-[max(env(safe-area-inset-bottom),20px)] text-ink">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line-strong" />
        {title && <p className="mb-3 text-name font-semibold">{title}</p>}
        {children}
      </div>
    </div>
  );
}
