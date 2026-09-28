"use client";

import { CheckCircle2, Clock3, Loader2, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { VisibilityBadge } from "@/components/badges";
import { MOMENT_TYPE_META } from "@/components/moment/meta";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { Avatar } from "@/components/ui/Avatar";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadState";
import { SectionHeader } from "@/components/ui/primitives";
import { VisibilitySelector } from "@/components/studio/VisibilitySelector";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { isScheduled, publishMomentNow } from "@/lib/services/creatorSafety";
import { deleteMoment, getTodayMoments, updateMoment } from "@/lib/services/moments";
import type { Creator, Moment, Visibility } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatClock } from "@/lib/utils/format";

function useToday(creatorId: string) {
  return useMomentData(`today:${creatorId}`, () => getTodayMoments(creatorId));
}

/** 공개 직후 잠깐 떠 있는 Toast. 주소의 ?posted=1은 지워서 새로고침 시 다시 뜨지 않게 한다. */
export function PostedToast({ scheduledAt = null }: { scheduledAt?: string | null }) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    window.history.replaceState(null, "", "/studio");
    const t = setTimeout(() => setOpen(false), scheduledAt ? 4200 : 2800);
    return () => clearTimeout(t);
  }, [scheduledAt]);

  if (!open) return null;
  return (
    <div role="status" className="pointer-events-none fixed inset-x-0 top-3 z-50 mx-auto w-full max-w-[430px] px-5">
      <div className="flex animate-fade-in items-center gap-2 rounded-tile bg-ink/90 px-3.5 py-3 text-caption text-white shadow-card backdrop-blur-md">
        <CheckCircle2 className="size-4 shrink-0 text-brand-2" />
        {scheduledAt ? `Safe Delay · ${formatClock(scheduledAt)}쯤 팬에게 공개돼요.` : "Moment가 오늘에 추가되었습니다."}
      </div>
    </div>
  );
}

/** 오늘 남긴 Moment가 있으면 보라 링 */
export function TodayAvatar({ creator }: { creator: Creator }) {
  const { data: moments } = useToday(creator.id);
  return <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="md" ring={moments?.length ? "today" : "none"} />;
}

/** 오늘의 Timeline — compact. 실제로 남긴 Moment만 시간순으로. 크리에이터 본인은 여기서 고치거나 지울 수 있다. */
export function StudioTimeline({ creatorId }: { creatorId: string }) {
  const { data: moments, error, retry } = useToday(creatorId);
  const [target, setTarget] = useState<Moment | null>(null);
  const [editing, setEditing] = useState<Moment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  // 공개 예정 표시가 시간이 지나면 저절로 바뀌도록 (화면 표시만 — 공개 자체는 DB 시각이 정한다)
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function publishNow(m: Moment) {
    setPublishing(m.id);
    try {
      await publishMomentNow(m.id);
      retry();
    } catch {
      /* 이미 공개됐으면 새로 읽으면 된다 */
      retry();
    } finally {
      setPublishing(null);
    }
  }

  function closeSheet() {
    setTarget(null);
    setDeleteError(null);
  }

  async function confirmDelete() {
    if (!target) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteMoment(target.id);
      closeSheet();
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : "삭제하지 못했어요.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <section className="pt-7">
      <SectionHeader
        title="오늘의 Timeline"
        caption={moments?.length ? `${moments.length}개의 순간` : undefined}
        href="/studio/records"
        actionLabel="기록 전체"
      />
      {moments === undefined ? (
        error ? <LoadError message={error} onRetry={retry} className="py-8" /> : <div className="min-h-24" />
      ) : moments.length ? (
        <ol className="px-5">
          {moments.map((m, i) => {
            const last = i === moments.length - 1;
            return (
              <li key={m.id} className="relative flex items-center pb-3 pl-5">
                {!last && <span aria-hidden className="absolute top-1/2 -bottom-1/2 left-[4px] w-px bg-brand-2/35" />}
                <span aria-hidden className={cn("absolute top-1/2 left-0 size-[9px] -translate-y-1/2 rounded-full bg-brand", last && "ring-[3px] ring-brand/15")} />
                <Link href={`/moments/${m.id}`} className="pressable flex min-w-0 flex-1 items-center gap-3">
                  <time className="w-10 shrink-0 text-caption font-semibold tabular-nums">{formatClock(m.createdAt)}</time>
                  <MomentMedia moment={m} variant="thumb" className="size-11 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-caption text-ink">{m.content}</p>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      <span className="text-micro text-muted">{MOMENT_TYPE_META[m.type].label}</span>
                      <VisibilityBadge visibility={m.visibility} />
                    </div>
                    {isScheduled(m.visibleAt, nowMs) && (
                      <p className="mt-0.5 inline-flex items-center gap-0.5 text-micro font-medium whitespace-nowrap text-brand-deep">
                        <Clock3 className="size-3" />
                        공개 예정 · {formatClock(m.visibleAt!)}
                      </p>
                    )}
                  </div>
                </Link>
                {isScheduled(m.visibleAt, nowMs) && (
                  <button
                    type="button"
                    onClick={() => publishNow(m)}
                    disabled={publishing === m.id}
                    className="pressable shrink-0 rounded-full bg-brand-tint px-2.5 py-1 text-micro font-semibold whitespace-nowrap text-brand disabled:opacity-50"
                  >
                    {publishing === m.id ? "공개 중…" : "지금 공개"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditing(m)}
                  aria-label={`${formatClock(m.createdAt)} Moment 수정`}
                  className="pressable grid size-9 shrink-0 place-items-center rounded-full text-faint hover:text-muted"
                >
                  <Pencil className="size-4" strokeWidth={1.8} />
                </button>
                <button
                  type="button"
                  onClick={() => setTarget(m)}
                  aria-label={`${formatClock(m.createdAt)} Moment 삭제`}
                  className="pressable -mr-2 grid size-9 shrink-0 place-items-center rounded-full text-faint hover:text-muted"
                >
                  <Trash2 className="size-4" strokeWidth={1.8} />
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mx-5 rounded-card border border-dashed border-line-strong px-5 py-6 text-center text-caption text-muted">
          오늘은 아직 남긴 순간이 없어요. 기록하고 싶은 순간이 오면, 그때 남겨도 충분해요.
        </p>
      )}

      <BottomSheet open={target !== null} onClose={closeSheet} title="이 Moment를 지울까요?">
        <p className="text-sub text-ink-2">팬의 Today와 기록에서도 사라지고, 올린 사진 · 영상 · 음성 파일도 함께 지워져요. 되돌릴 수 없어요.</p>
        {deleteError && <p className="mt-2 text-caption text-danger">{deleteError}</p>}
        <div className="mt-5 flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={closeSheet} disabled={deleting}>
            취소
          </Button>
          <Button className="flex-1 bg-danger hover:bg-danger/90" onClick={confirmDelete} disabled={deleting}>
            {deleting && <Loader2 className="size-4 animate-spin" />}
            삭제
          </Button>
        </div>
      </BottomSheet>

      {editing && <EditSheet moment={editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

/** 공개 후에는 글 · 공개범위만 고칠 수 있다 (기록한 시각과 미디어는 그대로) */
function EditSheet({ moment, onClose }: { moment: Moment; onClose: () => void }) {
  const [content, setContent] = useState(moment.content);
  const [visibility, setVisibility] = useState<Visibility>(moment.visibility);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isText = moment.type === "text";

  async function save() {
    if (isText && !content.trim()) {
      setError("내용을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = await updateMoment(moment.id, { content: content.trim(), visibility });
      if (!saved) throw new Error("이미 지워졌거나 고칠 수 없는 Moment예요.");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "수정하지 못했어요.");
      setSaving(false);
    }
  }

  return (
    <BottomSheet open onClose={onClose} title={`${formatClock(moment.createdAt)} Moment 고치기`}>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        maxLength={2000}
        rows={isText ? 4 : 2}
        placeholder={isText ? "내용" : "한 줄 남기기 (선택)"}
        className="w-full resize-none rounded-tile border border-line-strong bg-surface px-4 py-3 text-body outline-none focus:border-brand"
      />
      <div className="mt-3">
        <VisibilitySelector value={visibility} onChange={setVisibility} />
      </div>
      {error && <p className="mt-2 text-caption text-danger">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onClose} disabled={saving}>
          취소
        </Button>
        <Button className="flex-1" onClick={save} disabled={saving}>
          {saving && <Loader2 className="size-4 animate-spin" />}
          저장
        </Button>
      </div>
    </BottomSheet>
  );
}
