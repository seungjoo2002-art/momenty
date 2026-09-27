"use client";

import { ArrowUp, Bot, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { ButtonLink } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadState";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { AiChatError, getAiConversation, sendAiMessage, type AiChatMessage } from "@/lib/services/aiChat";
import { getMoment, getMomentsByIds } from "@/lib/services/moments";
import type { Creator, Moment } from "@/lib/types";
import { josa } from "@/lib/utils/format";
import { AIMessage, FanMessage, SystemNotice, TypingIndicator } from "./messages";

const MESSAGE_MAX = 1000;

/**
 * Creator AI 대화방.
 * · 상단에 항상 "AI가 생성한 답변입니다" — 실제 크리에이터와의 대화로 보이지 않게.
 * · AI 메시지는 "🤖 {이름} AI". 실제 크리에이터의 메시지 표시(✓ {이름})는 쓰지 않는다.
 * · 보내는 것은 creatorId · 메시지 · (있으면) momentId뿐. Moment 본문은 보내지 않는다 — 서버가 권한을 확인하고 직접 읽는다.
 * · 새로고침 · 재접속하면 저장된 대화를 불러온다 (팬 본인 대화만 — RLS).
 */
export function ChatRoom({ creator, focusMomentId }: { creator: Creator; focusMomentId?: string }) {
  const { data, error, retry } = useMomentData(`ai-chat:${creator.id}:${focusMomentId ?? ""}`, async () => {
    const [messages, focus] = await Promise.all([getAiConversation(creator.id), focusMomentId ? getMoment(focusMomentId) : Promise.resolve(undefined)]);
    const refIds = [...new Set(messages.flatMap((m) => m.groundedMomentIds))];
    const refs = refIds.length ? await getMomentsByIds(refIds) : [];
    // 볼 수 없거나 다른 크리에이터의 Moment는 focus로 보여주지 않는다 (서버도 Context에 넣지 않는다)
    const usableFocus = focus && !focus.locked && focus.creatorId === creator.id ? focus : undefined;
    return { messages, refs, focus: usableFocus };
  });

  const [pending, setPending] = useState<string | null>(null);
  const [sent, setSent] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [err, setErr] = useState<AiChatError | null>(null);
  const [focusOn, setFocusOn] = useState(true);
  const bottom = useRef<HTMLDivElement>(null);

  const messages = [...(data?.messages ?? []), ...sent.filter((m) => !(data?.messages ?? []).some((x) => x.id === m.id))];
  const refOf = (ids: string[]): Moment[] => (data?.refs ?? []).filter((m) => ids.includes(m.id));

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, pending]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || pending) return;
    setPending(text);
    setInput("");
    setErr(null);
    try {
      await sendAiMessage({ creatorId: creator.id, message: text, momentId: focusOn && data?.focus ? data.focus.id : undefined });
      // 저장된 대화를 다시 읽는다 (서버가 저장한 그대로 — 시각 · 근거 Moment 포함)
      setSent([]);
      retry();
    } catch (ex) {
      setErr(ex instanceof AiChatError ? ex : new AiChatError("잠시 후 다시 시도해 주세요.", "error"));
      setInput(text); // 저장되지 않았으니 다시 보낼 수 있게
    } finally {
      setPending(null);
    }
  }

  return (
    <main className="flex h-dvh flex-col bg-canvas">
      <TopBar backHref={`/creators/${creator.id}/today`} title={<span className="text-sub font-semibold">🤖 {creator.name} AI</span>} divider />
      <div role="note" className="flex items-center justify-center gap-1.5 border-b border-ai-line bg-ai-soft px-4 py-2 text-meta text-ai">
        <Bot className="size-3.5" />
        AI가 생성한 답변입니다 · {creator.name} 본인이 아니에요
      </div>

      <div className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {!data && error && <LoadError message={error} onRetry={retry} />}
        {data && messages.length === 0 && (
          <div className="px-4 pt-6 text-center">
            <p className="text-sub font-semibold">🤖 {creator.name} AI</p>
            <p className="mt-1 text-caption leading-relaxed text-muted">
              {josa(creator.name, "이", "가")} 설정한 말투와 확인한 사실, 오늘 남긴 기록을 바탕으로 이야기하는 AI예요. 기록에 없는 일은 지어내지 않아요.
            </p>
          </div>
        )}
        {messages.map((m) =>
          m.sender === "fan" ? (
            <FanMessage key={m.id} text={m.content} createdAt={m.createdAt} />
          ) : (
            <AIMessage key={m.id} creator={creator} text={m.content} createdAt={m.createdAt} refMoments={refOf(m.groundedMomentIds)} />
          ),
        )}
        {pending && (
          <>
            <FanMessage text={pending} createdAt={new Date().toISOString()} />
            <TypingIndicator label={`${creator.name} AI가 답하는 중`} />
          </>
        )}
        {err && <ChatErrorNotice error={err} creatorId={creator.id} />}
        <div ref={bottom} />
      </div>

      <footer className="border-t border-line bg-surface px-3 pt-2 pb-[max(env(safe-area-inset-bottom),10px)]">
        {data?.focus && focusOn && (
          <div className="mb-2 flex items-center gap-2 rounded-tile bg-canvas p-2">
            <MomentMedia moment={data.focus} variant="thumb" className="size-9 shrink-0" />
            <p className="min-w-0 flex-1 truncate text-meta text-ink-2">이 순간에 대해 이야기하는 중</p>
            <button type="button" onClick={() => setFocusOn(false)} className="shrink-0 px-2 text-meta text-muted">
              해제
            </button>
          </div>
        )}
        <form onSubmit={send} className="flex items-end gap-2">
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
            placeholder={`${creator.name} AI에게 메시지`}
            aria-label="메시지"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] border border-line-strong bg-canvas px-4 py-2.5 text-sub outline-none focus:border-brand"
          />
          <button type="submit" disabled={!input.trim() || !!pending} aria-label="보내기" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white disabled:opacity-40">
            {pending ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
          </button>
        </form>
      </footer>
    </main>
  );
}

function ChatErrorNotice({ error, creatorId }: { error: AiChatError; creatorId: string }) {
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
  return <SystemNotice text={error.code === "rate_limited" && error.resetAt ? `${error.message} (잠시 뒤 다시 보낼 수 있어요)` : error.message} />;
}
