"use client";

import { Check, Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "@/components/auth/AuthProvider";
import { loginHref } from "@/components/auth/Gates";
import { Button } from "@/components/ui/Button";
import { follow, unfollow } from "@/lib/services/fan";
import type { Tier } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

/**
 * 무료 팔로우 토글 — public.subscriptions에 실제로 저장된다 (RLS: 본인 · tier = follow만).
 * 로그인하지 않았으면 로그인 후 이 화면으로 돌아온다. 유료 구독자에게는 보이지 않는다.
 */
export function FollowButton({
  creatorId,
  tier,
  className,
  variant = "secondary",
  size = "md",
}: {
  creatorId: string;
  tier?: Tier;
  className?: string;
  variant?: "secondary" | "primary" | "light";
  size?: "sm" | "md";
}) {
  const account = useAccount();
  const router = useRouter();
  const pathname = usePathname();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const following = tier === "follow";

  async function toggle() {
    if (!account) {
      router.push(loginHref(pathname));
      return;
    }
    setPending(true);
    setError(null);
    try {
      if (following) await unfollow(creatorId);
      else await follow(creatorId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className={cn("shrink-0", className)}>
      {/* 좁은 화면에서도 "팔로잉"이 두 줄로 나뉘지 않게: 줄바꿈 금지 + 최소 폭 (고정 폭을 두지 않는다) */}
      <Button
        variant={following ? "secondary" : variant}
        size={size}
        onClick={toggle}
        disabled={pending}
        aria-pressed={following}
        block
        className={cn("whitespace-nowrap", size === "sm" ? "min-w-[5.75rem] px-3" : "min-w-[6.5rem]")}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : following && <Check className="size-4" />}
        <span>{following ? "팔로잉" : "팔로우"}</span>
      </Button>
      {error && (
        <span role="alert" className="mt-1.5 block text-meta text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
