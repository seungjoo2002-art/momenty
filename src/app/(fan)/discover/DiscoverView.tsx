"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useAccount } from "@/components/auth/AuthProvider";
import { CreatorCard } from "@/components/creator/CreatorCard";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { Avatar } from "@/components/ui/Avatar";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Chip, EmptyState, SectionHeader } from "@/components/ui/primitives";
import { CATEGORY_LABEL } from "@/lib/constants";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getMyBlockedUserIds } from "@/lib/services/safety";
import type { CategoryKey, Creator, Moment } from "@/lib/types";
import { shortName } from "@/lib/utils/format";

interface Props {
  creators: Creator[];
  counts: Record<string, number>;
  latest: Moment[];
}

export function DiscoverView({ creators: allCreators, counts, latest: allLatest }: Props) {
  const [category, setCategory] = useState<CategoryKey | "all">("all");
  const [query, setQuery] = useState("");
  const account = useAccount();
  // 내가 차단한 크리에이터는 목록 · 최근 Moment에서 숨긴다 (목록은 공개 데이터 — 차단은 로그인한 내 것만 알 수 있다)
  const { data: blocked } = useMomentData(`blocked:${account?.userId ?? ""}`, getMyBlockedUserIds);
  const creators = useMemo(() => allCreators.filter((c) => !blocked?.has(c.profileId)), [allCreators, blocked]);
  const latest = useMemo(() => {
    const visible = new Set(creators.map((c) => c.id));
    return allLatest.filter((m) => visible.has(m.creatorId));
  }, [allLatest, creators]);
  const interests = useMemo(() => account?.interests ?? [], [account]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = creators.filter(
      (c) =>
        c.id !== account?.creator?.id &&
        (category === "all" || c.category === category) &&
        (!q ||
          c.name.toLowerCase().includes(q) ||
          c.handle.includes(q) ||
          c.job.includes(q) ||
          c.tags.some((t) => t.includes(q))),
    );
    // 가입할 때 고른 관심 분야의 크리에이터가 먼저
    return interests.length ? [...list].sort((a, b) => Number(interests.includes(b.category)) - Number(interests.includes(a.category))) : list;
  }, [creators, category, query, interests, account]);

  const creatorOf = (id: string) => creators.find((c) => c.id === id);

  return (
    <main className="animate-fade-in">
      <header className="px-5 pt-5">
        <h1 className="text-title font-bold">Discover</h1>
        <label className="mt-3 flex h-11 items-center gap-2 rounded-full bg-surface px-4 ring-1 ring-line ring-inset focus-within:ring-brand/50">
          <Search className="size-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름, 사용자 이름, 관심사로 찾기"
            className="min-w-0 flex-1 bg-transparent text-sub outline-none placeholder:text-faint"
          />
        </label>
      </header>

      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto px-5">
        <Chip active={category === "all"} onClick={() => setCategory("all")}>
          전체
        </Chip>
        {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((k) => (
          <Chip key={k} active={category === k} onClick={() => setCategory(k)}>
            {CATEGORY_LABEL[k]}
          </Chip>
        ))}
      </div>

      {category === "all" && !query && latest.length > 0 && (
        <section className="mt-6">
          <SectionHeader title="방금 기록된 순간" />
          <div className="no-scrollbar flex gap-2.5 overflow-x-auto px-5">
            {latest.map((m) => {
              const c = creatorOf(m.creatorId);
              if (!c) return null;
              return (
                <Link key={m.id} href={`/moments/${m.id}`} className="pressable relative block w-[132px] shrink-0 overflow-hidden rounded-card">
                  <MomentMedia moment={m} variant="portrait" className="rounded-none" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-2.5 pt-8 pb-2.5 text-white">
                    <div className="flex items-center gap-1.5">
                      <Avatar src={c.avatarUrl} name={c.name} size="xs" className="ring-1 ring-white/70" />
                      <span className="truncate text-meta font-semibold">{shortName(c.name)}</span>
                    </div>
                    <span className="mt-0.5 block text-micro text-white/75">
                      <RelativeTime iso={m.createdAt} />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <section className="mt-7">
        {/* 추천 알고리즘이 아니다: 등록된 크리에이터 전체 (고른 관심 분야가 먼저) */}
        <SectionHeader
          title={category === "all" ? "크리에이터" : `${CATEGORY_LABEL[category]} 크리에이터`}
          caption={category === "all" && interests.length ? "관심 분야를 먼저 보여드려요" : undefined}
        />
        {filtered.length ? (
          <div className="grid grid-cols-2 gap-2.5 px-5">
            {filtered.map((c) => (
              <CreatorCard key={c.id} creator={c} todayCount={counts[c.id]} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Search className="size-5" />}
            title={creators.length ? "찾는 크리에이터가 없어요" : "아직 크리에이터가 없어요"}
            description={creators.length ? "다른 키워드로 검색해 보세요." : "첫 크리에이터가 하루를 남기면 이곳에서 만날 수 있어요."}
          />
        )}
      </section>
    </main>
  );
}
