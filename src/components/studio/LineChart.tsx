"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";

const W = 320;
const H = 120;
const PAD_Y = 10;

/**
 * 단일 시리즈 라인 차트 (의존성 없음).
 * 2px 보라 선 + 아주 옅은 영역, 가로 가이드선 1개, 마지막 점만 직접 라벨.
 * 점마다 선보다 넓은 hover/touch 영역과 툴팁.
 */
export function LineChart({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.value)) * 1.1;
  const x = (i: number) => (data.length === 1 ? W / 2 : (i / (data.length - 1)) * W);
  const y = (v: number) => PAD_Y + (1 - v / max) * (H - PAD_Y * 2);
  const line = data.map((d, i) => `${i ? "L" : "M"}${x(i)},${y(d.value)}`).join(" ");
  const area = `${line} L${x(data.length - 1)},${H} L${x(0)},${H} Z`;
  const active = hover ?? data.length - 1;
  const pt = data[active];

  return (
    <figure aria-label={`${label} 추이`}>
      <div className="relative" style={{ height: H }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <line x1="0" x2={W} y1={H / 2} y2={H / 2} className="stroke-line" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
          <path d={area} className="fill-brand/[0.07]" />
          <path d={line} fill="none" className="stroke-brand" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          {hover !== null && (
            <line x1={x(active)} x2={x(active)} y1="0" y2={H} className="stroke-line-strong" vectorEffect="non-scaling-stroke" />
          )}
        </svg>

        {/* 점 + 값 라벨 */}
        <span
          className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-brand"
          style={{ left: `${(x(active) / W) * 100}%`, top: y(pt.value) }}
        />
        <span
          className={cn(
            "pointer-events-none absolute -translate-y-full rounded-md bg-ink px-1.5 py-0.5 text-micro font-medium whitespace-nowrap text-white tabular-nums",
            active === data.length - 1 ? "-translate-x-full" : active === 0 ? "" : "-translate-x-1/2",
          )}
          style={{ left: `${(x(active) / W) * 100}%`, top: y(pt.value) - 8 }}
        >
          {pt.label} · {formatCount(pt.value)}
        </span>

        {/* hit targets */}
        <div className="absolute inset-0 flex">
          {data.map((d, i) => (
            <button
              key={d.label}
              type="button"
              aria-label={`${d.label} ${label} ${formatCount(d.value)}`}
              className="h-full flex-1"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              onTouchStart={() => setHover(i)}
            />
          ))}
        </div>
      </div>
      <div className="mt-2 flex justify-between">
        {data.map((d, i) => (
          <span key={d.label} className={cn("text-micro", i === active ? "font-semibold text-ink" : "text-muted")}>
            {d.label}
          </span>
        ))}
      </div>
    </figure>
  );
}
