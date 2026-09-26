import { Bell, Brain, ChevronRight, CreditCard, HelpCircle, LogOut, Repeat, Shield } from "lucide-react";
import Link from "next/link";
import { SubscriptionBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { ListGroup, ListRow, SectionHeader, Stat } from "@/components/ui/primitives";
import { getCreators } from "@/lib/services/creators";
import { getCurrentFan } from "@/lib/services/fan";
import { formatPrice, formatShortDate } from "@/lib/utils/format";

export default async function MyPage() {
  const [fan, creators] = await Promise.all([getCurrentFan(), getCreators()]);
  const creatorOf = (id: string) => creators.find((c) => c.id === id)!;
  const paid = fan.subscriptions.filter((s) => s.tier !== "follow");
  const monthly = paid.reduce((sum, s) => sum + creatorOf(s.creatorId).pricing[s.tier as "subscriber" | "premium"], 0);

  return (
    <main className="animate-fade-in">
      {/* 프로필 — 카드 없이 */}
      <section className="flex items-center gap-3.5 px-5 pt-6">
        <Avatar src={fan.avatarUrl} name={fan.nickname} size="xl" />
        <div className="min-w-0">
          <p className="text-section font-semibold">{fan.nickname}</p>
          <p className="text-caption text-muted">@{fan.handle}</p>
          <p className="mt-0.5 text-meta text-faint">{formatShortDate(fan.joinedAt)}부터 함께하는 중</p>
        </div>
      </section>
      <div className="mx-5 mt-5 grid grid-cols-3 rounded-card border border-line bg-surface py-3.5 text-center">
        <Stat value={fan.subscriptions.length} label="팔로잉" />
        <Stat value={paid.length} label="구독" className="border-x border-line" />
        <Stat value={fan.savedMomentIds.length} label="보관한 Moment" />
      </div>

      <section className="mt-7">
        <SectionHeader title="구독 중" caption={`월 ${formatPrice(monthly)}`} />
        <ul>
          {fan.subscriptions.map((s) => {
            const c = creatorOf(s.creatorId);
            return (
              <li key={s.creatorId}>
                <Link href={`/creators/${c.id}/today`} className="flex items-center gap-3 px-5 py-2.5 active:bg-brand-tint">
                  <Avatar src={c.avatarUrl} name={c.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sub font-semibold">{c.name}</p>
                    <p className="text-meta text-muted">{s.renewsAt ? `다음 결제 ${formatShortDate(s.renewsAt)}` : "무료 팔로우"}</p>
                  </div>
                  <SubscriptionBadge tier={s.tier} />
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-7">
        <SectionHeader title="설정" />
        <ListGroup>
          <ListRow href="/my/memory" icon={<Brain className="size-[18px]" />} label="Fan Memory" description="Creator AI가 나에 대해 기억하는 것" />
          <ListRow icon={<Bell className="size-[18px]" />} label="알림" />
          <ListRow icon={<CreditCard className="size-[18px]" />} label="결제 수단" />
          <ListRow icon={<Shield className="size-[18px]" />} label="개인정보 · 안전" />
          <ListRow icon={<HelpCircle className="size-[18px]" />} label="고객센터" />
        </ListGroup>
      </section>

      <Link
        href="/studio"
        className="pressable mx-5 mt-5 flex items-center gap-3 rounded-card bg-brand-tint px-4 py-3.5"
      >
        <span className="grid size-9 place-items-center rounded-full bg-brand text-white">
          <Repeat className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sub font-semibold">크리에이터 모드로 전환</p>
          <p className="text-meta text-muted">나의 하루도 Moment로 남겨보세요</p>
        </div>
        <ChevronRight className="size-4 text-faint" />
      </Link>

      <div className="mt-5 px-5">
        <Link href="/onboarding" className="inline-flex h-10 items-center gap-2 text-caption text-muted">
          <LogOut className="size-4" />
          로그아웃
        </Link>
      </div>
    </main>
  );
}
