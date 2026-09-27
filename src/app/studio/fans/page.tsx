"use client";

import { Users } from "lucide-react";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { SubscriptionBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError } from "@/components/ui/LoadState";
import { EmptyState, PageHeader, Segmented } from "@/components/ui/primitives";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getMyFollowers } from "@/lib/services/studio";
import type { Tier } from "@/lib/types";
import { formatCount, formatShortDate } from "@/lib/utils/format";

type Filter = "all" | Tier;

/** 내 채널의 실제 팔로워 · 구독자 (subscriptions — 크리에이터는 자기 채널 관계만 볼 수 있다) */
export default function FansPage() {
  const creator = useStudioCreator();
  const [filter, setFilter] = useState<Filter>("all");
  const { data: fans, error, retry } = useMomentData(`fans:${creator.id}`, () => getMyFollowers(creator.id));
  const list = (fans ?? []).filter((f) => filter === "all" || f.tier === filter);
  // 목록에서 바로 센다 (로그인 때 읽은 숫자보다 최신)
  const followers = fans?.length ?? creator.followers;
  const subscribers = fans ? fans.filter((f) => f.tier !== "follow").length : creator.subscribers;

  return (
    <main className="animate-fade-in">
      <PageHeader title="Fans" caption={`팔로워 ${formatCount(followers)} · 구독자 ${formatCount(subscribers)}`} />
      <div className="px-5">
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "전체" },
            { value: "follow", label: "팔로우" },
            { value: "subscriber", label: "구독" },
            { value: "premium", label: "Premium" },
          ]}
        />
      </div>

      {fans === undefined ? (
        error && <LoadError message={error} onRetry={retry} />
      ) : list.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title={fans.length ? "이 조건의 팬이 없어요" : "아직 팬이 없어요"}
          description={fans.length ? undefined : "순간을 남기면, 그 하루를 따라올 사람들이 생길 거예요."}
        />
      ) : (
        <ul className="mt-3">
          {list.map((f) => (
            <li key={f.id} className="flex items-center gap-3 px-5 py-2.5">
              <Avatar src={f.avatarUrl || undefined} name={f.nickname} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sub font-semibold">{f.nickname}</p>
                <p className="text-meta text-muted">{formatShortDate(f.since.slice(0, 10))}부터</p>
              </div>
              <SubscriptionBadge tier={f.tier} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
