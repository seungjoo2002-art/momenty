"use client";

import { Bell, Brain, ChevronRight, CreditCard, HelpCircle, Loader2, LogOut, Repeat, Shield } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount } from "@/components/auth/AuthProvider";
import { SubscriptionBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError } from "@/components/ui/LoadState";
import { ListGroup, ListRow, SectionHeader, Stat } from "@/components/ui/primitives";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { signOut } from "@/lib/services/auth";
import { getCreators } from "@/lib/services/creators";
import { getCurrentFan, getSavedMomentIds } from "@/lib/services/fan";
import { formatShortDate } from "@/lib/utils/format";

/** My — 로그인한 사용자의 실제 프로필 · 팔로우 · 보관함 */
export default function MyPage() {
  const account = useAccount();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const { data, error, retry } = useMomentData(`my:${account?.userId ?? ""}`, async () => {
    const [fan, creators, saved] = await Promise.all([getCurrentFan(), getCreators(), getSavedMomentIds()]);
    return { fan, creators, savedCount: saved.length };
  });

  async function logout() {
    setLeaving(true);
    setLogoutError(null);
    try {
      await signOut();
      router.replace("/login");
    } catch (e) {
      setLogoutError(e instanceof Error ? e.message : "로그아웃하지 못했어요.");
      setLeaving(false);
    }
  }

  if (!account) return <main className="min-h-dvh" />;
  const subs = data?.fan.subscriptions ?? [];
  const paid = subs.filter((s) => s.tier !== "follow");

  return (
    <main className="animate-fade-in">
      {/* 프로필 — 카드 없이 */}
      <section className="flex items-center gap-3.5 px-5 pt-6">
        <Avatar src={account.avatarUrl || undefined} name={account.nickname || account.email} size="xl" />
        <div className="min-w-0">
          <p className="truncate text-section font-semibold">{account.nickname || "이름 없음"}</p>
          <p className="truncate text-caption text-muted">{account.email}</p>
          {account.joinedAt && <p className="mt-0.5 text-meta text-faint">{formatShortDate(account.joinedAt)}부터 함께하는 중</p>}
        </div>
      </section>
      <div className="mx-5 mt-5 grid grid-cols-3 rounded-card border border-line bg-surface py-3.5 text-center">
        <Stat value={data ? subs.length : "·"} label="팔로잉" />
        <Stat value={data ? paid.length : "·"} label="구독" className="border-x border-line" />
        <Stat value={data ? data.savedCount : "·"} label="보관한 Moment" />
      </div>

      <section className="mt-7">
        <SectionHeader title="팔로잉 · 구독" />
        {error && !data && <LoadError message={error} onRetry={retry} className="py-6" />}
        {data && subs.length === 0 && (
          <p className="px-5 text-sub text-muted">
            아직 팔로우한 크리에이터가 없어요.{" "}
            <Link href="/discover" className="font-semibold text-brand">
              둘러보기
            </Link>
          </p>
        )}
        <ul>
          {subs.map((s) => {
            const c = data?.creators.find((x) => x.id === s.creatorId);
            if (!c) return null;
            return (
              <li key={s.creatorId}>
                <Link href={`/creators/${c.id}/today`} className="flex items-center gap-3 px-5 py-2.5 active:bg-brand-tint">
                  <Avatar src={c.avatarUrl} name={c.name} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sub font-semibold">{c.name}</p>
                    <p className="text-meta text-muted">{s.tier === "follow" ? "무료 팔로우" : s.renewsAt ? `갱신 ${formatShortDate(s.renewsAt)}` : "구독 중"}</p>
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
          <ListRow href="/my/memory" icon={<Brain className="size-[18px]" />} label="AI Memory" description="Creator AI가 기억하는 나 · 보기와 삭제" />
          <ListRow icon={<Bell className="size-[18px]" />} label="알림" />
          <ListRow icon={<CreditCard className="size-[18px]" />} label="결제 수단" />
          <ListRow icon={<Shield className="size-[18px]" />} label="개인정보 · 안전" />
          <ListRow icon={<HelpCircle className="size-[18px]" />} label="고객센터" />
        </ListGroup>
      </section>

      <Link href={account.creator ? "/studio" : "/setup/creator"} className="pressable mx-5 mt-5 flex items-center gap-3 rounded-card bg-brand-tint px-4 py-3.5">
        <span className="grid size-9 place-items-center rounded-full bg-brand text-white">
          <Repeat className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sub font-semibold">{account.creator ? "크리에이터 모드로 전환" : "크리에이터로 시작하기"}</p>
          <p className="text-meta text-muted">나의 하루도 Moment로 남겨보세요</p>
        </div>
        <ChevronRight className="size-4 text-faint" />
      </Link>

      <div className="mt-5 px-5">
        <button type="button" onClick={logout} disabled={leaving} className="inline-flex h-10 items-center gap-2 text-caption text-muted disabled:opacity-60">
          {leaving ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          로그아웃
        </button>
        {logoutError && <p role="alert" className="text-caption text-danger">{logoutError}</p>}
      </div>
    </main>
  );
}
