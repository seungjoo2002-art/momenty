"use client";

import { useState } from "react";
import type { ReactionKey, Reactions } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";
import { REACTIONS } from "./meta";

/** 네 가지 반응 선택 (Moment 상세의 반응 시트). Timeline에서는 가벼운 ReactionButton을 쓴다. */
export function ReactionBar({ reactions, onPick }: { reactions: Reactions; onPick?: (key: ReactionKey | null) => void }) {
  const [mine, setMine] = useState<ReactionKey | null>(null);

  return (
    <div className="grid grid-cols-4 gap-2">
      {REACTIONS.map((r) => {
        const active = mine === r.key;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => {
              const next = active ? null : r.key;
              setMine(next);
              onPick?.(next);
            }}
            aria-pressed={active}
            className={cn(
              "pressable flex flex-col items-center gap-1 rounded-tile py-3",
              active ? "bg-brand-soft ring-1 ring-brand/30" : "bg-canvas",
            )}
          >
            <span className={cn("text-[22px] transition-transform duration-150", active && "scale-110")}>{r.emoji}</span>
            <span className={cn("text-meta", active ? "font-semibold text-brand-deep" : "text-ink-2")}>{r.label}</span>
            <span className="text-micro text-muted tabular-nums">{formatCount(reactions[r.key] + (active ? 1 : 0))}</span>
          </button>
        );
      })}
    </div>
  );
}
