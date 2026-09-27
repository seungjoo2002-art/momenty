"use client";

import Link from "next/link";
import { useStudioCreator } from "@/components/auth/Gates";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { LoadError } from "@/components/ui/LoadState";
import { PageHeader, SectionHeader, Stat } from "@/components/ui/primitives";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getCreator } from "@/lib/services/creators";
import { getStudioStats } from "@/lib/services/studio";
import { totalReactions } from "@/lib/utils/access";
import { formatClock, formatCount, formatDate, dateKeyOf } from "@/lib/utils/format";

/**
 * 통계 — 실제 Moment · 반응 · 팔로우 수에서 계산한 것만.
 * (조회수 추적은 아직 없다. 업로드 횟수 · 연속 기록을 재촉하는 지표는 두지 않는다)
 */
export default function AnalyticsPage() {
  const creator = useStudioCreator();
  const { data, error, retry } = useMomentData(`stats:${creator.id}`, async () => {
    const [stats, fresh] = await Promise.all([getStudioStats(creator.id), getCreator(creator.id)]);
    return { ...stats, followers: fresh?.followers ?? creator.followers, subscribers: fresh?.subscribers ?? creator.subscribers };
  });

  return (
    <main className="animate-fade-in">
      <PageHeader title="통계" caption="최근 7일" />
      <div className="mx-5 grid grid-cols-3 rounded-card border border-line bg-surface py-3.5 text-center">
        <Stat value={formatCount(data?.followers ?? creator.followers)} label="팔로워" />
        <Stat value={formatCount(data?.subscribers ?? creator.subscribers)} label="구독자" className="border-x border-line" />
        <Stat value={data ? formatCount(data.weekReactions) : "·"} label="받은 반응" />
      </div>

      <section className="mt-7">
        <SectionHeader title="반응이 많았던 순간" />
        {!data ? (
          error && <LoadError message={error} onRetry={retry} className="py-8" />
        ) : data.top.length === 0 ? (
          <p className="px-5 text-sub text-muted">최근 7일 동안 받은 반응이 아직 없어요.</p>
        ) : (
          <ul className="space-y-2 px-5">
            {data.top.map((m) => (
              <li key={m.id}>
                <Link href={`/moments/${m.id}`} className="pressable flex items-center gap-3">
                  <MomentMedia moment={m} variant="thumb" className="size-12 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption text-ink">{m.content || "—"}</p>
                    <p className="text-meta text-muted">
                      {formatDate(dateKeyOf(m.createdAt), false)} {formatClock(m.createdAt)}
                    </p>
                  </div>
                  <span className="text-caption font-semibold tabular-nums">{formatCount(totalReactions(m.reactions))}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
