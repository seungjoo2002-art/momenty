"use client";

import { VISIBILITY_META } from "@/components/badges";
import type { Visibility } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";

const ORDER: Visibility[] = ["public", "subscribers", "premium"];

/** Moment 공개범위: ○ 전체 / ● 구독자 / ○ Premium — 한 그룹 안의 라디오 목록 */
export function VisibilitySelector({
  value,
  onChange,
  audience,
}: {
  value: Visibility;
  onChange: (v: Visibility) => void;
  /** 각 범위에서 볼 수 있는 인원 */
  audience?: Partial<Record<Visibility, number>>;
}) {
  return (
    <div role="radiogroup" aria-label="공개범위" className="overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line">
      {ORDER.map((v) => {
        const meta = VISIBILITY_META[v];
        const active = value === v;
        return (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(v)}
            className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150", active && "bg-brand-tint")}
          >
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full border-2 transition-colors",
                active ? "border-brand" : "border-line-strong",
              )}
            >
              <span className={cn("size-2.5 rounded-full bg-brand transition-transform duration-150", active ? "scale-100" : "scale-0")} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn("block text-sub", active ? "font-semibold" : "font-medium")}>{meta.label}</span>
              <span className="block text-meta text-muted">
                {meta.description}
                {audience?.[v] !== undefined && ` · 약 ${formatCount(audience[v]!)}명`}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
