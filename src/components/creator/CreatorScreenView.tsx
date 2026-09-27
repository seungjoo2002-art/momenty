"use client";

import { ChevronRight, Moon } from "lucide-react";
import Link from "next/link";
import { useAccount } from "@/components/auth/AuthProvider";
import { SubscriptionBadge, VerifiedMark } from "@/components/badges";
import { DailyCard } from "@/components/moment/DailyCard";
import { MomentTimeline } from "@/components/moment/MomentTimeline";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { Photo } from "@/components/ui/Photo";
import { TopBar } from "@/components/ui/TopBar";
import { CATEGORY_LABEL, FEATURES } from "@/lib/constants";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getCreator } from "@/lib/services/creators";
import { getCurrentFan } from "@/lib/services/fan";
import { getDailyRecords, getTodayMoments } from "@/lib/services/moments";
import type { Creator, DailyRecord, Moment, Tier } from "@/lib/types";
import { canChat, isMomentLocked, tierFor } from "@/lib/utils/access";
import { formatCount, formatDate, josa, kstDate, shortName } from "@/lib/utils/format";
import { CreatorTabs, type CreatorTab } from "./CreatorTabs";
import { FollowButton } from "./FollowButton";

/**
 * 크리에이터 화면 본문. 오늘의 Moment · 지난 하루 · 팔로우 상태는 로그인 사용자 기준으로 불러오고,
 * 새 Moment가 공개되거나 팔로우가 바뀌면 바로 다시 불러온다.
 */
export function CreatorScreenView({ creator: initialCreator, initialTab }: { creator: Creator; initialTab: CreatorTab }) {
  const account = useAccount();
  const { data, error, retry } = useMomentData(`creator:${initialCreator.id}:${account?.userId ?? ""}`, async () => {
    const fan = await getCurrentFan();
    const [creator, moments, dailies] = await Promise.all([
      getCreator(initialCreator.id),
      getTodayMoments(initialCreator.id),
      getDailyRecords(initialCreator.id, fan),
    ]);
    return { creator: creator ?? initialCreator, moments, dailies, tier: tierFor(fan, initialCreator.id) };
  });
  const creator = data?.creator ?? initialCreator;
  const moments = data?.moments ?? [];
  const tier = data?.tier;
  const isOwner = !!account?.creator && account.creator.id === creator.id;
  const pending = error ? <LoadError message={error} onRetry={retry} /> : <LoadingBlock />;

  return (
    <main className="animate-fade-in">
      {/* Cover */}
      <div className="relative">
        <Photo src={creator.coverUrl || undefined} alt={creator.name} className="aspect-[16/11]">
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/65" />
          <div className="absolute inset-x-5 bottom-4 flex items-end gap-3 text-white">
            <Avatar src={creator.avatarUrl} name={creator.name} size="lg" ring={moments.length ? "today" : "none"} />
            <div className="min-w-0 flex-1 pb-0.5">
              <div className="flex items-center gap-1.5">
                <h1 className="truncate text-section font-semibold">{creator.name}</h1>
                {creator.verified && <VerifiedMark className="size-4 shrink-0" />}
              </div>
              <p className="mt-0.5 truncate text-meta text-white/80">
                {formatCount(creator.followers)} 팔로워 · @{creator.handle}
              </p>
            </div>
            {!data ? null : isOwner ? (
              <ButtonLink href="/studio" variant="light" size="sm" className="mb-0.5">
                Studio
              </ButtonLink>
            ) : tier && tier !== "follow" ? (
              <SubscriptionBadge tier={tier} className="mb-1" />
            ) : (
              <FollowButton creatorId={creator.id} tier={tier} variant="light" size="sm" className="mb-0.5 w-[84px]" />
            )}
          </div>
        </Photo>
        <TopBar tone="overlay" backHref={initialTab === "today" ? "/today" : "/discover"} />
      </div>

      <CreatorTabs
        initial={initialTab}
        panels={{
          today: data ? <TodayPanel creator={creator} tier={tier} moments={moments} isOwner={isOwner} /> : pending,
          archive: data ? <ArchivePanel dailies={data.dailies} /> : pending,
          intro: data ? <IntroPanel creator={creator} tier={tier} isOwner={isOwner} /> : pending,
        }}
      />
    </main>
  );
}

function TodayPanel({ creator, tier, moments, isOwner }: { creator: Creator; tier?: Tier; moments: Moment[]; isOwner: boolean }) {
  const lockedCount = isOwner ? 0 : moments.filter((m) => isMomentLocked(m, tier)).length;
  const givenName = shortName(creator.name);

  return (
    <section className="px-5 pt-5">
      <p className="text-meta text-muted">{formatDate(kstDate(), false)} (오늘)</p>
      {moments.length ? (
        <>
          <p className="mt-0.5 text-meta font-semibold tracking-[0.12em] text-brand">
            TODAY · {moments.length} {moments.length === 1 ? "MOMENT" : "MOMENTS"}
          </p>
          <div className="mt-5">
            <MomentTimeline moments={moments} tier={tier} isOwner={isOwner} endNote="오늘이 지나면 이 하루는 아카이브에 남아요" />
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center py-14 text-center">
          <Moon className="size-6 text-faint" />
          <p className="mt-3 text-sub font-semibold">아직 오늘의 Moment가 없어요.</p>
          <p className="mt-1 text-caption text-muted">
            {isOwner ? "기록하고 싶은 순간이 오면, 그때 남겨도 충분해요." : `${josa(givenName, "이", "가")} 순간을 남기면 이곳에 차례로 쌓여요.`}
          </p>
        </div>
      )}

      {lockedCount > 0 && (
        <Link
          href={`/subscribe/${creator.id}`}
          className="pressable mt-6 flex items-center justify-between rounded-tile bg-brand-tint px-4 py-3 text-caption"
        >
          <span className="text-ink-2">
            {lockedCount}개의 순간은 {tier && tier !== "follow" ? "상위 플랜" : "구독자"}에게만 공개돼요
          </span>
          <span className="flex shrink-0 items-center font-semibold text-brand">
            플랜 보기
            <ChevronRight className="size-4" />
          </span>
        </Link>
      )}

      {/* Creator AI는 하루 다음에, 조용하게 (v0.5에서 연다) */}
      {FEATURES.creatorAI && moments.length > 0 && canChat(tier) && (
        <Link
          href={`/chat/${creator.id}`}
          className="mt-8 flex items-center justify-between border-t border-line py-4 text-caption text-muted hover:text-ink"
        >
          <span>오늘의 {givenName}에 대해 AI와 이야기하기</span>
          <ChevronRight className="size-4" />
        </Link>
      )}
    </section>
  );
}

function ArchivePanel({ dailies }: { dailies: DailyRecord[] }) {
  if (!dailies.length) return <p className="px-5 py-14 text-center text-caption text-muted">아직 지난 하루가 없어요.</p>;
  return (
    <section className="grid grid-cols-2 gap-2.5 px-5 pt-5">
      {dailies.map((d) => (
        <Link key={d.id} href={`/moments/${d.firstMomentId}`} className="pressable block">
          <DailyCard daily={d} caption={d.highlight} />
        </Link>
      ))}
    </section>
  );
}

function IntroPanel({ creator, tier, isOwner }: { creator: Creator; tier?: Tier; isOwner: boolean }) {
  return (
    <section className="px-5 pt-5">
      {creator.bio ? <p className="text-body text-ink-2">{creator.bio}</p> : <p className="text-body text-muted">아직 소개가 없어요.</p>}
      <p className="mt-3 text-caption text-muted">
        <span className="font-medium text-brand">{CATEGORY_LABEL[creator.category]}</span>
        {creator.tags.map((t) => ` · #${t}`)}
      </p>

      <dl className="mt-5 grid grid-cols-2 gap-2.5">
        <div className="rounded-tile bg-surface px-4 py-3 ring-1 ring-line ring-inset">
          <dt className="text-meta text-muted">팔로워</dt>
          <dd className="mt-0.5 text-name font-semibold tabular-nums">{formatCount(creator.followers)}</dd>
        </div>
        <div className="rounded-tile bg-surface px-4 py-3 ring-1 ring-line ring-inset">
          <dt className="text-meta text-muted">구독자</dt>
          <dd className="mt-0.5 text-name font-semibold tabular-nums">{formatCount(creator.subscribers)}</dd>
        </div>
      </dl>

      <div className="mt-5 flex gap-2">
        {isOwner ? (
          <ButtonLink href="/studio/settings/profile" variant="secondary" block>
            프로필 편집
          </ButtonLink>
        ) : tier && tier !== "follow" ? (
          <ButtonLink href={`/creators/${creator.id}/today`} variant="secondary" block>
            오늘의 하루 보기
          </ButtonLink>
        ) : (
          <>
            <FollowButton creatorId={creator.id} tier={tier} variant="primary" className="flex-1" />
            <ButtonLink href={`/subscribe/${creator.id}`} variant="secondary">
              구독 플랜
            </ButtonLink>
          </>
        )}
      </div>
    </section>
  );
}
