"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { BarChart, HBar } from "@/components/studio/BarChart";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { EmptyState, PageHeader, Segmented, Stat } from "@/components/ui/primitives";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getCreator } from "@/lib/services/creators";
import { getMomentsOn } from "@/lib/services/moments";
import { getCreatorAnalytics, type AnalyticsDay } from "@/lib/services/studio";
import { totalReactions } from "@/lib/utils/access";
import { daysAgoDate, formatClock, formatCount, formatDate, kstDate } from "@/lib/utils/format";

type Range = "today" | "7d" | "30d" | "day";

const shortLabel = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

/**
 * 통계 — DB에 실제로 있는 행만 센다 (creator_analytics · moment_feed).
 *   · Moment 수 · 받은 반응(반응 시각 기준) · 새 팔로워/구독(지금 유지 중인 관계의 시작일) · AI Avatar 대화량(열람 안내를 확인한 팬의 확인 이후 메시지만)
 *   · 조회수는 아직 저장하지 않는다 → "데이터 준비 중". 가짜 숫자를 만들지 않는다.
 *   · 업로드 횟수 · 연속 기록을 재촉하는 지표는 두지 않는다.
 */
export default function AnalyticsPage() {
  const creator = useStudioCreator();
  const today = kstDate();
  const [range, setRange] = useState<Range>("7d");
  const [pickedDay, setPickedDay] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);

  const [from, to] = range === "today" ? [today, today] : range === "7d" ? [daysAgoDate(6), today] : range === "30d" ? [daysAgoDate(29), today] : [pickedDay, pickedDay];
  const stats = useMomentData(`analytics:${creator.id}:${from}:${to}`, () => getCreatorAnalytics(from, to));
  const totals = useMomentData(`analytics-totals:${creator.id}`, async () => (await getCreator(creator.id)) ?? creator);
  const days = stats.data?.days ?? [];
  const singleDay = from === to;
  const focusDay = singleDay ? from : selected && days.some((d) => d.date === selected) ? selected : null;
  const detail = useMomentData(`analytics-day:${creator.id}:${focusDay ?? ""}`, async () => (focusDay ? getMomentsOn(creator.id, focusDay) : []));

  const sum = (k: keyof Omit<AnalyticsDay, "date">) => days.reduce((n, d) => n + d[k], 0);
  const empty = stats.data && sum("moments") + sum("reactions") + sum("newFollowers") + sum("aiMessages") === 0;
  const series = (k: keyof Omit<AnalyticsDay, "date">) => days.map((d) => ({ key: d.date, label: shortLabel(d.date), value: d[k] }));
  const moments = [...(detail.data ?? [])].sort((a, b) => totalReactions(b.reactions) - totalReactions(a.reactions));
  const maxReact = Math.max(...moments.map((m) => totalReactions(m.reactions)), 0);

  return (
    <main className="animate-fade-in pb-12">
      <PageHeader title="통계" caption={singleDay ? formatDate(from) : `${formatDate(from, false)} ~ ${formatDate(to, false)}`} />

      <div className="mx-5 grid grid-cols-2 rounded-card border border-line bg-surface py-3.5 text-center">
        <Stat value={formatCount(totals.data?.followers ?? creator.followers)} label="전체 팔로워" />
        <Stat value={formatCount(totals.data?.subscribers ?? creator.subscribers)} label="유료 구독자" className="border-l border-line" />
      </div>

      <Segmented<Range>
        className="mx-5 mt-5"
        value={range}
        onChange={(v) => {
          setRange(v);
          setSelected(null);
        }}
        options={[
          { value: "today", label: "오늘" },
          { value: "7d", label: "7일" },
          { value: "30d", label: "30일" },
          { value: "day", label: "날짜 선택" },
        ]}
      />
      {range === "day" && (
        <label className="mx-5 mt-3 flex items-center gap-3">
          <span className="shrink-0 text-caption text-muted">날짜</span>
          <input
            type="date"
            value={pickedDay}
            max={today}
            min={daysAgoDate(365)}
            onChange={(e) => e.target.value && setPickedDay(e.target.value)}
            className="h-10 min-w-0 flex-1 rounded-tile border border-line-strong bg-surface px-3 text-sub outline-none focus:border-brand"
          />
        </label>
      )}

      {!stats.data ? (
        stats.error ? <LoadError message={stats.error} onRetry={stats.retry} className="py-10" /> : <LoadingBlock />
      ) : (
        <>
          <dl className="mx-5 mt-5 grid grid-cols-2 gap-2.5">
            {(
              [
                ["Moment", sum("moments")],
                ["받은 반응", sum("reactions")],
                ["새 팔로워 · 구독", sum("newFollowers")],
                ["AI Avatar 대화", sum("aiMessages")],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded-tile bg-surface px-4 py-3 ring-1 ring-line ring-inset">
                <dt className="text-meta text-muted">{k}</dt>
                <dd className="mt-0.5 text-name font-semibold tabular-nums">{formatCount(v)}</dd>
              </div>
            ))}
            <div className="col-span-2 flex items-center justify-between rounded-tile bg-canvas px-4 py-2.5">
              <dt className="text-meta text-muted">조회수</dt>
              <dd className="text-meta text-faint">데이터 준비 중 — 아직 저장하지 않아요</dd>
            </div>
          </dl>

          {empty ? (
            <EmptyState icon={<BarChart3 className="size-5" />} title="이 기간에는 기록된 활동이 없어요" description="기록 · 반응 · 새 팔로워 · AI 대화가 생기면 여기에 보여요." />
          ) : (
            !singleDay && (
              <div className="mt-6 space-y-6 px-5">
                <ChartBlock title="일별 받은 반응" caption="막대를 누르면 그날을 자세히 봐요">
                  <BarChart data={series("reactions")} label="받은 반응" selected={focusDay} onSelect={setSelected} />
                </ChartBlock>
                <ChartBlock title="일별 Moment" caption="그날 기록한 Moment 수">
                  <BarChart data={series("moments")} label="Moment" selected={focusDay} onSelect={setSelected} />
                </ChartBlock>
                <ChartBlock title="새 팔로워 · 구독" caption="지금 유지 중인 관계의 시작일 기준 (취소한 관계는 세지 않아요)">
                  <BarChart data={series("newFollowers")} label="새 팔로워" selected={focusDay} onSelect={setSelected} />
                </ChartBlock>
                <ChartBlock title="AI Avatar 대화량" caption={`열람 안내를 확인한 팬의 대화만 집계됩니다 · 팬이 보낸 메시지 수 (대화한 팬 날짜별 합 ${formatCount(sum("aiFans"))}명)`}>
                  <BarChart data={series("aiMessages")} label="AI Avatar 대화" selected={focusDay} onSelect={setSelected} tone="ai" />
                </ChartBlock>
              </div>
            )
          )}

          {focusDay && (
            <section className="mt-7 px-5">
              <div className="flex items-baseline justify-between">
                <h2 className="text-section font-semibold">{formatDate(focusDay)}</h2>
                {!singleDay && (
                  <button type="button" onClick={() => setSelected(null)} className="text-caption text-muted">
                    닫기
                  </button>
                )}
              </div>
              {(() => {
                const d = days.find((x) => x.date === focusDay);
                return d ? (
                  <p className="mt-1 text-caption text-muted tabular-nums">
                    Moment {d.moments} · 받은 반응 {d.reactions} · 새 팔로워 {d.newFollowers} · AI 대화 {d.aiMessages}
                  </p>
                ) : null;
              })()}
              <h3 className="mt-4 text-sub font-semibold">그날의 Moment · 반응 비교</h3>
              {!detail.data ? (
                detail.error ? <LoadError message={detail.error} onRetry={detail.retry} className="py-6" /> : <LoadingBlock />
              ) : moments.length === 0 ? (
                <p className="mt-2 text-caption text-muted">이날 남긴 Moment가 없어요.</p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {moments.map((m) => (
                    <li key={m.id}>
                      <Link href={`/moments/${m.id}`} className="pressable flex items-center gap-3">
                        <MomentMedia moment={m} variant="thumb" className="size-12 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-caption text-ink">{m.content || "—"}</p>
                          <p className="text-meta text-muted">{formatClock(m.createdAt)}</p>
                          <HBar value={totalReactions(m.reactions)} max={maxReact} className="mt-1.5" />
                        </div>
                        <span className="w-10 shrink-0 text-right text-caption font-semibold tabular-nums">{formatCount(totalReactions(m.reactions))}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-meta text-faint">Moment별 반응은 지금까지 받은 전체 반응 수예요.</p>
            </section>
          )}
        </>
      )}
    </main>
  );
}

function ChartBlock({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <h2 className="text-sub font-semibold">{title}</h2>
      {caption && <p className="mt-0.5 mb-3 text-meta text-muted">{caption}</p>}
      {children}
    </section>
  );
}
