"use client";

import { Ban, Bell, CreditCard, FolderClock, Loader2, LogOut, MessagesSquare, Repeat, ShieldCheck, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { ListGroup, ListRow, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { signOut } from "@/lib/services/auth";

const icon = "size-[18px]";

export default function StudioSettingsPage() {
  const creator = useStudioCreator();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    setLeaving(true);
    setError(null);
    try {
      await signOut();
      router.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "로그아웃하지 못했어요.");
      setLeaving(false);
    }
  }

  return (
    <main className="animate-fade-in">
      <PageHeader title="설정" />

      <section className="flex items-center gap-3 px-5">
        <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-name font-semibold">{creator.name}</p>
          <p className="truncate text-caption text-muted">@{creator.handle}</p>
        </div>
        <ButtonLink href={`/creators/${creator.id}/today`} variant="secondary" size="sm">
          팬 화면 보기
        </ButtonLink>
      </section>

      <section className="mt-7">
        <SectionHeader title="계정" />
        <ListGroup>
          <ListRow href="/studio/settings/profile" icon={<UserRound className={icon} />} label="프로필 편집" description="이름 · 사용자 이름 · 사진 · 소개 · 카테고리" />
          <ListRow href="/studio/records" icon={<FolderClock className={icon} />} label="내 기록 (Records)" description="지금까지 남긴 하루들" />
          <ListRow icon={<CreditCard className={icon} />} label="구독 가격 · 정산" description="결제 연동 후 열려요" />
          <ListRow icon={<Bell className={icon} />} label="알림" />
        </ListGroup>
      </section>

      <section className="mt-7">
        <SectionHeader title="Creator AI & 안전" caption="Creator AI와 함께 열려요" />
        <ListGroup>
          <ListRow icon={<MessagesSquare className={icon} />} label="Persona" description="말투, 참고할 Moment 범위" />
          <ListRow icon={<Ban className={icon} />} label="Boundary" description="AI가 답하지 않을 주제와 질문" />
          <ListRow icon={<ShieldCheck className={icon} />} label="SafeShare" description="위치 · 얼굴 · 개인정보 보호" />
        </ListGroup>
      </section>

      <div className="mx-5 mt-6">
        <ButtonLink href="/today" variant="secondary" block>
          <Repeat className="size-4" />팬 모드로 전환
        </ButtonLink>
      </div>
      <div className="mt-3 px-5">
        <button type="button" onClick={logout} disabled={leaving} className="inline-flex h-10 items-center gap-2 text-caption text-muted disabled:opacity-60">
          {leaving ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          로그아웃
        </button>
        {error && <p role="alert" className="text-caption text-danger">{error}</p>}
      </div>
    </main>
  );
}
