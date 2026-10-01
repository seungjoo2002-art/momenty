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
          <ListRow href="/studio/settings/profile" icon={<UserRound className={icon} />} label="프로필 편집" description="활동명 · 아이디 · 직업 · 사진 · 소개 · 카테고리" />
          <ListRow href="/studio/records" icon={<FolderClock className={icon} />} label="내 기록 (Records)" description="지금까지 남긴 하루들" />
          <ListRow icon={<CreditCard className={icon} />} label="구독 가격 · 정산" description="결제 연동 후 열려요" />
          <ListRow icon={<Bell className={icon} />} label="알림" />
          <ListRow href="/my/account/delete" icon={<UserRound className={icon} />} label="계정 삭제" description="채널 · Moment · 파일을 모두 지워요" />
        </ListGroup>
      </section>

      <section className="mt-7">
        <SectionHeader title="AI Avatar & 안전" caption="나를 닮은 공식 AI Avatar와 그 한계" />
        <ListGroup>
          <ListRow href="/studio/settings/avatar" icon={<MessagesSquare className={icon} />} label="AI Avatar" description="AI 문답 ON/OFF · 기본정보 · 말투 학습 · 성향" />
          <ListRow href="/studio/settings/persona#boundaries" icon={<Ban className={icon} />} label="대화 경계 · 확인된 사실" description="AI가 답하지 않을 주제 · 사실로 말해도 되는 것" />
          <ListRow href="/studio/settings/welcome" icon={<Bell className={icon} />} label="구독 환영 메시지" description="새 구독자에게 한 번 보내는 자동 메시지" />
          <ListRow href="/studio/settings/safeshare" icon={<ShieldCheck className={icon} />} label="SafeShare · Safe Delay" description="위치 정보 제거 · 사진 속 개인정보 확인 · 공개 지연" />
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
