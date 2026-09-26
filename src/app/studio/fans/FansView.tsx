"use client";

import { Cake, MessageCircleHeart, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { AIBadge, SubscriptionBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { Chip, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/RelativeTime";
import type { Creator, FanProfile, Tier } from "@/lib/types";
import { formatCount, formatShortDate } from "@/lib/utils/format";

const FILTERS: { key: Tier | "all"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "premium", label: "Premium" },
  { key: "subscriber", label: "구독자" },
  { key: "follow", label: "팔로워" },
];

interface Props {
  creator: Creator;
  fans: FanProfile[];
  fanBrief: string;
  newSubscribersToday: number;
}

/**
 * Fan Manager 대시보드.
 * "직접 확인 추천"은 사실 기반 이유(답장 대기, 기념일)만 보여준다.
 * 팬을 점수로 줄 세우거나 취약성을 평가하지 않는다.
 */
export function FansView({ creator, fans, fanBrief, newSubscribersToday }: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const recommended = fans.filter((f) => f.recommendReason);
  const birthdays = fans.filter((f) => f.birthdayToday);
  const list = fans.filter((f) => filter === "all" || f.tier === filter);

  return (
    <main className="animate-fade-in">
      <PageHeader
        title="Fans"
        caption={`팔로워 ${formatCount(creator.followers)} · 구독자 ${formatCount(creator.subscribers)}`}
      />

      {/* 오늘의 Fan Briefing */}
      <section className="mx-5 rounded-card border border-brand/10 bg-brand-tint p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-name font-semibold">오늘의 Fan Briefing</h2>
          <AIBadge label="AI 요약" />
        </div>
        <p className="mt-2 text-sub text-ink-2">{fanBrief}</p>
      </section>

      <div className="mt-3 grid grid-cols-3 gap-2 px-5">
        {[
          { label: "신규 구독", value: `+${newSubscribersToday}` },
          { label: "직접 확인 추천", value: `${recommended.length}명` },
          { label: "오늘 생일", value: `${birthdays.length}명` },
        ].map((s) => (
          <div key={s.label} className="rounded-tile border border-line bg-surface px-3 py-2.5">
            <p className="text-micro text-muted">{s.label}</p>
            <p className="mt-0.5 text-name font-semibold tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* 직접 확인 추천 */}
      {recommended.length > 0 && (
        <section className="pt-7">
          <SectionHeader title="직접 확인 추천" caption="AI가 아닌 나의 한마디가 닿으면 좋은 순간" />
          <ul className="px-5 [&>li+li]:border-t [&>li+li]:border-line">
            {recommended.map((f) => (
              <li key={f.id} className="flex items-center gap-3 py-3">
                <Avatar src={f.avatarUrl} name={f.nickname} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sub font-semibold">{f.nickname}</span>
                    <SubscriptionBadge tier={f.tier} />
                    {f.birthdayToday && <Cake className="size-3.5 shrink-0 text-brand" aria-label="오늘 생일" />}
                  </div>
                  <p className="text-meta text-muted">{formatShortDate(f.since)}부터 함께</p>
                  <p className="mt-0.5 truncate text-meta text-brand-deep">{f.recommendReason}</p>
                </div>
                <ButtonLink href={`/studio/fans/${f.id}`} variant="soft" size="sm">
                  대화 보기
                </ButtonLink>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 전체 팬 */}
      <section className="pt-6">
        <SectionHeader title="전체 팬" />
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto px-5">
          {FILTERS.map((f) => (
            <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
        </div>
        <ul className="mt-2">
          {list.map((f) => (
            <li key={f.id}>
              <Link href={`/studio/fans/${f.id}`} className="flex items-center gap-3 px-5 py-2.5 active:bg-brand-tint">
                <Avatar src={f.avatarUrl} name={f.nickname} size="md" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sub font-medium">{f.nickname}</span>
                    <SubscriptionBadge tier={f.tier} />
                  </div>
                  <p className="truncate text-meta text-muted">{f.memorySummary}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-micro text-faint">
                    <RelativeTime iso={f.lastActiveAt} />
                  </span>
                  {f.pendingMessage && <MessageCircleHeart className="size-4 text-brand" aria-label="답장 대기" />}
                  {f.status === "restricted" && <ShieldAlert className="size-4 text-danger" aria-label="제한됨" />}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
