"use client";

import { Compass, Sun } from "lucide-react";
import Link from "next/link";
import { useAccount } from "@/components/auth/AuthProvider";
import { CreatorStoryRow } from "@/components/creator/CreatorStoryRow";
import { TodayHero } from "@/components/creator/TodayHero";
import { TodayTile } from "@/components/creator/TodayTile";
import { pickTodayPreview } from "@/components/creator/todayPreview";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadState";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getTodayFeed } from "@/lib/services/fan";
import { formatDate, kstDate } from "@/lib/utils/format";

/**
 * Today Home — 내가 팔로우/구독한 크리에이터가 오늘 실제로 남긴 Moment만.
 * 새 Moment가 공개되면 개수 · 최근 Moment · 마지막 업데이트 시간이 바로 바뀐다.
 */
export function TodayHomeView() {
  const account = useAccount();
  const { data: feed, error, retry } = useMomentData(`today-home:${account?.userId ?? ""}`, getTodayFeed);

  const header = (
    <header className="flex h-12 items-center justify-between px-5">
      <span className="text-caption font-bold tracking-[0.28em]">MOMENTY</span>
      <Link href="/my" aria-label="My" className="pressable">
        <Avatar src={account?.avatarUrl || undefined} name={account?.nickname || "나"} size="sm" />
      </Link>
    </header>
  );

  if (!feed) {
    return (
      <main className="min-h-dvh">
        {header}
        {error && <LoadError message={error} onRetry={retry} className="pt-24" />}
      </main>
    );
  }

  // 아직 아무도 팔로우하지 않은 새 사용자
  if (feed.length === 0) {
    return (
      <main className="animate-fade-in">
        {header}
        <div className="flex min-h-[70dvh] flex-col items-center justify-center px-8 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-brand-tint text-brand">
            <Compass className="size-5" />
          </span>
          <p className="mt-3 text-name font-semibold">좋아하는 크리에이터를 찾아보세요</p>
          <p className="mt-1 text-caption text-muted">팔로우하면 그 사람이 오늘 남긴 순간이 이곳에 차례로 쌓여요.</p>
          <ButtonLink href="/discover" className="mt-6">
            크리에이터 둘러보기
          </ButtonLink>
        </div>
      </main>
    );
  }

  const active = feed.filter((f) => f.moments.length > 0);
  const quiet = feed.filter((f) => f.moments.length === 0);
  const total = active.reduce((n, f) => n + f.moments.length, 0);

  // 가장 최근에 기록한 사람 중, 볼 수 있는 사진이 있는 사람을 Hero로
  const hero = active.find((f) => pickTodayPreview(f.moments, f.tier).visual) ?? active[0];
  const rest = active.filter((f) => f !== hero);

  return (
    <main className="animate-fade-in">
      {header}

      <section className="px-5 pt-3 pb-5">
        <h1 className="text-title font-bold">오늘, 함께하는 하루</h1>
        <p className="mt-1 text-sub text-muted">
          {total ? (
            <>
              <span className="text-meta font-semibold tracking-[0.12em] text-brand">TODAY · {total} MOMENTS</span>
            </>
          ) : (
            "지금 이 순간도, 이야기가 되는 중이에요."
          )}
        </p>
      </section>

      <CreatorStoryRow items={feed.map((f) => ({ creator: f.creator, count: f.moments.length }))} />

      {hero ? (
        <section className="px-5 pt-5">
          <TodayHero creator={hero.creator} tier={hero.tier} moments={hero.moments} />
        </section>
      ) : (
        <div className="flex flex-col items-center px-8 pt-12 text-center">
          <Sun className="size-6 text-faint" />
          <p className="mt-3 text-sub font-semibold">아직 오늘의 Moment가 없어요.</p>
          <p className="mt-1 text-caption text-muted">크리에이터가 순간을 남기면 이곳에 바로 나타나요.</p>
        </div>
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
                <Avatar src={f.creator.avatarUrl || undefined} name={f.creator.name} size="sm" className="scale-90" />
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
