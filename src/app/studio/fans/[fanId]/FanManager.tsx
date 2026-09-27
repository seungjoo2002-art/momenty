"use client";

import { ArrowUp, Brain, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { HumanBadge, SubscriptionBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { Stat } from "@/components/ui/primitives";
import { ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";
import type { Creator, FanProfile } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatShortDate, shortName } from "@/lib/utils/format";

/** 개별 팬 관리: 직접 답장(본인 참여), AI 응대 범위, 제한 */
export function FanManager({ fan, creator }: { fan: FanProfile; creator: Creator }) {
  const [reply, setReply] = useState("");
  const [sent, setSent] = useState<string | null>(null);
  const [status, setStatus] = useState(fan.status);

  return (
    <main>
      <TopBar backHref="/studio/fans" title="팬 정보" center />

      <section className="px-5 pt-5">
        <div className="flex items-center gap-4">
          <Avatar src={fan.avatarUrl} name={fan.nickname} size="xl" />
          <div>
            <div className="flex items-center gap-1.5">
              <span className="text-section font-semibold">{fan.nickname}</span>
              <SubscriptionBadge tier={fan.tier} />
            </div>
            <p className="mt-0.5 text-caption text-muted">{formatShortDate(fan.since)}부터 함께</p>
            {status === "restricted" && (
              <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-meta font-semibold text-danger">
                <ShieldAlert className="size-3" />
                AI 응답 제한 중
              </span>
            )}
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 rounded-card bg-surface py-4">
          <Stat value={fan.reactionCount} label="남긴 반응" />
          <Stat value={fan.chatCount} label="AI 대화" className="border-l border-line" />
        </div>
      </section>

      <section className="mx-5 mt-5 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center gap-2 text-caption font-semibold text-ai">
          <Brain className="size-4" />
          Fan Memory 요약
        </div>
        <p className="mt-2 text-body leading-relaxed">{fan.memorySummary}</p>
        <p className="mt-2 text-meta text-muted">팬이 공유를 허락한 요약만 보여요. 원문 대화는 볼 수 없어요.</p>
      </section>

      {/* 본인 직접 답장 */}
      <section className="mx-5 mt-5 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-body font-semibold">직접 답장하기</h2>
          <HumanBadge />
        </div>
        {fan.pendingMessage ? (
          <div className="mt-3 rounded-tile bg-canvas px-4 py-3 text-sub leading-relaxed text-ink-2">“{fan.pendingMessage}”</div>
        ) : (
          <p className="mt-2 text-caption text-muted">대기 중인 메시지는 없지만, 먼저 말을 걸 수도 있어요.</p>
        )}
        {sent ? (
          <div className="mt-3 ml-auto w-fit max-w-[85%] rounded-[20px] rounded-tr-md bg-brand px-4 py-3 text-sub text-white">
            {sent}
          </div>
        ) : (
          <form
            className="mt-3 flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (reply.trim()) setSent(reply.trim());
            }}
          >
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={2}
              placeholder={`${shortName(creator.name)} 님이 직접 쓰는 한마디`}
              className="flex-1 resize-none rounded-tile border border-line-strong px-4 py-2.5 text-body outline-none placeholder:text-faint focus:border-brand"
            />
            <button
              type="submit"
              disabled={!reply.trim()}
              className="grid size-11 place-items-center rounded-full bg-brand text-white disabled:bg-line-strong"
              aria-label="보내기"
            >
              <ArrowUp className="size-5" />
            </button>
          </form>
        )}
        <p className="mt-2 text-meta text-muted">팬의 대화창에 ‘본인 직접’ 표시와 함께 전달돼요.</p>
      </section>

      <section className="mx-5 mt-5 overflow-hidden rounded-card border border-line bg-surface [&>div]:border-b [&>div]:border-line [&>div:last-child]:border-none">
        <ToggleRow title="이 팬과 Creator AI 대화 허용" defaultOn={status !== "restricted"} />
        <ToggleRow title="새 Moment 알림 우선 전달" description="Premium 팬에게 먼저 알림을 보내요." defaultOn={fan.tier === "premium"} />
      </section>

      <div className="mx-5 mt-6 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={() => setStatus(status === "muted" ? "active" : "muted")}>
          {status === "muted" ? "알림 다시 받기" : "알림 끄기"}
        </Button>
        <Button
          variant="secondary"
          className={cn(status !== "restricted" && "text-danger")}
          onClick={() => setStatus(status === "restricted" ? "active" : "restricted")}
        >
          {status === "restricted" ? "제한 해제" : "이 팬 제한하기"}
        </Button>
      </div>
    </main>
  );
}
