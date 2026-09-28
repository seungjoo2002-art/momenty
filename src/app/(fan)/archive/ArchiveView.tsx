"use client";

import { Archive } from "lucide-react";
import Link from "next/link";
import { DailyCard } from "@/components/moment/DailyCard";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError } from "@/components/ui/LoadState";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { getCreators } from "@/lib/services/creators";
import { getCurrentFan, getSavedMoments } from "@/lib/services/fan";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getDailyRecordsFor } from "@/lib/services/moments";
import { getMyBlockedUserIds } from "@/lib/services/safety";
import { canViewMoment } from "@/lib/utils/access";
import { formatDate, shortName } from "@/lib/utils/format";

async function loadArchive() {
  const fan = await getCurrentFan();
  const [creators, savedAll, dailiesAll, blockedUsers] = await Promise.all([
    getCreators(),
    getSavedMoments(),
    // 지난 날짜의 Moment를 날짜 · 크리에이터별로 묶은 Daily (팬이 볼 수 있는 것만 제목·커버로)
    getDailyRecordsFor(
      fan.subscriptions.map((s) => s.creatorId),
      fan,
    ),
    getMyBlockedUserIds(),
  ]);
  // 내가 차단한 크리에이터의 지난 하루 · 보관한 Moment는 보이지 않게
  const blocked = new Set(creators.filter((c) => blockedUsers.has(c.profileId)).map((c) => c.id));
  return { fan, creators, saved: savedAll.filter((m) => !blocked.has(m.creatorId)), dailies: dailiesAll.filter((d) => !blocked.has(d.creatorId)) };
}

export function ArchiveView() {
  const { data, error, retry } = useMomentData("archive", loadArchive);
  if (!data) return <main className="min-h-dvh">{error && <LoadError message={error} onRetry={retry} className="pt-32" />}</main>;
  const { fan, creators, saved, dailies } = data;
  const creatorOf = (id: string) => creators.find((c) => c.id === id);

  // 날짜별 그룹
  const byDate = dailies.reduce<Record<string, typeof dailies>>((acc, d) => {
    (acc[d.date] ??= []).push(d);
    return acc;
  }, {});

  return (
    <main className="animate-fade-in">
      <PageHeader title="Archive" caption="함께했던 지난 하루들" />

      {saved.length === 0 && dailies.length === 0 && (
        <EmptyState
          icon={<Archive className="size-5" />}
          title="아직 지난 하루가 없어요"
          description={fan.subscriptions.length ? "오늘이 지나면 함께한 하루가 이곳에 남아요. 마음에 드는 Moment는 보관할 수도 있어요." : "크리에이터를 팔로우하면 함께한 하루가 이곳에 쌓여요."}
        />
      )}

      {saved.length > 0 && (
        <section>
          <SectionHeader title="보관한 Moment" caption={`${saved.length}개`} />
          <div className="no-scrollbar flex gap-2 overflow-x-auto px-5">
            {saved.map((m) => {
              const c = creatorOf(m.creatorId);
              if (!c) return null;
              return (
                <Link key={m.id} href={`/moments/${m.id}`} className="pressable w-[92px] shrink-0">
                  <MomentMedia moment={m} variant="thumb" locked={!canViewMoment(fan, m)} />
                  <div className="mt-1.5 flex items-center gap-1">
                    <Avatar src={c.avatarUrl} name={c.name} size="xs" className="scale-90" />
                    <span className="truncate text-meta text-ink-2">{shortName(c.name)}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {Object.entries(byDate).map(([date, days]) => (
        <section key={date} className="mt-7">
          <div className="mb-2.5 flex items-baseline gap-2 px-5">
            <h2 className="text-name font-semibold">{formatDate(date)}</h2>
            <span className="text-meta text-muted">
              {days.length}명의 하루 · {days.reduce((n, d) => n + d.momentCount, 0)} Moments
            </span>
          </div>
          <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-5">
            {days.map((d) => (
              <Link key={d.id} href={`/moments/${d.firstMomentId}`} className="pressable w-[124px] shrink-0">
                <DailyCard daily={d} caption={creatorOf(d.creatorId)?.name ?? ""} />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
