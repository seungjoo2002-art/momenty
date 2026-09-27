"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount, useAuth } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/primitives";
import { CATEGORY_LABEL } from "@/lib/constants";
import { saveInterests } from "@/lib/services/auth";
import type { CategoryKey } from "@/lib/types";

/** 팬 온보딩: 관심 카테고리 → Discover (고른 카테고리의 크리에이터가 먼저 보인다) */
export default function InterestsPage() {
  const router = useRouter();
  const account = useAccount();
  const { refresh } = useAuth();
  const [picked, setPicked] = useState<CategoryKey[]>(account?.interests ?? []);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (k: CategoryKey) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]));

  async function finish(list: CategoryKey[]) {
    setPending(true);
    setError(null);
    try {
      await saveInterests(list);
      await refresh();
      router.replace("/discover");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col px-6 pt-12 pb-8">
      <h1 className="text-title leading-snug font-bold">
        {account?.nickname ? `${account.nickname}님,` : ""}
        <br />
        어떤 하루가 궁금하세요?
      </h1>
      <p className="mt-1.5 text-body text-muted">고른 분야의 크리에이터를 먼저 보여드릴게요.</p>

      <div className="mt-8 flex flex-wrap gap-2">
        {(Object.keys(CATEGORY_LABEL) as CategoryKey[]).map((k) => (
          <Chip key={k} active={picked.includes(k)} onClick={() => toggle(k)} className="h-10 px-4 text-sub">
            {CATEGORY_LABEL[k]}
          </Chip>
        ))}
      </div>

      {error && <p role="alert" className="mt-4 text-caption text-danger">{error}</p>}
      <div className="mt-auto space-y-2 pt-8">
        <Button size="lg" block disabled={pending || picked.length === 0} onClick={() => finish(picked)}>
          {pending && <Loader2 className="size-5 animate-spin" />}
          크리에이터 찾아보기
        </Button>
        <Button variant="ghost" size="lg" block disabled={pending} onClick={() => finish([])}>
          나중에 고를게요
        </Button>
      </div>
    </main>
  );
}
