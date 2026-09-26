"use client";

import { ArrowUp, Lock } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { TopBar } from "@/components/ui/TopBar";
import { generatePersonaReply } from "@/lib/ai/persona";
import type { ChatMessage, ChatThread, Creator, Moment } from "@/lib/types";
import { formatClock, formatTime } from "@/lib/utils/format";
import { AIMessage, CreatorMessage, FanMessage, SystemNotice, TypingIndicator } from "./messages";

interface ChatRoomProps {
  creator: Creator;
  thread: ChatThread;
  /** 팬이 볼 수 있는, 오늘 기록된 Moment */
  moments: Moment[];
  canChat: boolean;
  focusMoment?: Moment;
}

export function ChatRoom({ creator, thread, moments, canChat, focusMoment }: ChatRoomProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(thread.messages);
  const [draft, setDraft] = useState(focusMoment ? `${formatTime(focusMoment.createdAt)}에 남긴 Moment 이야기 듣고 싶어요!` : "");
  const [typing, setTyping] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, typing]);

  const momentById = (id: string) => moments.find((m) => m.id === id);

  async function send() {
    const text = draft.trim();
    if (!text || typing) return;
    const now = new Date().toISOString();
    setMessages((prev) => [...prev, { id: `local-${prev.length}`, sender: "fan", text, createdAt: now }]);
    setDraft("");
    setTyping(true);
    const reply = await generatePersonaReply(creator, moments, text);
    setTyping(false);
    setMessages((prev) => [
      ...prev,
      {
        id: `local-${prev.length}`,
        sender: "ai",
        text: reply.text,
        createdAt: new Date().toISOString(),
        refMomentIds: reply.refMomentIds,
      },
    ]);
  }

  const givenName = creator.name.slice(1);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar
        backHref="/chat"
        divider
        title={
          <Link href={`/creators/${creator.id}/today`} className="flex min-w-0 items-center gap-2.5">
            <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="ai" />
            <div className="min-w-0 leading-tight">
              <div className="truncate text-sub font-semibold">{givenName} AI</div>
              <div className="truncate text-meta font-normal text-muted">{givenName}의 오늘을 기반으로 대화해요</div>
            </div>
          </Link>
        }
      />

      {/* 대화의 근거: 오늘 실제로 기록된 Moment */}
      {moments.length > 0 && (
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto border-b border-line px-4 py-2.5">
          <span className="shrink-0 text-micro font-medium text-muted">오늘의 Moment</span>
          {moments.map((m) => (
            <Link key={m.id} href={`/moments/${m.id}`} className="pressable shrink-0" aria-label={`${formatClock(m.createdAt)} Moment`}>
              <MomentMedia moment={m} variant="thumb" className="size-9" />
            </Link>
          ))}
        </div>
      )}

      <div className="flex-1 space-y-4 px-4 py-4">
        <p className="text-center text-micro text-faint">
          AI 표시가 있는 답변은 오늘의 Moment를 바탕으로 한 AI 응답이에요. 본인이 직접 보낸 메시지에는 ‘본인’이 붙어요.
        </p>
        {messages.length === 0 && <SystemNotice text={`${givenName}의 오늘에 대해 먼저 말을 걸어보세요.`} />}
        {messages.map((msg) => {
          switch (msg.sender) {
            case "system":
              return (
                <SystemNotice key={msg.id} text={msg.text} variant={msg.text.includes("직접") ? "human" : "default"} />
              );
            case "fan":
              return <FanMessage key={msg.id} text={msg.text} createdAt={msg.createdAt} />;
            case "creator":
              return <CreatorMessage key={msg.id} creator={creator} text={msg.text} createdAt={msg.createdAt} />;
            case "ai":
              return (
                <AIMessage
                  key={msg.id}
                  creator={creator}
                  text={msg.text}
                  createdAt={msg.createdAt}
                  refMoments={(msg.refMomentIds ?? []).map(momentById).filter((m): m is Moment => !!m)}
                />
              );
          }
        })}
        {typing && <TypingIndicator label="오늘의 Moment를 살펴보는 중" />}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 border-t border-line bg-surface/95 px-3 pt-2 pb-[max(env(safe-area-inset-bottom),10px)] backdrop-blur-md">
        {canChat ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex items-end gap-2"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              onFocus={() => setTimeout(() => bottomRef.current?.scrollIntoView({ block: "end" }), 300)}
              rows={1}
              placeholder="메시지 보내기"
              enterKeyHint="send"
              className="field-sizing-content max-h-28 min-h-10 flex-1 resize-none rounded-[20px] bg-canvas px-4 py-2 text-sub outline-none ring-1 ring-line ring-inset placeholder:text-faint focus:ring-brand/50"
            />
            <button
              type="submit"
              disabled={!draft.trim() || typing}
              className="pressable grid size-10 shrink-0 place-items-center rounded-full bg-brand text-white disabled:bg-line-strong"
              aria-label="보내기"
            >
              <ArrowUp className="size-5" />
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-3 py-1">
            <Lock className="size-4 shrink-0 text-muted" />
            <p className="flex-1 text-caption text-ink-2">구독하면 {givenName}의 오늘에 대해 대화할 수 있어요.</p>
            <ButtonLink href={`/subscribe/${creator.id}`} size="sm">
              구독하기
            </ButtonLink>
          </div>
        )}
      </div>
    </div>
  );
}
