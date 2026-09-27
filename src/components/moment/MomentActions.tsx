"use client";

import { Bookmark, Check, Heart, Link2, Send, SmilePlus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "@/components/auth/AuthProvider";
import { loginHref } from "@/components/auth/Gates";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { toggleSaved } from "@/lib/services/fan";
import { toggleLove } from "@/lib/services/moments";
import type { Moment, ReactionKey } from "@/lib/types";
import { totalReactions } from "@/lib/utils/access";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";
import { ReactionBar } from "./ReactionBar";

/**
 * Moment 상세 하단의 액션: 좋아요 · 반응 · 보관 · 공유
 * 좋아요 · 반응 · 보관은 DB에 저장된다 (본인 것만 · 볼 수 있는 Moment만 — RLS).
 * 로그인하지 않았으면 로그인 후 이 Moment로 돌아온다.
 */
export function MomentActions({ moment, saved, myReactions }: { moment: Moment; saved: boolean; myReactions: ReactionKey[] }) {
  const account = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const { reactions } = moment;
  const liked = moment.likedByMe ?? false;
  const [pending, setPending] = useState<"like" | "save" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"react" | "share" | null>(null);
  const [copied, setCopied] = useState(false);

  function run(kind: "like" | "save", action: () => Promise<unknown>) {
    if (!account) {
      router.push(loginHref(pathname));
      return;
    }
    setPending(kind);
    setNotice(null);
    action()
      .catch((e: unknown) => setNotice(e instanceof Error ? e.message : "저장하지 못했어요."))
      .finally(() => setPending(null));
  }

  function openReactions() {
    if (!account) router.push(loginHref(pathname));
    else setSheet("react");
  }

  const item = "pressable flex h-11 min-w-11 items-center gap-1.5 rounded-full px-2 text-caption text-white disabled:opacity-60";

  return (
    <>
      <div className="flex items-center gap-1">
        <button type="button" onClick={() => run("like", () => toggleLove(moment.id))} disabled={pending === "like"} aria-pressed={liked} aria-label="좋아요" className={item}>
          <Heart className={cn("size-[22px] transition-transform duration-150", liked && "scale-110 fill-brand-2 text-brand-2")} strokeWidth={1.7} />
          <span className="tabular-nums">{formatCount(reactions.love)}</span>
        </button>
        <button type="button" onClick={openReactions} aria-label="반응 남기기" className={item}>
          <SmilePlus className="size-[22px]" strokeWidth={1.7} />
          <span className="tabular-nums">{formatCount(totalReactions(reactions) - reactions.love)}</span>
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => run("save", () => toggleSaved(moment.id, saved))}
          disabled={pending === "save"}
          aria-pressed={saved}
          aria-label={saved ? "보관 취소" : "Archive에 보관"}
          className={item}
        >
          <Bookmark className={cn("size-[22px]", saved && "fill-white")} strokeWidth={1.7} />
        </button>
        <button type="button" onClick={() => setSheet("share")} aria-label="공유" className={item}>
          <Send className="size-[21px]" strokeWidth={1.7} />
        </button>
      </div>
      {notice && <p role="status" className="px-2 pb-1 text-meta text-white/60">{notice}</p>}

      <BottomSheet open={sheet === "react"} onClose={() => setSheet(null)} title="이 순간에 반응하기">
        <ReactionBar momentId={moment.id} reactions={reactions} mine={myReactions} onError={setNotice} />
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
