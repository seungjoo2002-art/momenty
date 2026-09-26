"use client";

import { ImagePlus, Loader2, Mic, RotateCcw, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MOMENT_TYPE_META } from "@/components/moment/meta";
import { Button } from "@/components/ui/Button";
import { Photo } from "@/components/ui/Photo";
import { draftPhoto } from "@/lib/mock/images";
import { clearDraft, saveDraft, type MomentDraft } from "@/lib/services/drafts";
import type { MomentType } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatTime } from "@/lib/utils/format";
import { readPhotoAsDataUrl } from "@/lib/utils/image";

const TYPES: MomentType[] = ["photo", "video", "voice", "text"];

/**
 * Moment 기록 — Story 업로드처럼 화면 전체를 쓰는 몰입형 화면.
 * 사진을 고르면 사진이 화면을 가득 채우고, 그 위에 최소한의 UI만 둔다.
 *
 * 지원 범위 (localStorage MVP)
 * - 텍스트: 완전 구현
 * - 사진: 기기에서 선택/촬영 → FileReader 미리보기 → 줄여서 저장
 * - 영상: TODO 실제 파일 저장 (Supabase Storage 연결 후). 지금은 Mock 썸네일로 기록된다.
 * - 음성: TODO MediaRecorder 녹음 + Storage 업로드. 지금은 녹음 길이만 기록된다.
 */
export function RecordComposer({ initial }: { initial: MomentDraft }) {
  const router = useRouter();
  const { creatorId } = initial;
  const [type, setType] = useState<MomentType>(initial.type);
  const [media, setMedia] = useState<string | null>(initial.media ?? null);
  const [text, setText] = useState(initial.content);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(initial.type === "voice" ? (initial.durationSec ?? 0) : 0);
  const [shots, setShots] = useState(0);
  const [now, setNow] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const albumInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  // 현재 시각은 클라이언트에서만 표시 (hydration 불일치 방지)
  useEffect(() => {
    const tick = () => setNow(formatTime(new Date().toISOString()));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  function switchType(t: MomentType) {
    setType(t);
    setMedia(null);
    setRecording(false);
    setSeconds(0);
    setError(null);
  }

  function pickPhoto(source: "album" | "camera") {
    // TODO(영상): 실제 영상 파일 선택/촬영. 지금은 Mock 썸네일
    if (type === "video") {
      setMedia(draftPhoto(creatorId, shots));
      setShots(shots + 1);
      return;
    }
    (source === "album" ? albumInput : cameraInput).current?.click();
  }

  async function onPhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 사진을 다시 골라도 onChange가 오도록
    if (!file) return;
    setReading(true);
    setError(null);
    try {
      setMedia(await readPhotoAsDataUrl(file));
    } catch {
      setError("사진을 불러오지 못했어요. 다른 사진을 골라 주세요.");
    } finally {
      setReading(false);
    }
  }

  async function close() {
    await clearDraft(creatorId);
    router.push("/studio");
  }

  const visual = type === "photo" || type === "video";
  const ready = type === "text" ? text.trim().length > 0 : type === "voice" ? seconds > 0 && !recording : media !== null;

  async function next() {
    try {
      await saveDraft({
        ...initial,
        type,
        content: text.trim(),
        media: type === "photo" || type === "video" ? (media ?? undefined) : undefined,
        durationSec: type === "voice" ? seconds : type === "video" ? 18 : undefined,
      });
      router.push("/studio/record/preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "임시 저장에 실패했어요.");
    }
  }

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-[#121017] text-white">
      {/* 배경: 고른 사진이 화면을 가득 채운다 */}
      {visual && media && (
        <div className="absolute inset-0 animate-open">
          <Photo src={media} alt="고른 사진" className="absolute inset-0 bg-black" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/45 via-transparent via-35% to-black/70" />
        </div>
      )}

      <header className="relative z-10 flex h-12 items-center justify-between px-2">
        <button type="button" onClick={close} aria-label="닫기" className="pressable grid size-10 place-items-center rounded-full hover:bg-white/10">
          <X className="size-6" strokeWidth={1.8} />
        </button>
        <span className="text-meta text-white/60">{now ?? ""}</span>
        {visual && media ? (
          <button type="button" onClick={() => setMedia(null)} aria-label="다시 찍기" className="pressable grid size-10 place-items-center rounded-full hover:bg-white/10">
            <RotateCcw className="size-5" strokeWidth={1.8} />
          </button>
        ) : (
          <span className="size-10" />
        )}
      </header>

      <h1 className="relative z-10 px-6 pt-4 text-[26px] leading-tight font-semibold tracking-tight whitespace-pre-line">
        {"지금,\n어떤 순간인가요?"}
      </h1>

      {/* 가운데: 유형별 기록 */}
      <section className="relative z-10 flex flex-1 flex-col justify-end px-6 pb-4">
        <input ref={albumInput} type="file" accept="image/*" hidden onChange={onPhotoSelected} />
        <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={onPhotoSelected} />

        {error && <p className="pb-3 text-center text-caption text-white/80">{error}</p>}

        {visual && !media && reading && (
          <div className="flex justify-center pb-10">
            <Loader2 className="size-7 animate-spin text-white/70" />
          </div>
        )}

        {visual && !media && !reading && (
          <div className="flex items-center justify-center gap-10 pb-6">
            <button
              type="button"
              onClick={() => pickPhoto("album")}
              className="pressable grid size-12 place-items-center rounded-full bg-white/12 backdrop-blur"
              aria-label="앨범에서 선택"
            >
              <ImagePlus className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => pickPhoto("camera")}
              aria-label={type === "photo" ? "지금 찍기" : "지금 촬영하기"}
              className="pressable grid size-[76px] place-items-center rounded-full border-4 border-white"
            >
              <span className={cn("block rounded-full", type === "video" ? "size-14 bg-danger" : "size-[58px] bg-white")} />
            </button>
            <span className="size-12" />
          </div>
        )}

        {visual && media && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="한 줄 남기기"
            className="w-full border-b border-white/30 bg-transparent py-2 text-body text-white outline-none placeholder:text-white/55 focus:border-white"
          />
        )}

        {type === "voice" && (
          <div className="flex flex-col items-center pb-4">
            <div className="flex h-14 items-center gap-[3px]">
              {Array.from({ length: 28 }, (_, i) => (
                <span
                  key={i}
                  className={cn("w-[3px] rounded-full bg-white/70", recording && "animate-wave")}
                  style={{ height: `${30 + ((i * 37) % 70)}%`, animationDelay: `${(i % 6) * 0.1}s` }}
                />
              ))}
            </div>
            <p className="mt-4 text-[32px] font-semibold tabular-nums">{formatDuration(seconds)}</p>
            <button
              type="button"
              onClick={() => setRecording(!recording)}
              className={cn(
                "pressable mt-5 grid size-[76px] place-items-center rounded-full text-white transition-colors",
                recording ? "bg-danger" : "bg-brand",
              )}
              aria-label={recording ? "녹음 멈추기" : "녹음 시작"}
            >
              {recording ? <Square className="size-6 fill-white" /> : <Mic className="size-7" />}
            </button>
            <p className="mt-3 text-meta text-white/60">
              {recording ? "듣고 있어요…" : seconds ? "다시 누르면 이어서 녹음돼요" : "눌러서 녹음 시작"}
            </p>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="한 줄 남기기 (선택)"
              className="mt-5 w-full border-b border-white/25 bg-transparent py-2 text-center text-sub text-white outline-none placeholder:text-white/45 focus:border-white"
            />
          </div>
        )}

        {type === "text" && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
            placeholder="지금 떠오른 생각, 오늘의 한 문장…"
            className="mb-auto min-h-[40vh] w-full resize-none bg-transparent pt-6 text-[22px] leading-[1.55] font-medium outline-none placeholder:text-white/35"
          />
        )}
      </section>

      {/* 하단: 유형 선택 + 다음 */}
      <footer className="relative z-10 px-5 pb-[max(env(safe-area-inset-bottom),16px)]">
        <div className="mb-3 flex justify-center gap-1" role="tablist" aria-label="Moment 유형">
          {TYPES.map((t) => {
            const active = type === t;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => switchType(t)}
                className={cn(
                  "flex h-11 flex-col items-center justify-center px-4 text-sub transition-colors duration-150",
                  active ? "font-semibold text-white" : "text-white/50",
                )}
              >
                {MOMENT_TYPE_META[t].label}
                <span className={cn("mt-1 size-1 rounded-full bg-white transition-opacity", active ? "opacity-100" : "opacity-0")} />
              </button>
            );
          })}
        </div>
        <Button size="lg" block disabled={!ready} onClick={next}>
          다음
        </Button>
      </footer>
    </main>
  );
}
