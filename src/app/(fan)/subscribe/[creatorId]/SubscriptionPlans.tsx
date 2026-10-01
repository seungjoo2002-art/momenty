"use client";

import { Check, Crown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "@/components/auth/AuthProvider";
import { SubscriptionBadge, VerifiedMark } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Photo } from "@/components/ui/Photo";
import { TopBar } from "@/components/ui/TopBar";
import { FEATURES } from "@/lib/constants";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { follow, getTier, qaSetSubscription } from "@/lib/services/fan";
import type { Creator, Tier } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatPrice, shortName } from "@/lib/utils/format";

interface Plan {
  tier: Tier;
  name: string;
  price: number;
  perks: string[];
}

/**
 * 플랜 안내. 무료 팔로우는 실제로 저장된다.
 * 유료 구독(구독 · Premium)은 결제 연동 전이라 시작할 수 없다 — 결제 없이 등급을 올리는 경로는 없다 (DB도 거부).
 * 예외: QA 모드(서버 설정 · qaEnabled)에서만 "QA 구독" 버튼 — 서버 API가 실제 subscriptions 행을 바꾼다 (실제 결제 없음).
 */
export function SubscriptionPlans({ creator, qaEnabled = false }: { creator: Creator; qaEnabled?: boolean }) {
  const router = useRouter();
  const [qaBusy, setQaBusy] = useState(false);
  const account = useAccount();
  const { data } = useMomentData(`tier:${creator.id}:${account?.userId ?? ""}`, async () => ({ tier: await getTier(creator.id) }));
  const currentTier = data?.tier;
  const isOwner = account?.creator?.id === creator.id;
  const plans: Plan[] = [
    {
      tier: "follow",
      name: "팔로우",
      price: 0,
      perks: ["전체 공개 Moment", "오늘의 Today 타임라인"],
    },
    {
      tier: "subscriber",
      name: "구독",
      price: creator.pricing.subscriber,
      perks: ["구독자 전용 Moment", "지난 30일 Archive"],
    },
    {
      tier: "premium",
      name: "Premium",
      price: creator.pricing.premium,
      perks: [
        "Premium 전용 Moment (음성 인사, 비하인드)",
        "전체 Archive",
      ],
    },
  ];

  const [selected, setSelected] = useState<Tier>("follow");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const plan = plans.find((p) => p.tier === selected)!;
  const paid = selected !== "follow";
  const alreadyIn = !!currentTier && (currentTier === selected || (selected === "follow" && currentTier !== "follow"));

  // QA 전용: 서버가 내 구독 등급만 바꾼다 (해제는 follow로 — 대화 · 환영 메시지는 그대로)
  async function runQa(target: Tier) {
    setQaBusy(true);
    setError(null);
    try {
      await qaSetSubscription(creator.id, target);
      if (target === "follow") setSelected("follow");
      else router.push(`/chat/${creator.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "QA 구독을 바꾸지 못했어요.");
    } finally {
      setQaBusy(false);
    }
  }

  async function start() {
    if (paid) return; // 결제 연동 전
    setStatus("loading");
    setError(null);
    try {
      await follow(creator.id);
      setStatus("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "팔로우하지 못했어요.");
      setStatus("idle");
    }
  }

  if (status === "done") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <Avatar src={creator.avatarUrl} name={creator.name} size="2xl" ring="today" />
        <SubscriptionBadge tier={selected} className="mt-5" />
        <h1 className="mt-3 text-title font-bold">
          이제 {shortName(creator.name)}의 하루를
          <br />함께 따라가요
        </h1>
        <p className="mt-2 text-sub text-muted">공개 Moment가 Today에 바로 이어져요.</p>
        <div className="mt-8 w-full space-y-2">
          <ButtonLink href={`/creators/${creator.id}/today`} size="lg" block>
            오늘의 하루 보러 가기
          </ButtonLink>
          <ButtonLink href="/today" variant="ghost" size="lg" block>
            Today 홈으로
          </ButtonLink>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col">
      <TopBar title="구독" backHref={`/creators/${creator.id}`} />

      <section className="px-4 pt-4">
        <Photo src={creator.coverUrl} alt="" className="aspect-[16/9] rounded-[28px]">
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          <div className="absolute inset-x-4 bottom-4 flex items-center gap-3 text-white">
            <Avatar src={creator.avatarUrl} name={creator.name} size="md" />
            <div>
              <div className="flex items-center gap-1 text-name font-semibold">
                {creator.name}
                {creator.verified && <VerifiedMark className="size-4" />}
              </div>
              <p className="text-caption opacity-85">{creator.job}</p>
            </div>
          </div>
        </Photo>
      </section>

      <section className="flex-1 space-y-3 px-4 pt-6">
        {plans.map((p) => {
          const active = selected === p.tier;
          const isCurrent = currentTier === p.tier;
          return (
            <button
              key={p.tier}
              type="button"
              onClick={() => setSelected(p.tier)}
              className={cn(
                "w-full rounded-card border bg-surface p-5 text-left transition-all",
                active ? "border-brand ring-4 ring-brand/10" : "border-line",
              )}
            >
              <div className="flex items-center gap-2">
                {p.tier === "premium" && <Crown className="size-4 text-premium" />}
                <span className="text-name font-semibold">{p.name}</span>
                {isCurrent && (
                  <span className="rounded-full bg-canvas px-2 py-0.5 text-micro font-medium text-muted">현재 플랜</span>
                )}
                <span className="ml-auto text-name font-semibold">
                  {p.price ? formatPrice(p.price) : "무료"}
                  {p.price > 0 && <span className="text-meta font-normal text-muted">/월</span>}
                </span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {p.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-sub text-ink-2">
                    <Check className={cn("mt-0.5 size-4 shrink-0", active ? "text-brand" : "text-faint")} />
                    {perk}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </section>

      <div className="sticky bottom-0 mt-6 border-t border-line bg-canvas/90 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur-md">
        {error && <p role="alert" className="mb-2 text-center text-caption text-danger">{error}</p>}
        {paid && !FEATURES.payments && !alreadyIn && !qaEnabled && (
          <p className="mb-2 text-center text-meta text-muted">유료 구독은 결제 연동 후 열려요. 지금은 무료 팔로우로 함께할 수 있어요.</p>
        )}
        <Button size="lg" block disabled={!data || isOwner || status === "loading" || alreadyIn || paid} onClick={start}>
          {status === "loading" && <Loader2 className="size-5 animate-spin" />}
          {isOwner
            ? "내 채널이에요"
            : alreadyIn
              ? "이미 이용 중인 플랜이에요"
              : paid
                ? `${formatPrice(plan.price)} / 월 · 결제 준비 중`
                : "무료로 팔로우하기"}
        </Button>
        {qaEnabled && !isOwner && data && (
          <div className="mt-2 rounded-tile border border-dashed border-line-strong px-3 py-2.5">
            <div className="flex gap-2">
              {paid && !alreadyIn && (
                <Button size="sm" variant="secondary" className="flex-1" disabled={qaBusy} onClick={() => runQa(selected)}>
                  {qaBusy && <Loader2 className="size-4 animate-spin" />}
                  {selected === "premium" ? "QA Premium 시작" : "QA 구독 시작"}
                </Button>
              )}
              {(currentTier === "subscriber" || currentTier === "premium") && (
                <Button size="sm" variant="ghost" className="flex-1" disabled={qaBusy} onClick={() => runQa("follow")}>
                  QA 구독 해제
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-center text-micro text-faint">개발용 · 실제 결제가 발생하지 않습니다.</p>
          </div>
        )}
      </div>
    </main>
  );
}
