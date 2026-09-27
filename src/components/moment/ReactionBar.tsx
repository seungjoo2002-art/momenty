"use client";

import { useState } from "react";
import { toggleReaction } from "@/lib/services/moments";
import type { ReactionKey, Reactions } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";
import { REACTIONS } from "./meta";

/**
 * 네 가지 반응 (Moment 상세의 반응 시트) — moment_reactions에 실제로 저장된다.
 * 여러 개를 함께 남길 수 있고, 다시 누르면 취소된다. 개수는 저장 후 DB에서 다시 읽은 값.
 */
export function ReactionBar({
  momentId,
  reactions,
  mine,
  onError,
}: {
  momentId: string;
  reactions: Reactions;
  mine: ReactionKey[];
  onError?: (message: string) => void;
}) {
  const [pending, setPending] = useState<ReactionKey | null>(null);

  async function pick(key: ReactionKey) {
    setPending(key);
    try {
      await toggleReaction(momentId, key);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : "반응을 남기지 못했어요.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="grid grid-cols-4 gap-2">
      {REACTIONS.map((r) => {
        const active = mine.includes(r.key);
        return (
          <button
            key={r.key}
            type="button"
            disabled={pending !== null}
            onClick={() => pick(r.key)}
            aria-pressed={active}
            className={cn(
              "pressable flex flex-col items-center gap-1 rounded-tile py-3 disabled:opacity-70",
              active ? "bg-brand-soft ring-1 ring-brand/30" : "bg-canvas",
            )}
          >
            <span className={cn("text-[22px] transition-transform duration-150", active && "scale-110")}>{r.emoji}</span>
            <span className={cn("text-meta", active ? "font-semibold text-brand-deep" : "text-ink-2")}>{r.label}</span>
            <span className="text-micro text-muted tabular-nums">{formatCount(reactions[r.key])}</span>
          </button>
        );
      })}
    </div>
  );
}
