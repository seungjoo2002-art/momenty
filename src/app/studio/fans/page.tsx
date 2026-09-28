"use client";

import { ChevronRight, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { SubscriptionBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { fanFacts, signalReasons } from "@/lib/fanSignals";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getAllFans, getAttentionFans, type FanPage, type ManagedFan } from "@/lib/services/fanManager";
import { formatCount } from "@/lib/utils/format";

/**
 * Fan Manager — 팬 관계를 돌보는 화면. 점수 · 순위 · 추정은 없다.
 * "오늘 확인할 팬"은 규칙(답장 대기 · 공유한 날 · 새 구독 · 최근 반응 · 오랜 공백 · 첫 대화 전)에 걸린 팬과 그 이유를 그대로 보여준다.
 * 데이터: fan_manager_list(safe projection) — AI 대화 · Fan Memory는 포함되지 않는다.
 */
export default function FansPage() {
  const creator = useStudioCreator();
  const [nowMs] = useState(() => Date.now());
  const { data, error, retry } = useMomentData(`fan-manager:${creator.id}`, async () => {
    const [attention, all] = await Promise.all([getAttentionFans(12), getAllFans(null, 30)]);
    return { attention, all };
  });
  const [more, setMore] = useState<{ items: ManagedFan[]; cursor: FanPage["nextCursor"] | undefined }>({ items: [], cursor: undefined });
  const [loadingMore, setLoadingMore] = useState(false);
  const cursor = more.cursor === undefined ? data?.all.nextCursor : more.cursor;
  const allFans = [...(data?.all.items ?? []), ...more.items];

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const page = await getAllFans(cursor, 30);
      setMore((m) => ({ items: [...m.items, ...page.items], cursor: page.nextCursor }));
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="animate-fade-in pb-10">
      <PageHeader title="Fans" caption={`팔로워 ${formatCount(creator.followers)} · 구독자 ${formatCount(creator.subscribers)}`} />

      {error && !data && <LoadError message={error} onRetry={retry} />}
      {!data && !error && <LoadingBlock />}

      {data && (
        <>
          <section>
            <SectionHeader title="오늘 확인할 팬" />
            {data.attention.length === 0 ? (
              <p className="px-5 text-sub text-muted">지금 따로 확인할 팬이 없어요.</p>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {data.attention.map((f) => (
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

          <section className="mt-8">
            <SectionHeader title="구독 중인 팬" />
            {allFans.length === 0 ? (
              <EmptyState icon={<Users className="size-5" />} title="아직 구독 중인 팬이 없어요" description="순간을 남기면, 그 하루를 따라올 사람들이 생길 거예요." />
            ) : (
              <ul>
                {allFans.map((f) => (
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
            구독 · 반응 · 직접 대화처럼 실제로 있었던 일만 보여줘요. 팬의 Creator AI 대화와 AI Memory는 팬만 볼 수 있어요.
          </p>
        </>
      )}
    </main>
  );
}
