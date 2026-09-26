"use client";

import { Check, Crown, Loader2 } from "lucide-react";
import { useState } from "react";
import { SubscriptionBadge, VerifiedMark } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Photo } from "@/components/ui/Photo";
import { TopBar } from "@/components/ui/TopBar";
import { startSubscriptionCheckout } from "@/lib/services/payments";
import type { Creator, Tier } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatPrice } from "@/lib/utils/format";

interface Plan {
  tier: Tier;
  name: string;
  price: number;
  perks: string[];
}

export function SubscriptionPlans({ creator, currentTier }: { creator: Creator; currentTier?: Tier }) {
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
      perks: ["구독자 전용 Moment", "오늘의 Moment 기반 Creator AI 대화 (하루 30회)", "지난 30일 Archive"],
    },
    {
      tier: "premium",
      name: "Premium",
      price: creator.pricing.premium,
      perks: [
        "Premium 전용 Moment (음성 인사, 비하인드)",
        "Creator AI 대화 무제한 · Fan Memory",
        "크리에이터 본인의 직접 답장 기회",
        "전체 Archive",
      ],
    },
  ];

  const [selected, setSelected] = useState<Tier>(currentTier === "premium" ? "premium" : "subscriber");
  const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
  const plan = plans.find((p) => p.tier === selected)!;

  async function checkout() {
    setStatus("loading");
    await startSubscriptionCheckout(creator.id, selected);
    setStatus("done");
  }

  if (status === "done") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-8 text-center">
        <Avatar src={creator.avatarUrl} name={creator.name} size="2xl" ring="today" />
        <SubscriptionBadge tier={selected} className="mt-5" />
        <h1 className="mt-3 text-title font-bold">
          이제 {creator.name.slice(1)}의 하루를
          <br />더 가까이에서 함께해요
        </h1>
        <p className="mt-2 text-sub text-muted">프로토타입에서는 실제 결제가 이루어지지 않아요.</p>
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
        <p className="px-1 pt-1 text-meta leading-relaxed text-muted">
          Creator AI는 {creator.name} 님이 공개를 허락한 오늘의 Moment만 참고해요. AI 답변은 항상 AI로 표시되며, 크리에이터 본인의 말과
          구분돼요.
        </p>
      </section>

      <div className="sticky bottom-0 mt-6 border-t border-line bg-canvas/90 px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur-md">
        <Button
          size="lg"
          block
          disabled={status === "loading" || selected === currentTier}
          onClick={checkout}
        >
          {status === "loading" && <Loader2 className="size-5 animate-spin" />}
          {selected === currentTier
            ? "이미 이용 중인 플랜이에요"
            : plan.price
              ? `${formatPrice(plan.price)} / 월 구독 시작하기`
              : "무료로 팔로우하기"}
        </Button>
      </div>
    </main>
  );
}
