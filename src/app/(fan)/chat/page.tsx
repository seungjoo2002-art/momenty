import { MessageCircle } from "lucide-react";
import Link from "next/link";
import { HumanBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { EmptyState, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { getCreators } from "@/lib/services/creators";
import { getChatThreads, getCurrentFan } from "@/lib/services/fan";
import { getTodayMoments } from "@/lib/services/moments";
import { canChat } from "@/lib/utils/access";

export default async function ChatListPage() {
  const [threads, fan, creators] = await Promise.all([getChatThreads(), getCurrentFan(), getCreators()]);
  const creatorOf = (id: string) => creators.find((c) => c.id === id)!;

  const threadCreatorIds = new Set(threads.map((t) => t.creatorId));
  const startable = await Promise.all(
    fan.subscriptions
      .filter((s) => canChat(s.tier) && !threadCreatorIds.has(s.creatorId))
      .map(async (s) => ({ creator: creatorOf(s.creatorId), count: (await getTodayMoments(s.creatorId)).length })),
  );

  return (
    <main className="animate-fade-in">
      <PageHeader title="Chat" caption="오늘의 Moment를 바탕으로 나누는 대화" />

      {threads.length === 0 && <EmptyState icon={<MessageCircle className="size-5" />} title="아직 대화가 없어요" />}

      <ul>
        {threads.map((t) => {
          const c = creatorOf(t.creatorId);
          const last = t.messages.at(-1);
          const fromHuman = last?.sender === "creator";
          return (
            <li key={t.id}>
              <Link href={`/chat/${c.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors active:bg-brand-tint">
                <Avatar src={c.avatarUrl} name={c.name} size="lg" ring={fromHuman ? "human" : "none"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sub font-semibold">{fromHuman ? c.name : `${c.name.slice(1)} AI`}</span>
                    {fromHuman && <HumanBadge label="본인 답장" />}
                    {last && (
                      <span className="ml-auto shrink-0 text-meta text-faint">
                        <RelativeTime iso={last.createdAt} />
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <p className="min-w-0 flex-1 truncate text-caption text-muted">{last?.text}</p>
                    {t.unread > 0 && (
                      <span className="grid size-[18px] shrink-0 place-items-center rounded-full bg-brand text-micro font-semibold text-white">
                        {t.unread}
                      </span>
                    )}
                  </div>
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
            {startable.map(({ creator, count }) => (
              <Link key={creator.id} href={`/chat/${creator.id}`} className="pressable flex w-16 shrink-0 flex-col items-center">
                <Avatar src={creator.avatarUrl} name={creator.name} size="lg" ring={count ? "today" : "seen"} />
                <span className="mt-1.5 w-full truncate text-center text-meta">{creator.name.slice(1)} AI</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <p className="mx-8 mt-8 text-center text-meta text-faint">
        Creator AI는 오늘 남긴 기록을 바탕으로 이야기해요. 크리에이터가 직접 보낸 메시지에는 ‘본인’이 붙어요.
      </p>
    </main>
  );
}
