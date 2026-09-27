"use client";

import { ChevronDown, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { MOMENT_TYPE_META } from "@/components/moment/meta";
import { MomentCard } from "@/components/moment/MomentCard";
import { VisibilitySelector } from "@/components/studio/VisibilitySelector";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";
import { clearDraft, getDraft, getDraftMedia, saveDraft, type DraftMedia, type MomentDraft } from "@/lib/services/drafts";
import { createMoment } from "@/lib/services/moments";
import type { Creator, Moment } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatClock } from "@/lib/utils/format";

/**
 * 작성 중인 Draft를 불러와 팬에게 보일 모습을 보여준다.
 * Draft가 없거나, 파일이 필요한데 파일이 없으면(새로고침) 기록 화면으로.
 */
export function MomentPreview() {
  const creator = useStudioCreator();
  const router = useRouter();
  const [ready, setReady] = useState<{ draft: MomentDraft; media: DraftMedia | null } | null>(null);

  useEffect(() => {
    getDraft(creator.id).then((d) => {
      const media = getDraftMedia(creator.id);
      if (!d || (d.type !== "text" && (!media || media.type !== d.type))) router.replace("/studio/record");
      else setReady({ draft: d, media });
    });
  }, [creator.id, router]);

  if (!ready) return <main className="min-h-dvh" />;
  return <PreviewBody creator={creator} initial={ready.draft} media={ready.media} />;
}

function PreviewBody({ creator, initial, media }: { creator: Creator; initial: MomentDraft; media: DraftMedia | null }) {
  const router = useRouter();
  const [draft, setDraft] = useState(initial);
  const [createdAt] = useState(() => new Date().toISOString());
  const [publishing, setPublishing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const content = draft.content;

  // 팬에게 보일 모습 — 저장 전이라 id·반응은 비어 있다
  const moment: Moment = {
    id: "draft",
    creatorId: creator.id,
    type: draft.type,
    content,
    mediaUrl: media?.previewUrl,
    posterUrl: media?.posterUrl,
    durationSec: media?.durationSec ?? draft.durationSec,
    createdAt,
    visibility: draft.visibility,
    reactions: { love: 0, cheer: 0, touched: 0, smile: 0 },
    aiContextEnabled: draft.aiContextEnabled,
  };

  /** 공개범위·AI 참고 설정도 Draft에 남겨서 "수정하기" 후 돌아와도 유지 */
  function change(patch: Partial<MomentDraft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    saveDraft(next).catch(() => {});
  }

  function edit() {
    router.push("/studio/record");
  }

  async function publish() {
    setPublishing(true);
    setError(null);
    try {
      // 파일 업로드 → moments 저장 (저장이 실패하면 올린 파일은 서비스가 지운다)
      await createMoment({
        creatorId: creator.id,
        type: draft.type,
        content,
        media: media ? { file: media.file, poster: media.poster } : undefined,
        durationSec: media?.durationSec ?? draft.durationSec,
        visibility: draft.visibility,
        aiContextEnabled: draft.aiContextEnabled,
      });
      await clearDraft(creator.id);
      router.push("/studio?posted=1");
    } catch (e) {
      setError(e instanceof Error ? e.message : "공개하지 못했어요. 다시 시도해 주세요.");
      setPublishing(false);
    }
  }

  return (
    <main className="flex min-h-dvh animate-fade-in flex-col">
      <TopBar title="미리보기" center backHref="/studio/record" />

      {/* 팬에게 보이는 모습 */}
      <section className="px-5 pt-2">
        <p className="mb-2 text-meta text-muted">팬의 Today에는 이렇게 보여요</p>
        <div className="rounded-card border border-line bg-surface p-4">
          <div className="mb-3 flex items-center gap-2">
            <Avatar src={creator.avatarUrl} name={creator.name} size="sm" ring="today" />
            <span className="text-sub font-semibold">{creator.name}</span>
            <span className="text-meta text-muted tabular-nums">
              {formatClock(createdAt)} · {MOMENT_TYPE_META[draft.type].label}
            </span>
          </div>
          <MomentCard moment={moment} mode="preview" />
        </div>
      </section>

      <section className="px-5 pt-6">
        <h2 className="mb-2.5 text-name font-semibold">공개 범위</h2>
        <VisibilitySelector
          value={draft.visibility}
          onChange={(visibility) => change({ visibility })}
          audience={{ public: creator.followers, subscribers: creator.subscribers }}
        />
      </section>

      <section className="px-5 pt-4">
        <button
          type="button"
          onClick={() => setMoreOpen(!moreOpen)}
          aria-expanded={moreOpen}
          className="flex h-10 w-full items-center justify-between text-caption text-muted"
        >
          AI 참고 설정
          <ChevronDown className={cn("size-4 transition-transform duration-200", moreOpen && "rotate-180")} />
        </button>
        {moreOpen && (
          <div className="animate-fade-in overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line">
            <ToggleRow
              title="Creator AI가 참고해도 좋아요"
              description="AI가 이 Moment를 대화 참고 정보로 사용할 수 있도록 허용해요. 끄면 AI 대화의 근거로 쓰이지 않아요."
              defaultOn={draft.aiContextEnabled}
              onChange={(aiContextEnabled) => change({ aiContextEnabled })}
            />
            {/* SafeShare(위치 지연 · 얼굴 흐림)는 아직 없다 — 사진의 위치 정보(EXIF)는 업로드 전에 지운다 */}
            <p className="px-4 py-3.5 text-caption leading-relaxed text-muted">사진의 위치 정보(EXIF)는 올리기 전에 지워져요.</p>
          </div>
        )}
      </section>

      <div className="sticky bottom-0 mt-auto bg-canvas/95 px-5 pt-4 pb-[max(env(safe-area-inset-bottom),16px)] backdrop-blur-md">
        {error && <p className="mb-2.5 text-center text-caption text-danger">{error}</p>}
        <div className="flex gap-2">
          <Button size="lg" variant="secondary" onClick={edit} disabled={publishing}>
            수정하기
          </Button>
          <Button size="lg" className="flex-1" onClick={publish} disabled={publishing}>
            {publishing && <Loader2 className="size-5 animate-spin" />}
            {publishing ? (media ? "올리는 중…" : "공개하는 중…") : "공개하기"}
          </Button>
        </div>
      </div>
    </main>
  );
}
