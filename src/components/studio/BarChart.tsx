"use client";

import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";

const H = 112;

/**
 * 막대 차트 (의존성 없음) — 날짜별 값. 막대를 누르면 그날을 고른다.
 * 값이 모두 0이면 막대 대신 바닥선만 (가짜 높이를 만들지 않는다). 라벨은 겹치지 않게 일부만.
 */
export function BarChart({
  data,
  label,
  selected,
  onSelect,
  tone = "brand",
}: {
  data: { key: string; label: string; value: number }[];
  label: string;
  selected?: string | null;
  onSelect?: (key: string) => void;
  tone?: "brand" | "ai";
}) {
  const max = Math.max(...data.map((d) => d.value), 0);
  const every = Math.max(1, Math.ceil(data.length / 7));
  return (
    <figure aria-label={`${label} 날짜별`}>
      <div className="flex items-end gap-[3px]" style={{ height: H }}>
        {data.map((d) => {
          const h = max ? Math.max((d.value / max) * (H - 18), d.value ? 3 : 0) : 0;
          const active = selected === d.key;
          return (
            <button
              key={d.key}
              type="button"
              onClick={() => onSelect?.(d.key)}
              aria-label={`${d.label} ${label} ${formatCount(d.value)}`}
              aria-pressed={active}
              className="group relative flex h-full min-w-0 flex-1 flex-col justify-end"
            >
              {(active || (data.length <= 7 && d.value > 0)) && (
                <span className="pointer-events-none absolute inset-x-0 text-center text-micro font-semibold text-ink tabular-nums" style={{ bottom: h + 2 }}>
                  {formatCount(d.value)}
                </span>
              )}
              <span
                className={cn(
                  "block w-full rounded-t-[3px] transition-colors",
                  tone === "ai" ? (active ? "bg-ai" : "bg-ai/35 group-hover:bg-ai/55") : active ? "bg-brand" : "bg-brand/35 group-hover:bg-brand/55",
                )}
                style={{ height: h }}
              />
              <span className="block h-px w-full bg-line" />
            </button>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-[3px]">
        {data.map((d, i) => (
          <span key={d.key} className={cn("min-w-0 flex-1 truncate text-center text-micro", selected === d.key ? "font-semibold text-ink" : "text-muted")}>
            {i % every === 0 || selected === d.key ? d.label : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

/** 가로 막대 비교 (Moment별 반응 등) */
export function HBar({ value, max, className }: { value: number; max: number; className?: string }) {
  return (
    <span className={cn("block h-1.5 overflow-hidden rounded-full bg-brand-tint", className)}>
      <span className="block h-full rounded-full bg-brand" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </span>
  );
}
