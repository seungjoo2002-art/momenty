"use client";

import Link from "next/link";
import { VisibilityBadge } from "@/components/badges";
import { DailyCard } from "@/components/moment/DailyCard";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { LoadError } from "@/components/ui/LoadState";
import { PageHeader, SectionHeader } from "@/components/ui/primitives";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getDailyRecords, getTodayMoments } from "@/lib/services/moments";
import { formatDate, kstDate } from "@/lib/utils/format";

/** 내가 남긴 오늘 + 지난 하루 (지난 Moment를 날짜별로 묶어 계산) */
export function RecordsView({ creatorId }: { creatorId: string }) {
  const { data, error, retry } = useMomentData(`records:${creatorId}`, async () => {
    const [today, dailies] = await Promise.all([getTodayMoments(creatorId), getDailyRecords(creatorId)]);
    return { today, dailies };
  });
  if (!data) return <main className="min-h-dvh">{error && <LoadError message={error} onRetry={retry} className="pt-32" />}</main>;
  const { today, dailies } = data;

  return (
    <main className="animate-fade-in">
      <PageHeader title="Records" caption="내가 남긴 하루들" />

      <section>
        <SectionHeader title="오늘" caption={formatDate(kstDate())} href="/studio" actionLabel="Timeline" />
        {today.length ? (
          <div className="grid grid-cols-3 gap-2 px-5">
            {today.map((m) => (
              <Link key={m.id} href={`/moments/${m.id}`} className="pressable relative block">
                <MomentMedia moment={m} variant="thumb" />
                {m.visibility !== "public" && (
                  <VisibilityBadge visibility={m.visibility} className="absolute bottom-1.5 left-1.5 scale-90" />
                )}
              </Link>
            ))}
          </div>
        ) : (
          <p className="px-5 text-sub text-muted">오늘은 아직 남긴 순간이 없어요.</p>
        )}
      </section>

      <section className="mt-9">
        <SectionHeader title="지난 하루" />
        {dailies.length === 0 && <p className="px-5 text-sub text-muted">오늘이 지나면 이곳에 하루가 쌓여요.</p>}
        <div className="grid grid-cols-2 gap-2.5 px-5">
          {dailies.map((d) => (
            <Link key={d.id} href={`/moments/${d.firstMomentId}`} className="pressable block">
              <DailyCard daily={d} caption={d.highlight} />
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
