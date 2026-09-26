"use client";

import { Bookmark, Check, Heart, Link2, Send, SmilePlus } from "lucide-react";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { toggleLove } from "@/lib/services/moments";
import type { Moment } from "@/lib/types";
import { totalReactions } from "@/lib/utils/access";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";
import { ReactionBar } from "./ReactionBar";

/**
 * Moment 상세 하단의 액션: 좋아요 · 반응 · 저장 · 공유
 * 좋아요(♥︎)는 저장소에 반영된다. 네 가지 반응 · 보관은 아직 화면 상태만 바뀐다.
 */
export function MomentActions({ moment, initialSaved }: { moment: Moment; initialSaved: boolean }) {
  const { reactions } = moment;
  const liked = moment.likedByMe ?? false;
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  function like() {
    setPending(true);
    setNotice(null);
    toggleLove(moment.id)
      .catch((e: unknown) => setNotice(e instanceof Error ? e.message : "반응을 남기지 못했어요."))
      .finally(() => setPending(false));
  }
  const [saved, setSaved] = useState(initialSaved);
  const [sheet, setSheet] = useState<"react" | "share" | null>(null);
  const [copied, setCopied] = useState(false);

  const item = "pressable flex h-11 min-w-11 items-center gap-1.5 rounded-full px-2 text-caption text-white";

  return (
    <>
      <div className="flex items-center gap-1">
        <button type="button" onClick={like} disabled={pending} aria-pressed={liked} aria-label="좋아요" className={item}>
          <Heart className={cn("size-[22px] transition-transform duration-150", liked && "scale-110 fill-brand-2 text-brand-2")} strokeWidth={1.7} />
          <span className="tabular-nums">{formatCount(reactions.love)}</span>
        </button>
        <button type="button" onClick={() => setSheet("react")} aria-label="반응 남기기" className={item}>
          <SmilePlus className="size-[22px]" strokeWidth={1.7} />
          <span className="tabular-nums">{formatCount(totalReactions(reactions) - reactions.love)}</span>
        </button>
        <div className="flex-1" />
        <button type="button" onClick={() => setSaved(!saved)} aria-pressed={saved} aria-label={saved ? "보관 취소" : "Archive에 보관"} className={item}>
          <Bookmark className={cn("size-[22px]", saved && "fill-white")} strokeWidth={1.7} />
        </button>
        <button type="button" onClick={() => setSheet("share")} aria-label="공유" className={item}>
          <Send className="size-[21px]" strokeWidth={1.7} />
        </button>
      </div>
      {notice && <p role="status" className="px-2 pb-1 text-meta text-white/60">{notice}</p>}

      <BottomSheet open={sheet === "react"} onClose={() => setSheet(null)} title="이 순간에 반응하기">
        <ReactionBar reactions={reactions} />
      </BottomSheet>

      <BottomSheet
        open={sheet === "share"}
        onClose={() => {
          setSheet(null);
          setCopied(false);
        }}
        title="공유하기"
      >
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
            } catch {
              /* 클립보드 권한이 없어도 조용히 넘어간다 */
            }
            setCopied(true);
          }}
          className="pressable flex h-12 w-full items-center gap-3 rounded-tile bg-canvas px-4 text-sub"
        >
          {copied ? <Check className="size-5 text-safe" /> : <Link2 className="size-5 text-ink-2" />}
          {copied ? "링크를 복사했어요" : "링크 복사"}
        </button>
        <p className="mt-3 text-meta text-muted">구독자 전용 Moment는 구독한 팬에게만 열려요.</p>
      </BottomSheet>
    </>
  );
}
