"use client";

import { Bot } from "lucide-react";
import Link from "next/link";
import { useAccount } from "@/components/auth/AuthProvider";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError } from "@/components/ui/LoadState";
import { EmptyState, PageHeader } from "@/components/ui/primitives";
import { RelativeTime } from "@/components/ui/RelativeTime";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { aiStarterText, getAiConversations, getMyAiViewConsents, getMySubscriptionWelcomes } from "@/lib/services/aiChat";
import { getCreators } from "@/lib/services/creators";
import { getCurrentFan } from "@/lib/services/fan";
import { getMyHumanConversations } from "@/lib/services/humanChat";
import { getMyBlockedUserIds } from "@/lib/services/safety";

/**
 * 대화 목록 — 크리에이터마다 한 줄. Creator AI 대화(🤖)와 크리에이터 본인과의 직접 대화(✓)를 미리보기에서 분명히 구분한다.
 * (두 대화는 DB에서 따로 저장 · 권한 관리된다 — 화면만 한 줄로 모아 보여준다)
 */
export default function ChatListPage() {
  const account = useAccount();
  const { data, error, retry } = useMomentData(`chats:${account?.userId ?? ""}`, async () => {
    const [ai, human, creators, fan, blocked, consents, welcomes] = await Promise.all([
      getAiConversations(),
      getMyHumanConversations(),
      getCreators(),
      getCurrentFan(),
      getMyBlockedUserIds(),
      getMyAiViewConsents(),
      getMySubscriptionWelcomes(),
    ]);
    return { ai, human, creators, fan, blocked, consents, welcomes };
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
    const humanRow: Row = { creatorId: h.creatorId, at, preview: m ? `${m.sender === "creator" ? `${name} 본인` : `나 → ${name} 본인`} · ${m.content}` : "", human: true, unread: h.unread };
    if (!prev || at > prev.at) byCreator.set(h.creatorId, humanRow);
    else if (h.unread) byCreator.set(h.creatorId, { ...prev, unread: true });
  }
  // 구독 환영 메시지 (크리에이터가 설정한 자동 메시지) — 더 최근이면 미리보기로
  // 출처대로: 크리에이터 문구 · 🤖 AI 자동 메시지 · MOMENTY 구독 안내
  const welcomePreview = (w: (typeof data.welcomes)[number]) =>
    w.source === "system" ? `MOMENTY · ${w.message}` : w.source === "default_ai" ? `🤖 AI · ${w.message}` : `자동 환영 메시지 · ${w.message}`;
  for (const w of data.welcomes) {
    const prev = byCreator.get(w.creatorId);
    if (!prev) byCreator.set(w.creatorId, { creatorId: w.creatorId, at: w.createdAt, preview: welcomePreview(w), human: false, unread: false });
    else if (w.createdAt > prev.at) byCreator.set(w.creatorId, { ...prev, at: w.createdAt, preview: welcomePreview(w) });
  }
  // 팔로우 · 구독 중이고 AI Avatar가 켜진 크리에이터 — 아직 메시지가 없어도 목록에 (차단한 크리에이터는 새로 보이지 않는다)
  // 미리보기: 안내를 확인했으면 AI Avatar 첫 자동 메시지(확인 시각), 아니면 시작 안내
  const consentOf = new Map(data.consents.map((c) => [c.creatorId, c.agreedAt]));
  for (const s of data.fan.subscriptions) {
    if (byCreator.has(s.creatorId)) continue;
    const c = creatorOf(s.creatorId);
    if (!c || !c.personaEnabled || data.blocked.has(c.profileId)) continue;
    const agreedAt = consentOf.get(c.id);
    byCreator.set(c.id, agreedAt ? { creatorId: c.id, at: agreedAt, preview: `🤖 AI · ${aiStarterText(c.name).split("\n")[0]}`, human: false, unread: false } : { creatorId: c.id, at: "", preview: "AI Avatar와 대화를 시작해보세요", human: false, unread: false });
  }
  // 시각이 있는 대화가 위, 아직 시작 전인 크리에이터는 아래
  const rows = [...byCreator.values()].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <main className="animate-fade-in">
      <PageHeader title="Chat" caption="🤖 Creator AI · ✓ 크리에이터 직접 메시지" />

      {rows.length === 0 && (
        <EmptyState icon={<Bot className="size-5" />} title="아직 대화가 없어요" description="AI Avatar를 켠 크리에이터를 팔로우하면 여기에서 바로 대화를 시작할 수 있어요." />
      )}

      <ul>
        {rows.map((r) => {
          const creator = creatorOf(r.creatorId);
          if (!creator) return null;
          return (
            <li key={r.creatorId}>
              <Link href={`/chat/${creator.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors active:bg-brand-tint">
                <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="lg" ring={r.human ? "human" : "ai"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sub font-semibold">{creator.name}</span>
                    {!r.human && creator.personaEnabled && <span className="shrink-0 rounded-full bg-ai-soft px-1.5 py-px text-micro text-ai">AI Avatar</span>}
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


      <p className="mx-8 mt-8 break-keep text-center text-meta text-faint">
        🤖 Creator AI는 크리에이터가 확인한 사실과 오늘 남긴 기록만 바탕으로 답하는 AI예요. ✓ 표시는 크리에이터 본인이 직접 보낸 메시지예요.
      </p>
    </main>
  );
}
