"use client";

import { useState } from "react";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { LineChart } from "@/components/studio/LineChart";
import { PageHeader, Segmented } from "@/components/ui/primitives";
import type { AnalyticsPeriod, AnalyticsSnapshot, Moment } from "@/lib/types";
import { totalReactions } from "@/lib/utils/access";
import { cn } from "@/lib/utils/cn";
import { formatClock, formatCount } from "@/lib/utils/format";

const PERIODS: { value: AnalyticsPeriod; label: string }[] = [
  { value: "today", label: "오늘" },
  { value: "7d", label: "7일" },
  { value: "30d", label: "30일" },
  { value: "month", label: "이번 달" },
];

export function AnalyticsView({ analytics, topMoments }: { analytics: AnalyticsSnapshot; topMoments: Moment[] }) {
  const [period, setPeriod] = useState<AnalyticsPeriod>("7d");
  const d = analytics.periods[period];

  const numbers = [
    { label: "조회수", value: formatCount(d.views), delta: d.deltas.views },
    { label: "반응", value: formatCount(d.reactions), delta: d.deltas.reactions },
    { label: "신규 구독", value: `+${d.newSubscribers}`, delta: d.deltas.newSubscribers },
  ];

  return (
    <main className="animate-fade-in">
      <PageHeader title="통계" />
      <div className="px-5">
        <Segmented options={PERIODS} value={period} onChange={setPeriod} />
      </div>

      <div key={period} className="animate-fade-in">
        <section className="mt-5 grid grid-cols-3 gap-2 px-5">
          {numbers.map((n) => (
            <div key={n.label} className="min-w-0">
              <p className="text-meta text-muted">{n.label}</p>
              <p className="mt-0.5 truncate text-section font-semibold tabular-nums">{n.value}</p>
              <p className={cn("text-micro font-medium", n.delta >= 0 ? "text-safe" : "text-danger")}>
                {n.delta >= 0 ? "▲" : "▼"} {Math.abs(n.delta)}%
              </p>
            </div>
          ))}
        </section>

        <section className="mx-5 mt-5 rounded-card border border-line bg-surface p-4">
          <p className="mb-4 text-caption font-medium text-ink-2">조회수 추이</p>
          <LineChart data={d.series} label="조회수" />
        </section>
      </div>

      <section className="pt-7">
        <h2 className="px-5 text-section font-semibold">가장 많이 반응한 Moment</h2>
        <ol className="mt-3 px-5 [&>li+li]:border-t [&>li+li]:border-line">
          {topMoments.map((m, i) => (
            <li key={m.id} className="flex items-center gap-3 py-2.5">
              <span className="w-4 shrink-0 text-center text-caption font-semibold text-brand tabular-nums">{i + 1}</span>
              <MomentMedia moment={m} variant="thumb" className="size-12 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-caption text-ink">{m.content}</p>
                <p className="mt-0.5 text-meta text-muted tabular-nums">
                  오늘 {formatClock(m.createdAt)} · 반응 {formatCount(totalReactions(m.reactions))}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="mx-8 mt-6 text-center text-meta text-faint">기록 횟수나 시간에 대한 목표는 없어요.</p>
    </main>
  );
}
