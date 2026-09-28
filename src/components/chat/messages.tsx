import { BadgeCheck } from "lucide-react";
import Link from "next/link";
import { AIBadge, VerifiedMark } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import type { Creator, Moment } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatClock, formatTime } from "@/lib/utils/format";

/**
 * 세 종류의 말풍선은 절대 비슷해 보이지 않는다.
 *  - Creator AI : 흰 말풍선 + "🤖 {이름} AI" + "AI" 라벨 (크리에이터 본인의 말이 아니다)
 *  - 팬(나)     : 보라 말풍선, 흰 글자, 오른쪽
 *  - 실제 본인  : 라벤더 말풍선 + 보라 테두리 + "✓ {이름}" + "본인" 라벨, 아바타 보라 링 + "크리에이터가 직접 보낸 메시지"
 *  팬이 보낸 말풍선에는 누구에게 보냈는지(🤖 AI에게 / ✓ 이름에게 직접)를 작게 붙인다 — 한 방에 두 흐름이 섞여도 헷갈리지 않게.
 */

export function AIMessage({
  creator,
  text,
  createdAt,
  refMoments = [],
  remembered = false,
}: {
  creator: Pick<Creator, "name" | "avatarUrl">;
  text: string;
  createdAt: string;
  refMoments?: Pick<Moment, "id" | "createdAt">[];
  /** 이 대화에서 AI Memory에 기억한 것이 있음 — 관리 화면으로 가는 작은 표시 */
  remembered?: boolean;
}) {
  return (
    <div className="flex gap-2 pr-12">
      <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="ai" />
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1">
          <span className="text-meta text-ink-2">🤖 {creator.name} AI</span>
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
          {remembered && (
            <Link href="/my/memory" className="text-micro text-faint underline-offset-2 hover:text-ai hover:underline">
              · 기억했어요
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

export function CreatorMessage({
  creator,
  text,
  createdAt,
  onReport,
  reported = false,
}: {
  creator: Pick<Creator, "name" | "avatarUrl">;
  text: string;
  createdAt: string;
  /** 팬이 받은 메시지 신고 */
  onReport?: () => void;
  reported?: boolean;
}) {
  return (
    <div className="flex gap-2 pr-12">
      <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="human" />
      <div className="min-w-0">
        <div className="mb-1 flex items-center gap-1">
          <span className="text-meta font-semibold text-brand-deep">✓ {creator.name}</span>
          <VerifiedMark className="size-3.5" />
          <span className="rounded-full bg-brand px-1.5 py-px text-micro font-semibold text-white">본인</span>
        </div>
        <div className="rounded-[18px] rounded-tl-[6px] bg-brand-soft px-3.5 py-2.5 text-sub text-ink ring-1 ring-brand/25 ring-inset">
          {text}
        </div>
        <div className="mt-1 flex items-center gap-1.5 text-micro text-faint">
          <time>{formatClock(createdAt)}</time>
          <span>· 크리에이터가 직접 보낸 메시지</span>
          {reported ? <span>· 신고함</span> : onReport && (
            <button type="button" onClick={onReport} className="hover:text-danger">
              · 신고
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function FanMessage({ text, createdAt, to }: { text: string; createdAt: string; /** 누구에게 보낸 메시지인지 (예: "🤖 AI에게", "✓ 지훈에게 직접") */ to?: string }) {
  return (
    <div className="flex flex-col items-end pl-14">
      <div className="rounded-[18px] rounded-tr-[6px] bg-brand px-3.5 py-2.5 text-sub text-white">{text}</div>
      <time className="mt-1 text-micro text-faint">
        {to && <span className="mr-1">{to} ·</span>}
        {formatClock(createdAt)}
      </time>
    </div>
  );
}

/** (Studio) 크리에이터가 보는 팬의 직접 메시지 — 왼쪽 회색 말풍선 */
export function FanToCreatorMessage({
  name,
  avatarUrl,
  text,
  createdAt,
  onReport,
  reported = false,
}: {
  name: string;
  avatarUrl?: string | null;
  text: string;
  createdAt: string;
  onReport?: () => void;
  reported?: boolean;
}) {
  return (
    <div className="flex gap-2 pr-12">
      <Avatar src={avatarUrl || undefined} name={name} size="sm" />
      <div className="min-w-0">
        <p className="mb-1 text-meta text-ink-2">{name}</p>
        <div className="rounded-[18px] rounded-tl-[6px] bg-surface px-3.5 py-2.5 text-sub text-ink ring-1 ring-line ring-inset">{text}</div>
        <div className="mt-1 flex items-center gap-1.5 text-micro text-faint">
          <time>{formatClock(createdAt)}</time>
          {reported ? <span>· 신고함</span> : onReport && (
            <button type="button" onClick={onReport} className="hover:text-danger">
              · 신고
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** (Studio) 크리에이터 본인이 보낸 직접 메시지 — 오른쪽 */
export function OwnCreatorMessage({ text, createdAt }: { text: string; createdAt: string }) {
  return (
    <div className="flex flex-col items-end pl-14">
      <div className="rounded-[18px] rounded-tr-[6px] bg-brand px-3.5 py-2.5 text-sub text-white">{text}</div>
      <time className="mt-1 text-micro text-faint">✓ 직접 보냄 · {formatClock(createdAt)}</time>
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
