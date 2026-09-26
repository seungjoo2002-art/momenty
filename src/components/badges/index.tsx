import { BadgeCheck, Crown, Globe, Lock, ShieldCheck, Users } from "lucide-react";
import type { SafeShareFlag, Tier, Visibility } from "@/lib/types";
import { cn } from "@/lib/utils/cn";

const pill = "inline-flex h-5 items-center gap-0.5 rounded-full px-2 text-micro font-medium whitespace-nowrap";

/* ---------- 구독 등급 ---------- */

const TIER_STYLE: Record<Tier, { label: string; className: string }> = {
  follow: { label: "팔로잉", className: "bg-canvas text-muted ring-1 ring-line-strong ring-inset" },
  subscriber: { label: "구독중", className: "bg-brand-soft text-brand-deep" },
  premium: { label: "Premium", className: "bg-premium-soft text-premium" },
};

export function SubscriptionBadge({ tier, className }: { tier: Tier; className?: string }) {
  const s = TIER_STYLE[tier];
  return (
    <span className={cn(pill, s.className, className)}>
      {tier === "premium" && <Crown className="size-3" />}
      {s.label}
    </span>
  );
}

/* ---------- 공개범위 ---------- */

export const VISIBILITY_META: Record<Visibility, { label: string; icon: typeof Globe; description: string }> = {
  public: { label: "전체", icon: Globe, description: "팔로워를 포함한 모든 사람" },
  subscribers: { label: "구독자", icon: Users, description: "구독 중인 팬에게만" },
  premium: { label: "Premium", icon: Crown, description: "Premium 구독자에게만" },
};

export function VisibilityBadge({
  visibility,
  locked,
  className,
}: {
  visibility: Visibility;
  locked?: boolean;
  className?: string;
}) {
  const meta = VISIBILITY_META[visibility];
  const Icon = locked ? Lock : meta.icon;
  return (
    <span
      className={cn(
        pill,
        visibility === "premium"
          ? "bg-premium-soft text-premium"
          : visibility === "subscribers"
            ? "bg-brand-soft text-brand-deep"
            : "bg-canvas text-muted",
        className,
      )}
    >
      <Icon className="size-3" />
      {meta.label}
    </span>
  );
}

/* ---------- SafeShare ---------- */

export const SAFE_SHARE_LABEL: Record<SafeShareFlag, string> = {
  location_delayed: "위치 지연 공개",
  location_removed: "위치 정보 제거",
  faces_blurred: "타인 얼굴 흐림",
};

export function SafetyBadge({ flag, className }: { flag: SafeShareFlag; className?: string }) {
  return (
    <span className={cn(pill, "bg-safe-soft text-safe", className)}>
      <ShieldCheck className="size-3" />
      {SAFE_SHARE_LABEL[flag]}
    </span>
  );
}

/* ---------- AI vs 실제 크리에이터 ---------- */

/** Creator AI 응답 표시. 아이콘 없이 조용한 slate 톤의 작은 텍스트 라벨. */
export function AIBadge({ className, label = "AI" }: { className?: string; label?: string }) {
  return (
    <span className={cn(pill, "h-[18px] bg-ai-soft px-1.5 font-semibold text-ai ring-1 ring-ai-line ring-inset", className)}>
      {label}
    </span>
  );
}

/** 실제 크리에이터 본인이 직접 쓴 메시지 표시 */
export function HumanBadge({ label = "본인 직접", className }: { label?: string; className?: string }) {
  return (
    <span className={cn(pill, "h-[18px] bg-brand px-1.5 font-semibold text-white", className)}>
      <BadgeCheck className="size-3" />
      {label}
    </span>
  );
}

export function VerifiedMark({ className }: { className?: string }) {
  return <BadgeCheck className={cn("size-4 fill-brand text-white", className)} aria-label="인증된 크리에이터" />;
}
