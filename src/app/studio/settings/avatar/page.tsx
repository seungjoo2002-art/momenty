"use client";

import { Check, ChevronRight, Loader2, MessageCircleHeart, NotebookPen, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useStudioCreator } from "@/components/auth/Gates";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { ListGroup, ListRow } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { avatarProgress, BASIC_KEYS, firstIncompleteStep } from "@/lib/avatar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { AVATAR_NOT_READY_MESSAGE, getAvatarOverview, setAvatarEnabled } from "@/lib/services/avatar";
import { cn } from "@/lib/utils/cn";

/**
 * Studio → 설정 → AI Avatar. "내 AI를 만든다" — 4단계 진행률과 AI 문답 ON/OFF.
 * ON은 DB가 한 번 더 확인한다 (기본정보 · 필수 말투 문답 · 성향 · 대화 경계). OFF는 언제든.
 */
export default function AvatarHubPage() {
  const creator = useStudioCreator();
  const router = useRouter();
  const { refresh } = useAuth();
  const { data, error, retry } = useMomentData(`avatar:${creator.id}`, () => getAvatarOverview(creator.id));
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;

  const r = data.readiness;
  const on = enabled ?? data.enabled;
  const progress = avatarProgress(r, on);
  const basicsDone = (r.basics.job ? 1 : 0) + BASIC_KEYS.length - r.basics.missing.length;

  async function toggle(next: boolean) {
    setNotice(null);
    if (next && !r.ready) {
      setNotice(AVATAR_NOT_READY_MESSAGE);
      router.push(firstIncompleteStep(r));
      return;
    }
    setBusy(true);
    try {
      await setAvatarEnabled(creator.id, next);
      setEnabled(next);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }

  const steps = [
    { n: 1, title: "나에 대해 알려주세요", detail: `기본정보 ${basicsDone} / ${BASIC_KEYS.length + 1}`, done: r.basics.done, href: "/studio/settings/avatar/basics", icon: <UserRound className="size-[18px]" /> },
    {
      n: 2,
      title: "내 말투를 알려주세요",
      detail: `${r.style.answered} / ${r.style.total} 문답 · 최소 ${r.style.minimum}개${r.style.requiredMissing.length ? ` · 필수 ${r.style.requiredMissing.length}개 남음` : ""}`,
      done: r.style.done,
      href: "/studio/settings/avatar/training",
      icon: <MessageCircleHeart className="size-[18px]" />,
    },
    { n: 3, title: "Avatar 확인하기", detail: "학습한 말투 · 성향 · 대화 경계", done: r.persona && r.boundaries, href: "/studio/settings/avatar/review", icon: <Sparkles className="size-[18px]" /> },
  ];

  return (
    <main className="animate-fade-in pb-12">
      <TopBar backHref="/studio/settings" title="AI Avatar" center />

      <section className="mx-5 mt-3 rounded-card border border-line bg-surface p-4">
        <div className="flex items-center gap-3">
          <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="lg" ring={on ? "ai" : "none"} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-name font-semibold">{creator.name} 공식 AI Avatar</p>
            <p className="mt-0.5 text-caption text-muted">{on ? "팬(구독자)과 대화하고 있어요" : r.ready ? "준비 완료 · 켜면 팬이 대화할 수 있어요" : "아직 만드는 중이에요"}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sub font-semibold">AI 문답</span>
          <div role="radiogroup" aria-label="AI 문답" className="flex rounded-full bg-brand-tint p-1">
            {[false, true].map((v) => (
              <button
                key={String(v)}
                type="button"
                role="radio"
                aria-checked={on === v}
                disabled={busy}
                onClick={() => on !== v && toggle(v)}
                className={cn("h-8 min-w-[4rem] rounded-full px-4 text-caption font-semibold whitespace-nowrap transition-colors", on === v ? (v ? "bg-brand text-white" : "bg-surface text-ink shadow-card") : "text-muted")}
              >
                {busy && on !== v ? <Loader2 className="mx-auto size-4 animate-spin" /> : v ? "ON" : "OFF"}
              </button>
            ))}
          </div>
        </div>
        {notice && (
          <p role="alert" className="mt-2 break-keep text-caption text-danger">
            {notice}
          </p>
        )}
        <p className="mt-2 break-keep text-meta leading-relaxed text-muted">
          끄면 팬은 AI Avatar와 새 대화를 할 수 없어요. 지난 대화는 팬에게 그대로 남아요. 모든 AI 답에는 항상 “AI” 표시가 붙어요.
        </p>
      </section>

      <section className="mx-5 mt-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sub font-semibold">AI Avatar 만들기</h2>
          <span className="text-caption font-semibold text-brand tabular-nums">{progress}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-brand-tint" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="AI Avatar 만들기 진행률">
          <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress}%` }} />
        </div>
        <p className="mt-1.5 text-meta text-muted tabular-nums">
          {r.style.answered} / {r.style.total} 문답 완료
        </p>

        <ol className="mt-4 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {steps.map((s) => (
            <li key={s.n}>
              <Link href={s.href} className="flex items-center gap-3 px-4 py-3.5 active:bg-brand-tint">
                <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-meta font-semibold", s.done ? "bg-brand text-white" : "bg-brand-tint text-brand")}>
                  {s.done ? <Check className="size-4" /> : s.n}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sub font-medium">{s.title}</p>
                  <p className="truncate text-meta text-muted">{s.detail}</p>
                </div>
                <ChevronRight className="size-4 shrink-0 text-faint" />
              </Link>
            </li>
          ))}
          <li className="flex items-center gap-3 px-4 py-3.5">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-meta font-semibold", on ? "bg-brand text-white" : "bg-brand-tint text-brand")}>{on ? <Check className="size-4" /> : 4}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sub font-medium">AI 문답 시작</p>
              <p className="text-meta text-muted">{r.ready ? "위의 AI 문답을 ON으로 바꾸면 시작돼요" : "1~3단계를 마치면 켤 수 있어요"}</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="mt-7">
        <h2 className="mb-2 px-5 text-sub font-semibold">더 닮게 만들기 (선택)</h2>
        <ListGroup>
          <ListRow href="/studio/settings/avatar/more" icon={<NotebookPen className="size-[18px]" />} label="Avatar Training" description="원할 때만 · 답을 더 알려 주거나 다시 학습해요" />
          <ListRow href="/studio/settings/persona" icon={<Sparkles className="size-[18px]" />} label="대화 경계 · 확인된 사실" description="AI가 답하지 않을 주제 · 사실로 말해도 되는 것" />
          <ListRow href="/studio/settings/welcome" icon={<MessageCircleHeart className="size-[18px]" />} label="구독 환영 메시지" description={data.welcomeMessage ? "설정됨" : "새 구독자에게 한 번 보내는 자동 메시지"} />
        </ListGroup>
        <p className="mt-2 px-6 break-keep text-meta leading-relaxed text-muted">
          AI Avatar는 내가 알려 준 기본정보 · 확인한 사실과 팬이 볼 수 있는 Moment만 사실로 말해요. 말투 학습 답변은 말하는 방식만 배우고, 그 내용을 사실로 쓰지 않아요.
        </p>
      </section>
    </main>
  );
}
