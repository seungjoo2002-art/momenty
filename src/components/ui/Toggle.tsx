"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

interface ToggleProps {
  defaultOn?: boolean;
  /** 주면 제어 컴포넌트 (저장 실패 시 되돌리기 등) */
  checked?: boolean;
  disabled?: boolean;
  /** 끌 수 없는 항목 (예: AI 표시) */
  locked?: boolean;
  label?: string;
  onChange?: (on: boolean) => void;
}

export function Toggle({ defaultOn = false, checked, disabled, locked, label, onChange }: ToggleProps) {
  const [inner, setInner] = useState(defaultOn);
  const on = checked ?? inner;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={locked || disabled}
      onClick={() => {
        if (checked === undefined) setInner(!on);
        onChange?.(!on);
      }}
      className={cn(
        "relative h-7 w-12 shrink-0 rounded-full transition-colors",
        on ? "bg-brand" : "bg-line-strong",
        locked && "opacity-60",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow transition-transform",
          on && "translate-x-5",
        )}
      />
    </button>
  );
}

/** 라벨 + 설명 + 토글 한 줄 */
export function ToggleRow({
  title,
  description,
  defaultOn,
  checked,
  disabled,
  locked,
  onChange,
}: {
  title: string;
  description?: string;
  defaultOn?: boolean;
  checked?: boolean;
  disabled?: boolean;
  locked?: boolean;
  onChange?: (on: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-4 px-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-body font-medium">{title}</div>
        {description && <p className="mt-0.5 text-caption leading-relaxed text-muted">{description}</p>}
      </div>
      <Toggle defaultOn={defaultOn} checked={checked} disabled={disabled} locked={locked} label={title} onChange={onChange} />
    </div>
  );
}
