"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { useStudioCreator } from "@/components/auth/Gates";
import { Button } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { Chip } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { REPLY_MAX, SAMPLE_SOURCE_LABEL } from "@/lib/avatar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { addStyleTraining, getStyleSamples, getTrainingPrompts, resetStyleTraining } from "@/lib/services/avatar";
import { formatShortDate } from "@/lib/utils/format";

const RESET_WORD = "초기화";

/**
 * Avatar Training (선택) — 매일 해야 하는 일이 아니다. 원할 때 팬 메시지 하나에 내 답을 더 알려 준다 (출처: avatar_training).
 * "AI 예상 답변 → 이대로 사용 · 수정 · 건너뛰기"(출처: creator_correction)는 DB 구조만 준비됐다 — AI 예상 답변 생성은 다음 단계.
 * 전체 초기화: 확인 문구를 입력해야 한다. 기록은 지우지 않고 보관하며, AI 문답은 꺼진다.
 */
export default function AvatarMorePage() {
  const creator = useStudioCreator();
  const router = useRouter();
  const { refresh } = useAuth();
  const { data, error, retry } = useMomentData(`avatar-more:${creator.id}`, async () => {
    const [prompts, all] = await Promise.all([getTrainingPrompts(), getStyleSamples(creator.id, true)]);
    return { prompts, all };
  });
  const [fanMessage, setFanMessage] = useState("");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirm, setConfirm] = useState("");

  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;

  const active = data.all.filter((s) => !s.archivedAt);
  const archived = data.all.length - active.length;
  const extra = active.filter((s) => s.source !== "onboarding");
  // 추천 팬 메시지: 더 알려 줄 때마다 다른 묶음이 보이도록 (날짜 · 난수를 쓰지 않는다)
  const suggestions = data.prompts.filter((_, i) => i % 5 === extra.length % 5).slice(0, 6);

  async function add() {
    setBusy("add");
    setNotice(null);
    try {
      await addStyleTraining({ fanMessage, reply });
      setFanMessage("");
      setReply("");
      setNotice({ ok: true, text: "알려 줘서 고마워요. 다음 대화부터 참고해요." });
      retry();
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "저장하지 못했어요." });
    } finally {
      setBusy(null);
    }
  }

  async function reset() {
    setBusy("reset");
    setNotice(null);
    try {
      await resetStyleTraining(confirm);
      await refresh();
      router.push("/studio/settings/avatar/training");
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "초기화하지 못했어요." });
      setBusy(null);
    }
  }

  return (
    <main className="animate-fade-in pb-12">
      <TopBar backHref="/studio/settings/avatar" title="Avatar Training" center />
      <div className="px-5 pt-3">
        <h1 className="text-section font-bold">오늘의 Avatar Training</h1>
        <p className="mt-1 break-keep text-caption leading-relaxed text-muted">매일 할 필요는 없어요. 생각날 때 팬 메시지 하나에 내 답을 알려 주면 Avatar가 조금 더 나를 닮아 가요.</p>

        <section className="mt-5 rounded-card border border-line bg-surface p-4">
          <p className="text-caption font-medium text-ink-2">팬 메시지</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map((p) => (
              <Chip key={p.key} active={fanMessage === p.fanMessage} onClick={() => setFanMessage(p.fanMessage)} className="h-auto min-h-8 py-1 text-left text-meta">
                {p.fanMessage}
              </Chip>
            ))}
          </div>
          <input
            value={fanMessage}
            maxLength={300}
            onChange={(e) => setFanMessage(e.target.value)}
            placeholder="또는 직접 적기 (예: 오늘 라이브 언제 해?)"
            aria-label="팬 메시지"
            className="mt-2 h-11 w-full rounded-tile border border-line-strong bg-canvas px-4 text-sub outline-none focus:border-brand"
          />
          <label className="mt-3 block">
            <span className="text-caption font-medium text-ink-2">내 답</span>
            <textarea
              value={reply}
              rows={3}
              onChange={(e) => setReply(e.target.value.slice(0, REPLY_MAX))}
              placeholder="평소 쓰는 말투 그대로"
              className="mt-1.5 w-full resize-none rounded-tile border border-line-strong bg-canvas px-4 py-3 text-sub outline-none focus:border-brand"
            />
          </label>
          <Button block className="mt-2" onClick={add} disabled={busy === "add" || !fanMessage.trim() || !reply.trim()}>
            {busy === "add" && <Loader2 className="size-4 animate-spin" />}
            학습에 더하기
          </Button>
          {notice && (
            <p role={notice.ok ? "status" : "alert"} className={notice.ok ? "mt-2 text-caption text-safe" : "mt-2 text-caption text-danger"}>
              {notice.text}
            </p>
          )}
        </section>

        <section className="mt-5 rounded-card bg-canvas p-4">
          <p className="text-caption font-semibold text-ink-2">AI 예상 답변 고치기 · 준비 중</p>
          <p className="mt-1 break-keep text-meta leading-relaxed text-muted">
            AI Avatar가 먼저 답을 제안하면 [이대로 사용] [수정] [건너뛰기] 중에 고르는 학습이에요. 고친 답은 ‘AI 답 고침’으로 따로 쌓여요.
          </p>
        </section>

        <section className="mt-7">
          <h2 className="text-sub font-semibold">더 알려 준 답</h2>
          {extra.length === 0 ? (
            <p className="mt-2 text-caption text-muted">아직 없어요.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
              {extra.slice(0, 20).map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <p className="text-meta text-muted">
                    {SAMPLE_SOURCE_LABEL[s.source]} · {formatShortDate(s.createdAt)} · 팬: “{s.fanMessage}”
                  </p>
                  <p className="mt-0.5 text-caption break-words">나: {s.reply}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-meta text-faint">
            학습 중인 답 {active.length}개 · 보관된 이전 답 {archived}개 (지우지 않고 보관해요)
          </p>
        </section>

        <section className="mt-8 rounded-card border border-danger/30 p-4">
          <h2 className="flex items-center gap-1.5 text-sub font-semibold text-danger">
            <RotateCcw className="size-4" />
            말투 학습 초기화
          </h2>
          <p className="mt-1 break-keep text-caption leading-relaxed text-muted">
            지금까지의 말투 학습을 모두 보관 처리하고 처음부터 다시 학습해요. AI 문답은 바로 꺼지고, 최소 문답을 다시 채워야 켤 수 있어요. 기본정보는 그대로예요.
          </p>
          <input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={`확인을 위해 “${RESET_WORD}”를 입력`}
            aria-label="초기화 확인 문구"
            className="mt-3 h-11 w-full rounded-tile border border-line-strong bg-surface px-4 text-sub outline-none focus:border-danger"
          />
          <Button variant="secondary" block className="mt-2 text-danger" onClick={reset} disabled={confirm !== RESET_WORD || busy === "reset"}>
            {busy === "reset" && <Loader2 className="size-4 animate-spin" />}
            초기화하고 다시 학습하기
          </Button>
        </section>
      </div>
    </main>
  );
}
