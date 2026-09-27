import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { AIBadge, VerifiedMark } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import type { Creator, Moment } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatClock, formatTime, shortName } from "@/lib/utils/format";

/**
 * 세 종류의 말풍선은 절대 비슷해 보이지 않는다.
 *  - Creator AI : 흰 말풍선 + 작은 "AI" 라벨 + "OO AI" 이름
 *  - 팬(나)     : 보라 말풍선, 흰 글자, 오른쪽
 *  - 실제 본인  : 라벤더 말풍선 + 보라 테두리 + 인증 체크 + "본인" 라벨, 아바타 보라 링
 */

export function AIMessage({
  creator,
  text,
  createdAt,
  refMoments = [],
}: {
  creator: Creator;
  text: string;
  createdAt: string;
  refMoments?: Moment[];
}) {
  return (
    <div className="flex gap-2 pr-12">
      <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="ai" />
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1">
          <span className="text-meta text-ink-2">{shortName(creator.name)} AI</span>
          <AIBadge />
        </div>
        <div className="rounded-[18px] rounded-tl-[6px] bg-surface px-3.5 py-2.5 text-sub text-ink ring-1 ring-line ring-inset">
          {text}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {refMoments.map((m) => (
            <Link
              key={m.id}
              href={`/moments/${m.id}`}
              className="inline-flex h-6 items-center gap-1 rounded-full bg-ai-soft px-2 text-micro text-ai hover:bg-ai-line"
            >
              <span className="size-1 rounded-full bg-brand" />
              {formatTime(m.createdAt)} Moment 기반
            </Link>
          ))}
          <time className="text-micro text-faint">{formatClock(createdAt)}</time>
        </div>
      </div>
    </div>
  );
}

export function CreatorMessage({ creator, text, createdAt }: { creator: Creator; text: string; createdAt: string }) {
  return (
    <div className="flex gap-2 pr-12">
      <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="human" />
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1">
          <span className="text-meta font-semibold text-brand-deep">{creator.name}</span>
          <VerifiedMark className="size-3.5" />
          <span className="rounded-full bg-brand px-1.5 py-px text-micro font-semibold text-white">본인</span>
        </div>
        <div className="rounded-[18px] rounded-tl-[6px] bg-brand-soft px-3.5 py-2.5 text-sub text-ink ring-1 ring-brand/25 ring-inset">
          {text}
        </div>
        <time className="mt-1 block text-micro text-faint">{formatClock(createdAt)} · 직접 보낸 메시지</time>
      </div>
    </div>
  );
}

export function FanMessage({ text, createdAt }: { text: string; createdAt: string }) {
  return (
    <div className="flex flex-col items-end pl-14">
      <div className="rounded-[18px] rounded-tr-[6px] bg-brand px-3.5 py-2.5 text-sub text-white">{text}</div>
      <time className="mt-1 text-micro text-faint">{formatClock(createdAt)}</time>
    </div>
  );
}

export function SystemNotice({ text, variant = "default" }: { text: string; variant?: "default" | "human" }) {
  return (
    <div className="flex justify-center py-1">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-meta",
          variant === "human" ? "bg-brand-soft font-semibold text-brand-deep" : "text-muted",
        )}
      >
        {variant === "human" && <BadgeCheck className="size-3.5" />}
        {text}
      </span>
    </div>
  );
}

export function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 pl-10 text-meta text-ai">
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className="size-1.5 animate-bounce rounded-full bg-ai/60" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </span>
      {label}
    </div>
  );
}
