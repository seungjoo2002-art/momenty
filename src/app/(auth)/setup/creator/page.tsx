"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAccount, useAuth } from "@/components/auth/AuthProvider";
import { CreatorProfileForm } from "@/components/creator/CreatorProfileForm";
import { TopBar } from "@/components/ui/TopBar";
import { createCreatorProfile } from "@/lib/services/creators";

/** 크리에이터 프로필 만들기 — 끝나면 Studio로 */
export default function CreatorSetupPage() {
  const router = useRouter();
  const account = useAccount();
  const { refresh } = useAuth();

  // 이미 크리에이터면 Studio로
  useEffect(() => {
    if (account?.creator) router.replace("/studio");
  }, [account, router]);

  if (!account || account.creator) return <main aria-busy className="min-h-dvh" />;

  return (
    <main className="flex min-h-dvh flex-col">
      <TopBar backHref="/today" />
      <div className="flex flex-1 flex-col px-6 pb-8">
        <h1 className="mt-2 text-title leading-snug font-bold">크리에이터 프로필</h1>
        <p className="mt-1.5 mb-7 text-body text-muted">팬이 나를 알아볼 수 있도록 알려 주세요.</p>
        <CreatorProfileForm
          initial={{ name: account.nickname, handle: "", bio: "", category: "", avatarUrl: account.avatarUrl }}
          submitLabel="Studio 시작하기"
          onSubmit={async (input) => {
            await createCreatorProfile(input);
            await refresh();
            router.replace("/studio");
          }}
        />
      </div>
    </main>
  );
}
