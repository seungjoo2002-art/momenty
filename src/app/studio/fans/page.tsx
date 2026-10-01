"use client";

import { ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { SubscriptionBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { planLabel } from "@/lib/constants";
import { fanFacts, signalReasons } from "@/lib/fanSignals";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getAttentionFans, getFansByTier, getTierCounts, type FanPage, type ManagedFan } from "@/lib/services/fanManager";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";

/**
 * Fan Manager — 팬 관계를 돌보는 화면. 점수 · 순위 · 추정은 없다.
 * 위: 구독 플랜별 탭 (전체 · 무료 · 구독 · Premium — 등급 목록 · 개수는 DB가 준다. 등급이 늘면 탭도 는다).
 * "오늘 확인할 팬"은 규칙(답장 대기 · 공유한 날 · 새 구독 · 최근 반응 · 오랜 공백 · 첫 대화 전)에 걸린 팬과 그 이유를 그대로 보여준다.
 * 데이터: fan_manager_* (safe projection) — Fan Memory · 안내 확인 전 AI 대화는 포함되지 않는다.
 */
export default function FansPage() {
  const creator = useStudioCreator();
  const [nowMs] = useState(() => Date.now());
  const [tier, setTier] = useState<string | null>(null);
  const counts = useMomentData(`fan-tiers:${creator.id}`, getTierCounts);
  const attention = useMomentData(`fan-attention:${creator.id}`, () => getAttentionFans(12));
  const list = useMomentData(`fan-list:${creator.id}:${tier ?? "all"}`, () => getFansByTier(tier, null, 30));
  const [more, setMore] = useState<{ key: string; items: ManagedFan[]; cursor: FanPage["nextCursor"] | undefined }>({ key: "", items: [], cursor: undefined });
  const [loadingMore, setLoadingMore] = useState(false);
  const listKey = tier ?? "all";
  const extra = more.key === listKey ? more : { key: listKey, items: [], cursor: undefined };
  const cursor = extra.cursor === undefined ? list.data?.nextCursor : extra.cursor;
  const fans = [...(list.data?.items ?? []), ...extra.items];
  const total = (counts.data ?? []).reduce((n, c) => n + c.count, 0);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await getFansByTier(tier, cursor, 30);
      setMore({ key: listKey, items: [...extra.items, ...page.items], cursor: page.nextCursor });
    } finally {
      setLoadingMore(false);
    }
  }

  const tabs = [{ tier: null as string | null, label: "전체", count: total }, ...(counts.data ?? []).map((c) => ({ tier: c.tier as string | null, label: planLabel(c.tier), count: c.count }))];

  return (
    <main className="animate-fade-in pb-10">
      <PageHeader title="Fans" caption={`팔로워 ${formatCount(creator.followers)} · 구독자 ${formatCount(creator.subscribers)}`} />

      <div role="tablist" aria-label="구독 플랜" className="no-scrollbar flex gap-1.5 overflow-x-auto px-5">
        {tabs.map((t) => {
          const active = tier === t.tier;
          return (
            <button
              key={t.label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTier(t.tier)}
              className={cn(
                "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-caption font-medium whitespace-nowrap",
                active ? "bg-ink text-white" : "border border-line-strong bg-surface text-ink-2",
              )}
            >
              {t.label}
              <span className={cn("tabular-nums", active ? "text-white/80" : "text-muted")}>{counts.data ? formatCount(t.count) : "·"}</span>
            </button>
          );
        })}
      </div>
      {counts.error && !counts.data && <LoadError message={counts.error} onRetry={counts.retry} className="py-4" />}

      {tier === null && (
        <section className="mt-6">
          <SectionHeader title="오늘 확인할 팬" />
          {!attention.data ? (
            attention.error ? <LoadError message={attention.error} onRetry={attention.retry} className="py-4" /> : <LoadingBlock />
          ) : attention.data.length === 0 ? (
            <p className="px-5 text-sub text-muted">지금 따로 확인할 팬이 없어요.</p>
          ) : (
            <ul className="divide-y divide-line border-y border-line">
              {attention.data.map((f) => (
                <li key={f.fanId}>
                  <Link href={`/studio/fans/${f.fanId}`} className="flex items-start gap-3 px-5 py-3.5 active:bg-brand-tint" aria-label={`${f.nickname} 팬 보기`}>
                    <Avatar src={f.avatarUrl || undefined} name={f.nickname} size="md" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sub font-semibold">{f.nickname}</span>
                        {f.tier && <SubscriptionBadge tier={f.tier} />}
                        {f.subscribedDays != null && <span className="ml-auto shrink-0 text-meta text-faint">구독 {f.subscribedDays}일</span>}
                      </div>
                      <ul className="mt-1 space-y-0.5">
                        {signalReasons(f, nowMs)
                          .slice(0, 2)
                          .map((r) => (
                            <li key={r} className="text-caption leading-relaxed text-ink-2">
                              {r}
                            </li>
                          ))}
                      </ul>
                      <span className="mt-1.5 inline-flex items-center text-meta font-medium text-brand">
                        팬 보기 <ChevronRight className="size-3.5" />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-8">
        <SectionHeader title={tier === null ? "모든 팬" : `${planLabel(tier)} 팬`} caption="구독 시작 최신순" />
        {!list.data ? (
          list.error ? <LoadError message={list.error} onRetry={list.retry} className="py-4" /> : <LoadingBlock />
        ) : fans.length === 0 ? (
          <EmptyState
            icon={<Users className="size-5" />}
            title={tier === null ? "아직 팬이 없어요" : `${planLabel(tier)} 플랜 팬이 없어요`}
            description={tier === null ? "순간을 남기면, 그 하루를 따라올 사람들이 생길 거예요." : undefined}
          />
        ) : (
          <ul>
            {fans.map((f) => (
              <li key={f.fanId}>
                <Link href={`/studio/fans/${f.fanId}`} className="flex items-center gap-3 px-5 py-2.5 active:bg-brand-tint">
                  <Avatar src={f.avatarUrl || undefined} name={f.nickname} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sub font-semibold">
                      {f.nickname}
                      {f.blocked && <span className="ml-1.5 text-meta font-normal text-danger">차단함</span>}
                    </p>
                    <p className="truncate text-meta text-muted">{fanFacts(f, nowMs)}</p>
                  </div>
                  {f.tier && <SubscriptionBadge tier={f.tier} />}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {cursor && (
          <button type="button" onClick={loadMore} disabled={loadingMore} className="mx-auto mt-3 block text-caption font-medium text-muted disabled:opacity-50">
            {loadingMore ? "불러오는 중…" : "더 보기"}
          </button>
        )}
      </section>

      <p className="mx-8 mt-8 break-keep text-center text-meta leading-relaxed text-faint">
        구독 · 반응 · 대화처럼 실제로 있었던 일만 보여줘요. AI Memory는 팬만 볼 수 있고, AI Avatar 대화는 팬이 열람 안내를 확인한 뒤의 것만 보여요.
      </p>
    </main>
  );
}
