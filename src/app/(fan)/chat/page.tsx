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
import { canChat } from "@/lib/utils/access";

/** Creator AI 대화 목록 — 내 대화(팬 본인만) + 구독 중이라 새로 시작할 수 있는 크리에이터 */
export default function ChatListPage() {
  const account = useAccount();
  const { data, error, retry } = useMomentData(`ai-chats:${account?.userId ?? ""}`, async () => {
    const [convs, creators, fan] = await Promise.all([getAiConversations(), getCreators(), getCurrentFan()]);
    return { convs, creators, fan };
  });

  if (!data) return <main className="min-h-dvh">{error && <LoadError message={error} onRetry={retry} className="pt-32" />}</main>;
  const creatorOf = (id: string) => data.creators.find((c) => c.id === id);
  const talked = new Set(data.convs.map((c) => c.creatorId));
  const startable = data.fan.subscriptions
    .filter((s) => canChat(s.tier) && !talked.has(s.creatorId))
    .flatMap((s) => {
      const c = creatorOf(s.creatorId);
      return c && c.personaEnabled ? [c] : [];
    });

  return (
    <main className="animate-fade-in">
      <PageHeader title="Chat" caption="Creator AI와의 대화 · AI가 생성한 답변이에요" />

      {data.convs.length === 0 && startable.length === 0 && (
        <EmptyState
          icon={<Bot className="size-5" />}
          title="아직 대화가 없어요"
          description="구독 중인 크리에이터의 Creator AI와 오늘의 기록을 바탕으로 이야기할 수 있어요."
        />
      )}

      <ul>
        {data.convs.map((c) => {
          const creator = creatorOf(c.creatorId);
          if (!creator) return null;
          return (
            <li key={c.creatorId}>
              <Link href={`/chat/${creator.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors active:bg-brand-tint">
                <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="lg" ring="ai" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sub font-semibold">🤖 {creator.name} AI</span>
                    <span className="ml-auto shrink-0 text-meta text-faint">
                      <RelativeTime iso={c.lastMessageAt} />
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-caption text-muted">{c.lastMessage?.content}</p>
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
                <span className="mt-1.5 w-full truncate text-center text-meta">{creator.name} AI</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="mx-8 mt-8 text-center text-meta text-faint">
        Creator AI는 크리에이터가 확인한 사실과 오늘 남긴 기록만 바탕으로 이야기해요. 크리에이터 본인의 메시지와는 항상 구분돼요.
      </p>
    </main>
  );
}
