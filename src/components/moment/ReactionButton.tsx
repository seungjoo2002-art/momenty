"use client";

import { Heart } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "@/components/auth/AuthProvider";
import { loginHref } from "@/components/auth/Gates";
import { toggleLove } from "@/lib/services/moments";
import type { Moment } from "@/lib/types";
import { totalReactions } from "@/lib/utils/access";
import { cn } from "@/lib/utils/cn";
import { formatCount } from "@/lib/utils/format";

/**
 * Timeline 안의 가벼운 공감 버튼 (♡ → ♥︎). 네 가지 반응 선택은 Moment 상세에서.
 * 누르면 저장소의 love가 ±1 되고, 이 Moment를 보여주는 모든 화면이 함께 갱신된다.
 */
export function ReactionButton({
  moment,
  readOnly,
  tone = "default",
}: {
  moment: Pick<Moment, "id" | "reactions" | "likedByMe">;
  readOnly?: boolean;
  tone?: "default" | "dark";
}) {
  const [pending, setPending] = useState(false);
  const account = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const on = moment.likedByMe ?? false;
  const total = totalReactions(moment.reactions);
  const dark = tone === "dark";

  if (readOnly) {
    return (
      <span className={cn("inline-flex h-8 items-center gap-1 text-meta", dark ? "text-white/70" : "text-muted")}>
        <Heart className="size-[15px]" />
        <span className="tabular-nums">{formatCount(total)}</span>
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!account) {
          router.push(loginHref(pathname));
          return;
        }
        setPending(true);
        // 실패해도(네트워크 · 로그인 없음) 화면은 그대로 — 저장된 상태만 보여준다
        toggleLove(moment.id)
          .catch(() => {})
          .finally(() => setPending(false));
      }}
      aria-pressed={on}
      aria-label="좋아요"
      className={cn(
        "pressable -ml-1.5 inline-flex h-9 items-center gap-1 rounded-full px-1.5 text-caption",
        on ? "text-brand" : dark ? "text-white" : "text-ink-2",
      )}
    >
      <Heart className={cn("size-[18px] transition-transform duration-150", on && "scale-110 fill-brand text-brand")} strokeWidth={1.8} />
      <span className="tabular-nums">{formatCount(total)}</span>
    </button>
  );
}
