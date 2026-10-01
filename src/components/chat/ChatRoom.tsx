"use client";

import { ArrowUp, BadgeCheck, Bot, Loader2, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { ButtonLink } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadState";
import { TopBar, TopBarIcon } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { acknowledgeAiNotice, AiChatError, aiStarterText, getAiConversation, getAiViewConsent, getSubscriptionWelcome, sendAiMessage, type AiChatMessage } from "@/lib/services/aiChat";
import { getCurrentFan } from "@/lib/services/fan";
import { getHumanConversationId, getHumanMessages, HumanChatError, markHumanRead, sendHumanToCreator, subscribeHumanMessages, type HumanMessage } from "@/lib/services/humanChat";
import { getMoment, getMomentsByIds } from "@/lib/services/moments";
import { blockUser, getMyReportedMessageIds, isBlockedByMe, unblockUser } from "@/lib/services/safety";
import type { Creator, Moment } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { tierFor } from "@/lib/utils/access";
import { josa } from "@/lib/utils/format";
import { AIMessage, AIStarterMessage, CreatorMessage, FanMessage, SystemNotice, TypingIndicator, WelcomeMessage } from "./messages";
import { BlockSheet, ReportSheet } from "./SafetySheets";

const MESSAGE_MAX = 1000;
export type ChatMode = "ai" | "human";

/**
 * 크리에이터와의 대화방 — Creator AI와 크리에이터 본인(Human)을 한 화면에서, 절대 헷갈리지 않게.
 * · 데이터는 따로다: AI 대화(ai_messages, 팬만 읽음)와 직접 대화(human_messages, 팬 · 크리에이터만 읽음). 화면만 시간순으로 함께 보여준다.
 * · AI: "🤖 {이름} AI" + AI 라벨 · 상단 "AI가 생성한 답변입니다 · {이름} 본인이 아니에요"
 * · 본인: "✓ {이름}" + 본인 라벨 · "크리에이터가 직접 보낸 메시지"
 * · 내가 보낸 말풍선에는 받는 쪽(🤖 AI에게 / ✓ 이름에게 직접)을 붙인다. 아래 입력창도 지금 누구에게 보내는지 먼저 고른다.
 * · 직접 메시지는 subscriber · premium만 (DB가 다시 확인). 차단 관계면 직접 메시지 · Creator AI 모두 멈춘다.
 * · AI 경로는 creatorId · 메시지 · momentId만 보낸다 (Moment 본문 · 직접 대화 내용은 AI에게 가지 않는다).
 * · AI Avatar 대화는 크리에이터가 확인할 수 있다 — 팬이 안내를 확인해야 AI 대화가 열린다 (DB도 확인). 확인 전 대화는 공개되지 않는다.
 * · 구독 환영 메시지는 "크리에이터가 설정한 자동 환영 메시지"로 따로 보여준다 (본인이 실시간으로 보낸 메시지가 아니다).
 * · AI Avatar가 켜진 크리에이터면 팔로워 · 구독자 모두 처음 들어올 때 안내 카드를 본다. [확인하고 시작하기]를 눌러야만 확인이 기록된다
 *   (팔로우는 확인이 아니다). 확인하면 그 시각에 AI Avatar 첫 자동 메시지(정해진 문장)가 한 번 보인다.
 * · AI Avatar 답장은 지금 정책 그대로 유료 구독자만 (DB가 다시 확인) — 팔로워에게는 입력창 대신 구독 안내를 보여준다.
 * · AI Avatar가 꺼진 크리에이터에게는 AI와 대화할 수 있다고 보이지 않는다 (구독자는 직접 메시지만).
 */
export function ChatRoom({ creator, focusMomentId, initialMode = "ai" }: { creator: Creator; focusMomentId?: string; initialMode?: ChatMode }) {
  const { data, error, retry } = useMomentData(`chat:${creator.id}:${focusMomentId ?? ""}`, async () => {
    const [messages, focus, fan, humanConv, blocked, reported, consentAt, welcome] = await Promise.all([
      getAiConversation(creator.id),
      focusMomentId ? getMoment(focusMomentId) : Promise.resolve(undefined),
      getCurrentFan(),
      getHumanConversationId(creator.id),
      isBlockedByMe(creator.profileId),
      getMyReportedMessageIds(),
      getAiViewConsent(creator.id),
      getSubscriptionWelcome(creator.id),
    ]);
    const [refs, human] = await Promise.all([
      (async () => {
        const refIds = [...new Set(messages.flatMap((m) => m.groundedMomentIds))];
        return refIds.length ? getMomentsByIds(refIds) : [];
      })(),
      humanConv ? getHumanMessages(humanConv) : Promise.resolve([] as HumanMessage[]),
    ]);
    // 볼 수 없거나 다른 크리에이터의 Moment는 focus로 보여주지 않는다 (서버도 Context에 넣지 않는다)
    const usableFocus = focus && !focus.locked && focus.creatorId === creator.id ? focus : undefined;
    const tier = tierFor(fan, creator.id);
    return { messages, refs, focus: usableFocus, humanConv, human, humanAllowed: tier === "subscriber" || tier === "premium", blocked, reported, consentAt, welcome };
  });

  const [mode, setMode] = useState<ChatMode>(initialMode);
  const [pending, setPending] = useState<string | null>(null);
  // 방금 보낸 (팬 · AI) 쌍 — 다시 읽은 대화에 그 AI 메시지가 들어올 때까지 화면에 남겨 둔다 (보낸 직후 사라지지 않게)
  const [sent, setSent] = useState<{ fan: AiChatMessage; ai: AiChatMessage }[]>([]);
  const [liveHuman, setLiveHuman] = useState<HumanMessage[]>([]);
  const [humanConvId, setHumanConvId] = useState<string | null>(null);
  const [sendingHuman, setSendingHuman] = useState(false);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<AiChatError | HumanChatError | null>(null);
  const [focusOn, setFocusOn] = useState(true);
  // 이 화면에서 보낸 답 중 AI Memory에 기억한 것 (표시만 — 기억 내용은 My > AI Memory에서)
  const [remembered, setRemembered] = useState<Set<string>>(new Set());
  const [blockedOverride, setBlockedOverride] = useState<boolean | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportedNow, setReportedNow] = useState<Set<string>>(new Set());
  const [ackAt, setAckAt] = useState<string | null>(null);
  const [acking, setAcking] = useState(false);
  // 다른 곳에서 확인을 취소한 경우 (서버가 ai_notice_required) — 다시 묻는다
  const [noticeRevoked, setNoticeRevoked] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const blocked = blockedOverride ?? data?.blocked ?? false;
  const humanAllowed = !!data?.humanAllowed;
  const aiOn = creator.personaEnabled;
  // AI Avatar가 꺼져 있으면 구독자는 직접 메시지로만
  const activeMode: ChatMode = humanAllowed ? (aiOn ? mode : "human") : "ai";
  const convId = humanConvId ?? data?.humanConv ?? null;
  const reported = new Set([...(data?.reported ?? []), ...reportedNow]);
  // AI 대화 전 안내 확인 (AI Avatar가 켜져 있으면 팔로워 · 구독자 모두 — 확인 버튼을 눌러야만 기록된다)
  const consentAt = noticeRevoked ? null : (ackAt ?? data?.consentAt ?? null);
  const noticeNeeded = !!data && aiOn && !blocked && !consentAt;
  // 팔로워는 안내 확인 · 첫 자동 메시지까지. AI Avatar 답장은 유료 구독자만 (서버 · DB도 같은 기준)
  const aiReplyAllowed = humanAllowed;

  const loaded = data?.messages ?? [];
  const aiMessages = [...loaded, ...sent.filter((p) => !loaded.some((x) => x.id === p.ai.id)).flatMap((p) => [p.fan, p.ai])];
  const loadedHuman = data?.human ?? [];
  const humanMessages = [...loadedHuman, ...liveHuman.filter((m) => !loadedHuman.some((x) => x.id === m.id))];
  type Row = { key: string; at: string; node: React.ReactNode };
  const rows: Row[] = [
    ...aiMessages.map((m) => ({
      key: `ai-${m.id}`,
      at: m.createdAt,
      node:
        m.sender === "fan" ? (
          <FanMessage key={m.id} text={m.content} createdAt={m.createdAt} to="🤖 AI에게" />
        ) : (
          <AIMessage key={m.id} creator={creator} text={m.content} createdAt={m.createdAt} refMoments={refOf(m.groundedMomentIds)} remembered={remembered.has(m.id)} />
        ),
    })),
    // AI Avatar 첫 자동 메시지 — 확인 시각에 하나 (저장하지 않는 정해진 문장 → 몇 번을 들어와도 하나)
    ...(aiOn && consentAt ? [{ key: "ai-starter", at: consentAt, node: <AIStarterMessage creator={creator} text={aiStarterText(creator.name)} createdAt={consentAt} /> }] : []),
    ...(data?.welcome
      ? [{ key: `w-${data.welcome.id}`, at: data.welcome.createdAt, node: <WelcomeMessage creator={creator} text={data.welcome.message} createdAt={data.welcome.createdAt} aiAvailable={creator.personaEnabled} /> }]
      : []),
    ...humanMessages.map((m) => ({
      key: `h-${m.id}`,
      at: m.createdAt,
      node:
        m.sender === "fan" ? (
          <FanMessage key={m.id} text={m.content} createdAt={m.createdAt} to={`✓ ${creator.name}에게 직접`} />
        ) : (
          <CreatorMessage key={m.id} creator={creator} text={m.content} createdAt={m.createdAt} reported={reported.has(m.id)} onReport={() => setReportId(m.id)} />
        ),
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  function refOf(ids: string[]): Moment[] {
    return (data?.refs ?? []).filter((m) => ids.includes(m.id));
  }

  // 크리에이터 본인의 새 메시지 (Realtime · RLS — 이 대화 참여자에게만 온다)
  useEffect(() => {
    if (!data) return;
    const add = (list: HumanMessage[]) => setLiveHuman((prev) => [...prev, ...list.filter((m) => !prev.some((x) => x.id === m.id))]);
    return subscribeHumanMessages(
      `fan-${creator.id}`,
      convId,
      (m) => {
        if (convId ? m.conversationId !== convId : m.senderId !== creator.profileId) return;
        setHumanConvId(m.conversationId);
        add([m]);
        void markHumanRead(m.conversationId);
      },
      // 연결되기 전에 도착한 메시지 메우기
      async () => {
        const id = convId ?? (await getHumanConversationId(creator.id));
        if (!id) return;
        const list = await getHumanMessages(id);
        setHumanConvId(id);
        add(list);
      },
    );
  }, [data, convId, creator.id, creator.profileId]);

  useEffect(() => {
    if (convId) void markHumanRead(convId);
  }, [convId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [rows.length, pending]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || pending || sendingHuman) return;
    setErr(null);
    if (activeMode === "human") {
      setSendingHuman(true);
      try {
        const r = await sendHumanToCreator(creator.id, text);
        setHumanConvId(r.conversationId);
        setLiveHuman((prev) => (prev.some((x) => x.id === r.messageId) ? prev : [...prev, { id: r.messageId, conversationId: r.conversationId, sender: "fan", senderId: "", content: text, createdAt: new Date().toISOString() }]));
        setInput("");
      } catch (ex) {
        setErr(ex instanceof HumanChatError ? ex : new HumanChatError("error"));
      } finally {
        setSendingHuman(false);
      }
      return;
    }
    setPending(text);
    setInput("");
    try {
      const res = await sendAiMessage({ creatorId: creator.id, message: text, momentId: focusOn && data?.focus ? data.focus.id : undefined });
      if (res.memorySaved > 0) setRemembered((prev) => new Set([...prev, res.message.id]));
      const fan: AiChatMessage = { id: `sent-${res.message.id}`, sender: "fan", content: text, createdAt: new Date().toISOString(), groundedMomentIds: [], boundary: null };
      setSent((prev) => [...prev, { fan, ai: res.message }]);
      // 저장된 대화를 다시 읽는다 (서버가 저장한 그대로 — 시각 · 근거 Moment 포함). 들어오면 위의 쌍은 자동으로 빠진다
      retry();
    } catch (ex) {
      if (ex instanceof AiChatError && ex.code === "ai_notice_required") setNoticeRevoked(true);
      else setErr(ex instanceof AiChatError ? ex : new AiChatError("잠시 후 다시 시도해 주세요.", "error"));
      setInput(text); // 저장되지 않았으니 다시 보낼 수 있게
    } finally {
      setPending(null);
    }
  }

  const busy = !!pending || sendingHuman;

  async function acknowledge() {
    setAcking(true);
    setErr(null);
    try {
      setAckAt(await acknowledgeAiNotice(creator.id));
      setNoticeRevoked(false);
    } catch (ex) {
      setErr(new AiChatError(ex instanceof Error ? ex.message : "잠시 후 다시 시도해 주세요.", "error"));
    } finally {
      setAcking(false);
    }
  }

  return (
    <main className="flex h-dvh flex-col bg-canvas">
      <TopBar
        backHref={`/creators/${creator.id}/today`}
        title={<span className="text-sub font-semibold">{activeMode === "human" ? `✓ ${creator.name}` : aiOn ? `🤖 ${creator.name} AI` : creator.name}</span>}
        right={
          <TopBarIcon label="대화 설정" onClick={() => setMenuOpen(true)}>
            <MoreHorizontal className="size-5" />
          </TopBarIcon>
        }
        divider
      />
      {activeMode === "human" ? (
        <div role="note" className="flex items-center justify-center gap-1.5 border-b border-brand/20 bg-brand-soft px-4 py-2 text-meta text-brand-deep">
          <BadgeCheck className="size-3.5" />✓ {creator.name} 본인에게 직접 보내요 · AI가 답하지 않아요
        </div>
      ) : aiOn ? (
        <div role="note" className="flex items-center justify-center gap-1.5 border-b border-ai-line bg-ai-soft px-4 py-2 text-meta text-ai">
          <Bot className="size-3.5" />
          AI가 생성한 답변입니다 · {creator.name} 본인이 아니에요
        </div>
      ) : null}

      <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!data && error && <LoadError message={error} onRetry={retry} />}
        {data && rows.length === 0 && aiOn && !noticeNeeded && (
          <div className="px-4 pt-6 text-center">
            <p className="text-sub font-semibold">🤖 {creator.name} AI</p>
            <p className="mt-1 break-keep text-caption leading-relaxed text-muted">
              {josa(creator.name, "이", "가")} 설정한 말투와 확인한 사실, 오늘 남긴 기록을 바탕으로 이야기하는 AI예요. 기록에 없는 일은 지어내지 않아요.
            </p>
            {humanAllowed && (
              <p className="mt-3 break-keep text-caption leading-relaxed text-muted">
                아래에서 <span className="font-semibold text-brand-deep">✓ {creator.name}에게 직접</span>을 고르면 크리에이터 본인에게 메시지를 보낼 수 있어요.
              </p>
            )}
          </div>
        )}
        {rows.map((r) => (
          <div key={r.key}>{r.node}</div>
        ))}
        {pending && (
          <>
            <FanMessage text={pending} createdAt={new Date().toISOString()} to="🤖 AI에게" />
            <TypingIndicator label={`${creator.name} AI가 답하는 중`} />
          </>
        )}
        {activeMode === "ai" && noticeNeeded && <AiNoticeCard name={creator.name} acking={acking} onConfirm={acknowledge} />}
        {data && activeMode === "ai" && !aiOn && <SystemNotice text={`${creator.name}님은 지금 AI Avatar를 쓰지 않아요.`} />}
        {err && <ChatErrorNotice error={err} creatorId={creator.id} />}
        <div ref={bottom} />
      </div>

      <footer className="border-t border-line bg-surface px-3 pt-2 pb-[max(env(safe-area-inset-bottom),10px)]">
        {blocked ? (
          <p className="py-3 text-center text-caption text-muted">
            차단한 크리에이터예요.{" "}
            <button type="button" onClick={() => setMenuOpen(true)} className="font-semibold text-brand">
              차단 해제
            </button>
          </p>
        ) : (
          <>
            {humanAllowed && aiOn && (
              <div className="mb-2 flex gap-1.5" role="group" aria-label="받는 사람">
                <ModeButton active={activeMode === "ai"} onClick={() => setMode("ai")} label={`🤖 ${creator.name} AI`} />
                <ModeButton active={activeMode === "human"} onClick={() => setMode("human")} label={`✓ ${creator.name}에게 직접`} human />
              </div>
            )}
            {activeMode === "ai" && aiOn && !noticeNeeded && !aiReplyAllowed && (
              <div className="flex items-center gap-3 rounded-tile bg-canvas px-3.5 py-2.5">
                <p className="min-w-0 flex-1 break-keep text-caption text-ink-2">AI Avatar와 이어서 대화하려면 구독이 필요해요.</p>
                <ButtonLink href={`/subscribe/${creator.id}`} size="sm" className="shrink-0">
                  구독 플랜 보기
                </ButtonLink>
              </div>
            )}
            {activeMode === "ai" && data?.focus && focusOn && !noticeNeeded && (
              <div className="mb-2 flex items-center gap-2 rounded-tile bg-canvas p-2">
                <MomentMedia moment={data.focus} variant="thumb" className="size-9 shrink-0" />
                <p className="min-w-0 flex-1 truncate text-meta text-ink-2">이 순간에 대해 이야기하는 중</p>
                <button type="button" onClick={() => setFocusOn(false)} className="shrink-0 px-2 text-meta text-muted">
                  해제
                </button>
              </div>
            )}
            <form onSubmit={send} className={cn("flex items-end gap-2", activeMode === "ai" && (noticeNeeded || !aiOn || !aiReplyAllowed) && "hidden")}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MESSAGE_MAX))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void send();
                  }
                }}
                rows={1}
                placeholder={activeMode === "human" ? `✓ ${creator.name}에게 직접 메시지` : `${creator.name} AI에게 메시지`}
                aria-label="메시지"
                className={cn(
                  "max-h-32 min-h-11 flex-1 resize-none rounded-[22px] border bg-canvas px-4 py-2.5 text-sub outline-none",
                  activeMode === "human" ? "border-brand/40 focus:border-brand" : "border-line-strong focus:border-brand",
                )}
              />
              <button type="submit" disabled={!input.trim() || busy} aria-label="보내기" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white disabled:opacity-40">
                {busy ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
              </button>
            </form>
          </>
        )}
      </footer>

      <ReportSheet messageId={reportId} onClose={() => setReportId(null)} onDone={(id) => setReportedNow((s) => new Set([...s, id]))} />
      <BlockSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        name={creator.name}
        blocked={blocked}
        effect={`차단하면 ${creator.name}님과 직접 메시지를 주고받을 수 없고, ${creator.name} AI와의 대화도 멈춰요. 지난 대화는 남아 있어요.`}
        onConfirm={async () => {
          if (blocked) await unblockUser(creator.profileId);
          else await blockUser(creator.profileId);
          setBlockedOverride(!blocked);
          setErr(null);
        }}
      />
    </main>
  );
}

/**
 * 처음 AI Avatar 대화방에 들어왔을 때 — 무엇과 대화하는지 · 크리에이터가 무엇을 볼 수 있는지 (실제 권한과 같은 내용만).
 * 크리에이터는 creator_fan_ai_messages()로 "확인 이후" AI 대화만 본다. 확인 전 대화 · AI Memory 원본은 받지 않는다.
 */
function AiNoticeCard({ name, acking, onConfirm }: { name: string; acking: boolean; onConfirm: () => void }) {
  return (
    <section aria-label={`${name}의 AI Avatar와 대화하기`} className="mx-auto max-w-[340px] rounded-card bg-surface p-5 ring-1 ring-ai-line ring-inset">
      <p className="flex items-center gap-1.5 text-sub font-semibold text-ink">
        <Bot className="size-4 text-ai" />
        {name}의 AI Avatar와 대화하기
      </p>
      <p className="mt-2 break-keep text-caption leading-relaxed text-ink-2">
        이 대화는 {name}의 공식 AI Avatar와 나누는 대화예요. AI는 크리에이터가 확인한 정보와 내가 볼 수 있는 Moment를 바탕으로 답해요.
      </p>
      <p className="mt-2 break-keep text-caption leading-relaxed text-ink-2">
        크리에이터는 팬 관리를 위해 안내를 확인한 이후의 AI 대화를 볼 수 있어요. 확인 이전 대화와 AI Memory 원본은 공개되지 않아요.
      </p>
      <p className="mt-2 break-keep text-meta text-muted">My › AI Avatar 대화 열람에서 언제든 취소할 수 있어요.</p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={acking}
        className="mt-4 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-tile bg-brand text-sub font-semibold text-white disabled:opacity-50"
      >
        {acking && <Loader2 className="size-4 animate-spin" />}
        확인하고 시작하기
      </button>
      <Link href="/chat" className="mt-1 flex h-10 items-center justify-center text-caption text-muted">
        나중에
      </Link>
    </section>
  );
}

function ModeButton({ active, onClick, label, human = false }: { active: boolean; onClick: () => void; label: string; human?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 rounded-full px-3 text-meta font-medium transition-colors",
        active ? (human ? "bg-brand-soft text-brand-deep ring-1 ring-brand/30" : "bg-ai-soft text-ai ring-1 ring-ai-line") : "text-muted hover:bg-canvas",
      )}
    >
      {label}
    </button>
  );
}

function ChatErrorNotice({ error, creatorId }: { error: AiChatError | HumanChatError; creatorId: string }) {
  if (error.code === "subscription_required") {
    return (
      <div className="rounded-card border border-line bg-surface p-4 text-center">
        <p className="text-sub font-semibold">{error.message}</p>
        <ButtonLink href={`/subscribe/${creatorId}`} size="sm" className="mt-3">
          구독 플랜 보기
        </ButtonLink>
      </div>
    );
  }
  if (error.code === "unauthenticated") {
    return (
      <div className="text-center">
        <Link href={`/login?next=${encodeURIComponent(`/chat/${creatorId}`)}`} className="text-sub font-semibold text-brand">
          로그인하기
        </Link>
      </div>
    );
  }
  return <SystemNotice text={error instanceof AiChatError && error.code === "rate_limited" && error.resetAt ? `${error.message} (잠시 뒤 다시 보낼 수 있어요)` : error.message} />;
}
