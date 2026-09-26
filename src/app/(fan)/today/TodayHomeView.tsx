"use client";

import Link from "next/link";
import { CreatorStoryRow } from "@/components/creator/CreatorStoryRow";
import { TodayHero } from "@/components/creator/TodayHero";
import { TodayTile } from "@/components/creator/TodayTile";
import { pickTodayPreview } from "@/components/creator/todayPreview";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError } from "@/components/ui/LoadState";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getCurrentFan, getTodayFeed } from "@/lib/services/fan";
import { formatDate, kstDate } from "@/lib/utils/format";

const loadHome = async () => {
  const [fan, feed] = await Promise.all([getCurrentFan(), getTodayFeed()]);
  return { fan, feed };
};

/**
 * Today Home — 새 Moment가 공개되면 개수 · 최근 Moment · 마지막 업데이트 시간이 바로 바뀐다.
 * Moment 저장소가 브라우저에 있으므로 클라이언트에서 불러온다.
 */
export function TodayHomeView() {
  const { data, error, retry } = useMomentData("today-home", loadHome);
  if (!data) return <main className="min-h-dvh">{error && <LoadError message={error} onRetry={retry} className="pt-32" />}</main>;
  const { fan, feed } = data;
  const active = feed.filter((f) => f.moments.length > 0);
  const quiet = feed.filter((f) => f.moments.length === 0);

  // 가장 최근에 기록한 사람 중, 볼 수 있는 사진이 있는 사람을 Hero로
  const hero = active.find((f) => pickTodayPreview(f.moments, f.tier).visual) ?? active[0];
  const rest = active.filter((f) => f !== hero);

  return (
    <main className="animate-fade-in">
      <header className="flex h-12 items-center justify-between px-5">
        <span className="text-caption font-bold tracking-[0.28em]">MOMENTY</span>
        <Link href="/my" aria-label="My" className="pressable">
          <Avatar src={fan.avatarUrl} name={fan.nickname} size="sm" />
        </Link>
      </header>

      <section className="px-5 pt-3 pb-5">
        <h1 className="text-title font-bold">오늘, 함께하는 하루</h1>
        <p className="mt-1 text-sub text-muted">지금 이 순간도, 이야기가 되는 중이에요.</p>
      </section>

      <CreatorStoryRow items={feed.map((f) => ({ creator: f.creator, count: f.moments.length }))} />

      {hero ? (
        <section className="px-5 pt-5">
          <TodayHero creator={hero.creator} tier={hero.tier} moments={hero.moments} />
        </section>
      ) : (
        <p className="px-5 pt-8 text-center text-sub text-muted">아직 오늘의 순간을 남긴 사람이 없어요.</p>
      )}

      {rest.length > 0 && (
        <section className="pt-7">
          <h2 className="px-5 text-section font-semibold">다른 사람들의 오늘</h2>
          <div className="mt-3 grid grid-cols-2 gap-2.5 px-5">
            {rest.map((f) => (
              <TodayTile key={f.creator.id} creator={f.creator} tier={f.tier} moments={f.moments} />
            ))}
          </div>
        </section>
      )}

      {quiet.length > 0 && (
        <section className="px-5 pt-7">
          <p className="text-meta text-muted">아직 조용한 하루</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {quiet.map((f) => (
              <Link
                key={f.creator.id}
                href={`/creators/${f.creator.id}/today`}
                className="pressable inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface pr-3.5 pl-1"
              >
                <Avatar src={f.creator.avatarUrl} name={f.creator.name} size="sm" className="scale-90" />
                <span className="text-caption text-ink-2">{f.creator.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="px-5 pt-8 text-center text-meta text-faint">{formatDate(kstDate())}</p>
    </main>
  );
}
