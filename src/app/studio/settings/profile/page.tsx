"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthProvider";
import { useStudioCreator } from "@/components/auth/Gates";
import { CreatorProfileForm } from "@/components/creator/CreatorProfileForm";
import { TopBar } from "@/components/ui/TopBar";
import { updateCreatorProfile } from "@/lib/services/creators";

/** 크리에이터 본인 프로필 수정 (다른 사람의 프로필은 DB가 거부한다) */
export default function ProfileSettingsPage() {
  const creator = useStudioCreator();
  const { refresh } = useAuth();
  const router = useRouter();

  return (
    <main className="flex min-h-dvh flex-col pb-8">
      <TopBar backHref="/studio/settings" title="프로필 편집" center />
      <div className="flex flex-1 flex-col px-6 pt-4">
        <CreatorProfileForm
          key={creator.id}
          creatorId={creator.id}
          initial={{ name: creator.name, handle: creator.handle, job: creator.job, bio: creator.bio, category: creator.category, avatarUrl: creator.avatarUrl }}
          submitLabel="저장"
          onSubmit={async (input) => {
            await updateCreatorProfile(creator.id, input);
            await refresh();
            router.push("/studio/settings");
          }}
        />
      </div>
    </main>
  );
}
