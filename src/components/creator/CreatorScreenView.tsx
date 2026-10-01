"use client";

import { ChevronRight, Moon } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { useAccount } from "@/components/auth/AuthProvider";
import { SubscriptionBadge, VerifiedMark } from "@/components/badges";
import { DailyCard } from "@/components/moment/DailyCard";
import { MomentTimeline } from "@/components/moment/MomentTimeline";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { Photo } from "@/components/ui/Photo";
import { TopBar } from "@/components/ui/TopBar";
import { CATEGORY_LABEL, FEATURES, planLabel } from "@/lib/constants";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getCreator } from "@/lib/services/creators";
import { getCurrentFan } from "@/lib/services/fan";
import { getDailyRecords, getTodayMoments } from "@/lib/services/moments";
import type { Creator, DailyRecord, Moment, Tier } from "@/lib/types";
import { canChat, isMomentLocked, tierFor } from "@/lib/utils/access";
import { formatCount, formatDate, formatPrice, josa, kstDate, shortName } from "@/lib/utils/format";
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
  const [tab, setTab] = useState<CreatorTab>(initialTab);
  const tabsRef = useRef<HTMLDivElement>(null);
  const detail = [creator.job, CATEGORY_LABEL[creator.category]].filter(Boolean).join(" · ");

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
              <FollowButton creatorId={creator.id} tier={tier} variant="light" size="sm" className="mb-0.5" />
            )}
          </div>
        </Photo>
        <TopBar tone="overlay" backHref={initialTab === "today" ? "/today" : "/discover"} />
      </div>

      {/* 직업 · 분야 · 소개 미리보기 — 전체는 소개 탭에서 */}
      <section className="px-5 pt-3.5">
        {detail && <p className="text-caption break-words text-ink-2">{detail}</p>}
        {creator.bio && <p className="mt-1 line-clamp-2 text-caption leading-relaxed break-words whitespace-pre-line text-muted">{creator.bio}</p>}
        <button
          type="button"
          onClick={() => {
            setTab("intro");
            tabsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
          }}
          className="mt-1 inline-flex h-8 items-center gap-0.5 text-meta text-muted hover:text-ink"
        >
          소개 더보기
          <ChevronRight className="size-3.5" />
        </button>
      </section>

      <div ref={tabsRef} />
      <CreatorTabs
        initial={initialTab}
        tab={tab}
        onTabChange={setTab}
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
      {FEATURES.creatorAI && !isOwner && creator.personaEnabled && canChat(tier) && (
        <Link
          href={`/chat/${creator.id}`}
          className="mt-8 flex items-center justify-between border-t border-line py-4 text-caption text-muted hover:text-ink"
        >
          <span>🤖 {creator.name} 공식 AI Avatar와 이야기하기</span>
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

/**
 * 소개 — 크리에이터가 가입할 때 적은 정보(활동명 · 아이디 · 직업/활동 분야 · 소개)와 구독 플랜 · AI Avatar 여부.
 * 비어 있는 칸은 채워 넣은 문장 대신 조용한 빈 상태로 둔다.
 */
function IntroPanel({ creator, tier, isOwner }: { creator: Creator; tier?: Tier; isOwner: boolean }) {
  const plans: { tier: Tier; price: number }[] = [
    { tier: "follow", price: 0 },
    { tier: "subscriber", price: creator.pricing.subscriber },
    { tier: "premium", price: creator.pricing.premium },
  ];
  return (
    <section className="px-5 pt-5">
      <div className="min-w-0">
        <p className="text-name font-semibold break-words">{creator.name}</p>
        <p className="mt-0.5 text-caption break-all text-muted">@{creator.handle}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {creator.job && <span className="max-w-full rounded-full bg-brand-tint px-2.5 py-1 text-meta font-medium break-words text-brand-deep">{creator.job}</span>}
          <span className="rounded-full border border-line-strong px-2.5 py-1 text-meta text-ink-2">{CATEGORY_LABEL[creator.category]}</span>
          {creator.tags.map((t) => (
            <span key={t} className="text-meta text-muted">
              #{t}
            </span>
          ))}
        </div>
      </div>

      <h2 className="mt-6 text-meta font-semibold text-muted">소개</h2>
      {creator.bio ? (
        <p className="mt-1.5 text-body leading-relaxed break-words whitespace-pre-line text-ink-2">{creator.bio}</p>
      ) : (
        <p className="mt-1.5 rounded-tile bg-canvas px-4 py-3 text-caption text-muted">{isOwner ? "소개를 적으면 팬이 나를 더 잘 알 수 있어요." : "아직 소개를 적지 않았어요."}</p>
      )}

      {creator.personaEnabled && (
        <div className="mt-5 rounded-card border border-ai-line bg-ai-soft/50 px-4 py-3.5">
          <p className="text-sub font-semibold text-ai">🤖 공식 AI Avatar와 대화할 수 있어요</p>
          <p className="mt-1 break-keep text-caption leading-relaxed text-ink-2">
            {josa(creator.name, "이", "가")} 직접 알려 준 정보와 말투, 공개한 Moment를 바탕으로 답하는 AI예요. {creator.name} 본인이 아니에요.
          </p>
          <p className="mt-1 text-meta text-muted">구독자에게 열려 있어요.</p>
        </div>
      )}

      <h2 className="mt-6 text-meta font-semibold text-muted">구독 플랜</h2>
      <ul className="mt-1.5 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
        {plans.map((p) => (
          <li key={p.tier} className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sub font-medium">{planLabel(p.tier)}</span>
            <span className="shrink-0 text-caption text-muted">
              {p.tier === "follow" ? "무료" : !FEATURES.payments ? "결제 준비 중" : p.price ? formatPrice(p.price) : "가격 준비 중"}
              {tier === p.tier && <span className="ml-1.5 font-semibold text-brand">· 이용 중</span>}
            </span>
          </li>
        ))}
      </ul>

      {/* 모든 크리에이터에게 같은 문구 — 누가 Safe Delay를 쓰는지 · 얼마나 늦추는지는 드러내지 않는다 */}
      <p className="mt-4 break-keep text-meta text-faint">크리에이터 보호를 위해 실제 기록 시점과 공개 시점이 다를 수 있어요. Moment의 장소는 기록 당시의 장소예요.</p>

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
