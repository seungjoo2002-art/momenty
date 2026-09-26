"use client";

import { Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { CreatorCard } from "@/components/creator/CreatorCard";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { Avatar } from "@/components/ui/Avatar";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { Chip, EmptyState, SectionHeader } from "@/components/ui/primitives";
import { CATEGORY_LABEL } from "@/lib/constants";
import type { CategoryKey, Creator, Moment } from "@/lib/types";

interface Props {
  creators: Creator[];
  counts: Record<string, number>;
  latest: Moment[];
}

export function DiscoverView({ creators, counts, latest }: Props) {
  const [category, setCategory] = useState<CategoryKey | "all">("all");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim();
    return creators.filter(
      (c) =>
        (category === "all" || c.category === category) &&
        (!q || c.name.includes(q) || c.job.includes(q) || c.tags.some((t) => t.includes(q))),
    );
  }, [creators, category, query]);

  const creatorOf = (id: string) => creators.find((c) => c.id === id)!;

  return (
    <main className="animate-fade-in">
      <header className="px-5 pt-5">
        <h1 className="text-title font-bold">Discover</h1>
        <label className="mt-3 flex h-11 items-center gap-2 rounded-full bg-surface px-4 ring-1 ring-line ring-inset focus-within:ring-brand/50">
          <Search className="size-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름, 직업, 관심사로 찾기"
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
              return (
                <Link key={m.id} href={`/moments/${m.id}`} className="pressable relative block w-[132px] shrink-0 overflow-hidden rounded-card">
                  <MomentMedia moment={m} variant="portrait" className="rounded-none" />
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-2.5 pt-8 pb-2.5 text-white">
                    <div className="flex items-center gap-1.5">
                      <Avatar src={c.avatarUrl} name={c.name} size="xs" className="ring-1 ring-white/70" />
                      <span className="truncate text-meta font-semibold">{c.name.slice(1)}</span>
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
        <SectionHeader title={category === "all" ? "추천 크리에이터" : `${CATEGORY_LABEL[category]} 크리에이터`} />
        {filtered.length ? (
          <div className="grid grid-cols-2 gap-2.5 px-5">
            {filtered.map((c) => (
              <CreatorCard key={c.id} creator={c} todayCount={counts[c.id]} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Search className="size-5" />} title="찾는 크리에이터가 없어요" description="다른 키워드로 검색해 보세요." />
        )}
      </section>
    </main>
  );
}
