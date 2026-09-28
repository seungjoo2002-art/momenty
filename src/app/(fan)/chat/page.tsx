"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useAccount } from "@/components/auth/AuthProvider";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError } from "@/components/ui/LoadState";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getAiConversations } from "@/lib/services/aiChat";
import { getCreators } from "@/lib/services/creators";
import { getCurrentFan } from "@/lib/services/fan";
import { getMyHumanConversations } from "@/lib/services/humanChat";
import { getMyBlockedUserIds } from "@/lib/services/safety";
import { canChat } from "@/lib/utils/access";

/**
 * 대화 목록 — 크리에이터마다 한 줄. Creator AI 대화(🤖)와 크리에이터 본인과의 직접 대화(✓)를 미리보기에서 분명히 구분한다.
 * (두 대화는 DB에서 따로 저장 · 권한 관리된다 — 화면만 한 줄로 모아 보여준다)
 */
export default function ChatListPage() {
  const account = useAccount();
  const { data, error, retry } = useMomentData(`chats:${account?.userId ?? ""}`, async () => {
    const [ai, human, creators, fan, blocked] = await Promise.all([getAiConversations(), getMyHumanConversations(), getCreators(), getCurrentFan(), getMyBlockedUserIds()]);
    return { ai, human, creators, fan, blocked };
  });

  if (!data) return <main className="min-h-dvh">{error && <LoadError message={error} onRetry={retry} className="pt-32" />}</main>;
  const creatorOf = (id: string) => data.creators.find((c) => c.id === id);

  type Row = { creatorId: string; at: string; preview: string; human: boolean; unread: boolean };
  const byCreator = new Map<string, Row>();
  for (const c of data.ai) {
    const m = c.lastMessage;
    byCreator.set(c.creatorId, { creatorId: c.creatorId, at: c.lastMessageAt, preview: m ? `${m.sender === "ai" ? "🤖 AI" : "나 → 🤖 AI"} · ${m.content}` : "", human: false, unread: false });
  }
  for (const h of data.human) {
    const m = h.lastMessage;
    const name = creatorOf(h.creatorId)?.name ?? "";
    const at = h.lastMessageAt ?? "";
    const prev = byCreator.get(h.creatorId);
    const humanRow: Row = { creatorId: h.creatorId, at, preview: m ? `${m.sender === "creator" ? `✓ ${name}` : `나 → ✓ ${name}`} · ${m.content}` : "", human: true, unread: h.unread };
    if (!prev || at > prev.at) byCreator.set(h.creatorId, humanRow);
    else if (h.unread) byCreator.set(h.creatorId, { ...prev, unread: true });
  }
  const rows = [...byCreator.values()].sort((a, b) => b.at.localeCompare(a.at));
  const talked = new Set(rows.map((r) => r.creatorId));
  const startable = data.fan.subscriptions
    .filter((s) => canChat(s.tier) && !talked.has(s.creatorId))
    .flatMap((s) => {
      const c = creatorOf(s.creatorId);
      // 새 대화 시작 목록에서는 차단한 크리에이터를 뺀다 (이미 있는 대화 기록은 그대로 보인다)
      return c && c.personaEnabled && !data.blocked.has(c.profileId) ? [c] : [];
    });

  return (
    <main className="animate-fade-in">
      <PageHeader title="Chat" caption="🤖 Creator AI · ✓ 크리에이터 직접 메시지" />

      {rows.length === 0 && startable.length === 0 && (
        <EmptyState icon={<Bot className="size-5" />} title="아직 대화가 없어요" description="구독 중인 크리에이터의 Creator AI와 이야기하거나, 크리에이터 본인에게 직접 메시지를 보낼 수 있어요." />
      )}

      <ul>
        {rows.map((r) => {
          const creator = creatorOf(r.creatorId);
          if (!creator) return null;
          return (
            <li key={r.creatorId}>
              <Link href={`/chat/${creator.id}${r.human ? "?mode=human" : ""}`} className="flex items-center gap-3 px-5 py-3 transition-colors active:bg-brand-tint">
                <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="lg" ring={r.human ? "human" : "ai"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sub font-semibold">{creator.name}</span>
                    {r.unread && <span className="size-2 shrink-0 rounded-full bg-brand" aria-label="새 직접 메시지" />}
                    <span className="ml-auto shrink-0 text-meta text-faint">{r.at && <RelativeTime iso={r.at} />}</span>
                  </div>
                  <p className="mt-0.5 truncate text-caption text-muted">{r.preview}</p>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {startable.length > 0 && (
        <section className="mt-6">
          <SectionHeader title="새 대화 시작하기" />
          <div className="no-scrollbar flex gap-4 overflow-x-auto px-5">
            {startable.map((creator) => (
              <Link key={creator.id} href={`/chat/${creator.id}`} className="pressable flex w-16 shrink-0 flex-col items-center">
                <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="lg" ring="ai" />
                <span className="mt-1.5 w-full truncate text-center text-meta">{creator.name}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="mx-8 mt-8 break-keep text-center text-meta text-faint">
        🤖 Creator AI는 크리에이터가 확인한 사실과 오늘 남긴 기록만 바탕으로 답하는 AI예요. ✓ 표시는 크리에이터 본인이 직접 보낸 메시지예요.
      </p>
    </main>
  );
}
