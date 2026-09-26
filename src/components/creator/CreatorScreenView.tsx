"use client";

import { ChevronRight, Moon } from "lucide-react";
import Link from "next/link";
import { SubscriptionBadge, VerifiedMark } from "@/components/badges";
import { DailyCard } from "@/components/moment/DailyCard";
import { MomentTimeline } from "@/components/moment/MomentTimeline";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { Photo } from "@/components/ui/Photo";
import { TopBar } from "@/components/ui/TopBar";
import { CATEGORY_LABEL } from "@/lib/constants";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getCurrentFan } from "@/lib/services/fan";
import { getDailyRecords, getTodayMoments } from "@/lib/services/moments";
import type { Creator, DailyRecord, Moment, Tier } from "@/lib/types";
import { canChat, isMomentLocked, tierFor } from "@/lib/utils/access";
import { formatCount, formatDate, formatPrice, josa, kstDate } from "@/lib/utils/format";
import { CreatorTabs, type CreatorTab } from "./CreatorTabs";
import { FollowButton } from "./FollowButton";

/**
 * 크리에이터 화면 본문. 오늘의 Moment · 지난 하루는 저장소에서 불러오고,
 * 새 Moment가 공개되면 Timeline에 바로 이어 붙는다.
 */
export function CreatorScreenView({ creator, initialTab }: { creator: Creator; initialTab: CreatorTab }) {
  const { data, error, retry } = useMomentData(`creator:${creator.id}`, async () => {
    const fan = await getCurrentFan();
    const [moments, dailies] = await Promise.all([getTodayMoments(creator.id), getDailyRecords(creator.id, fan)]);
    return { moments, dailies, tier: tierFor(fan, creator.id) };
  });
  const moments = data?.moments ?? [];
  const tier = data?.tier;
  const pending = error ? <LoadError message={error} onRetry={retry} /> : <LoadingBlock />;

  return (
    <main className="animate-fade-in">
      {/* Cover */}
      <div className="relative">
        <Photo src={creator.coverUrl} alt={creator.name} className="aspect-[16/11]">
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/65" />
          <div className="absolute inset-x-5 bottom-4 flex items-end gap-3 text-white">
            <Avatar src={creator.avatarUrl} name={creator.name} size="lg" ring={moments.length ? "today" : "none"} />
            <div className="min-w-0 flex-1 pb-0.5">
              <div className="flex items-center gap-1.5">
                <h1 className="truncate text-section font-semibold">{creator.name}</h1>
                {creator.verified && <VerifiedMark className="size-4 shrink-0" />}
              </div>
              <p className="mt-0.5 truncate text-meta text-white/80">
                {formatCount(creator.followers)} 팔로워 · {creator.job}
              </p>
            </div>
            {!data ? null : tier && tier !== "follow" ? (
              <SubscriptionBadge tier={tier} className="mb-1" />
            ) : (
              <ButtonLink href={`/subscribe/${creator.id}`} variant="light" size="sm" className="mb-0.5">
                구독하기
              </ButtonLink>
            )}
          </div>
        </Photo>
        <TopBar tone="overlay" backHref={initialTab === "today" ? "/today" : "/discover"} />
      </div>

      <CreatorTabs
        initial={initialTab}
        panels={{
          today: data ? <TodayPanel creator={creator} tier={tier} moments={moments} /> : pending,
          archive: data ? <ArchivePanel dailies={data.dailies} /> : pending,
          intro: data ? <IntroPanel creator={creator} tier={tier} /> : pending,
        }}
      />
    </main>
  );
}

function TodayPanel({ creator, tier, moments }: { creator: Creator; tier?: Tier; moments: Moment[] }) {
  const lockedCount = moments.filter((m) => isMomentLocked(m, tier)).length;
  const givenName = creator.name.slice(1);

  return (
    <section className="px-5 pt-5">
      <p className="text-meta text-muted">{formatDate(kstDate(), false)} (오늘)</p>
      {moments.length ? (
        <>
          <p className="mt-0.5 text-section font-semibold">{moments.length}개의 순간</p>
          <div className="mt-5">
            <MomentTimeline moments={moments} tier={tier} endNote="오늘이 지나면 이 하루는 아카이브에 남아요" />
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center py-14 text-center">
          <Moon className="size-6 text-faint" />
          <p className="mt-3 text-sub font-semibold">오늘은 아직 조용해요</p>
          <p className="mt-1 text-caption text-muted">{josa(givenName, "이", "가")} 순간을 남기면 이곳에 차례로 쌓여요.</p>
        </div>
      )}

      {lockedCount > 0 && (
        <Link
          href={`/subscribe/${creator.id}`}
          className="pressable mt-6 flex items-center justify-between rounded-tile bg-brand-tint px-4 py-3 text-caption"
        >
          <span className="text-ink-2">
            {lockedCount}개의 순간은 {tier ? "상위 플랜" : "구독자"}에게만 공개돼요
          </span>
          <span className="flex shrink-0 items-center font-semibold text-brand">
            플랜 보기
            <ChevronRight className="size-4" />
          </span>
        </Link>
      )}

      {/* Creator AI는 하루 다음에, 조용하게 */}
      {moments.length > 0 && canChat(tier) && (
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

function IntroPanel({ creator, tier }: { creator: Creator; tier?: Tier }) {
  return (
    <section className="px-5 pt-5">
      <p className="text-body text-ink-2">{creator.bio}</p>
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
        {canChat(tier) ? (
          <ButtonLink href={`/chat/${creator.id}`} variant="secondary" block>
            {creator.name.slice(1)} AI와 대화하기
          </ButtonLink>
        ) : (
          <>
            <ButtonLink href={`/subscribe/${creator.id}`} className="flex-1">
              구독하기 · {formatPrice(creator.pricing.subscriber)}/월
            </ButtonLink>
            <FollowButton initialFollowing={tier === "follow"} />
          </>
        )}
      </div>
    </section>
  );
}
