"use client";

import { FileAudio, ImagePlus, Loader2, Mic, RotateCcw, Square, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { MOMENT_TYPE_META } from "@/components/moment/meta";
import { useBrowserValue } from "@/lib/hooks/useBrowserValue";
import { VoicePlayer } from "@/components/moment/VoicePlayer";
import { Button } from "@/components/ui/Button";
import { Photo } from "@/components/ui/Photo";
import { clearDraft, getDraftMedia, saveDraft, setDraftMedia, type DraftMedia, type MomentDraft } from "@/lib/services/drafts";
import { checkMomentMedia, MEDIA_RULES, normalizeMime } from "@/lib/services/media";
import type { MomentType } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDuration, formatTime } from "@/lib/utils/format";
import { audioDuration, inspectVideo } from "@/lib/utils/image";

const TYPES: MomentType[] = ["photo", "video", "voice", "text"];
const MAX_RECORD_SEC = 600;

/** 이 브라우저가 녹음할 수 있는 형식 (iOS Safari는 audio/mp4, Chrome · Android는 audio/webm) */
function recorderMime(): string | null {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg"];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? "";
}

/**
 * Moment 기록 — Story 업로드처럼 화면 전체를 쓰는 몰입형 화면.
 * 파일은 이 기기에서만 미리보기하고, 실제 업로드는 미리보기에서 "공개하기"를 누를 때 한다.
 *
 * - 텍스트: 글
 * - 사진: 앨범 선택 / 카메라 촬영 (JPG · PNG · WEBP)
 * - 영상: 앨범 선택 / 카메라 촬영 (MP4 · MOV · WEBM, 50MB 이하) → 길이 · 첫 장면(포스터) 추출
 * - 음성: MediaRecorder 녹음 (지원하지 않거나 마이크 권한이 없으면 음성 파일 올리기)
 */
export function RecordComposer({ initial }: { initial: MomentDraft }) {
  const router = useRouter();
  const { creatorId } = initial;
  const [type, setType] = useState<MomentType>(initial.type);
  const [media, setMedia] = useState<DraftMedia | null>(() => {
    const m = getDraftMedia(creatorId);
    return m && m.type === initial.type ? m : null;
  });
  const [text, setText] = useState(initial.content);
  const [now, setNow] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 녹음
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // 이 브라우저가 녹음할 수 있는지 (서버 · 첫 렌더에서는 null) + 마이크를 쓸 수 없었는지
  const supportsRecording = useBrowserValue(() => recorderMime() !== null);
  const [micBlocked, setMicBlocked] = useState(false);
  const canRecord = supportsRecording === null ? null : supportsRecording && !micBlocked;
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);

  const albumInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);

  // 현재 시각 · 녹음 가능 여부는 클라이언트에서만 (hydration 불일치 방지)
  useEffect(() => {
    const tick = () => setNow(formatTime(new Date().toISOString()));
    tick();
    const t = setInterval(tick, 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt.current) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORD_SEC) recorder.current?.stop();
    }, 250);
    return () => clearInterval(t);
  }, [recording]);

  // 화면을 떠나면 마이크를 끈다
  useEffect(() => () => stream.current?.getTracks().forEach((t) => t.stop()), []);

  function chooseMedia(next: DraftMedia | null) {
    setDraftMedia(creatorId, next);
    setMedia(next);
  }

  function switchType(t: MomentType) {
    if (recording) recorder.current?.stop();
    setType(t);
    chooseMedia(null);
    setSeconds(0);
    setError(null);
  }

  async function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // 같은 파일을 다시 골라도 onChange가 오도록
    if (!file) return;
    const invalid = checkMomentMedia(type, file);
    if (invalid) {
      setError(invalid);
      return;
    }
    setReading(true);
    setError(null);
    try {
      if (type === "photo") {
        chooseMedia({ type, file, previewUrl: URL.createObjectURL(file) });
      } else if (type === "video") {
        const { durationSec, poster } = await inspectVideo(file);
        chooseMedia({
          type,
          file,
          previewUrl: URL.createObjectURL(file),
          poster,
          posterUrl: poster ? URL.createObjectURL(poster) : undefined,
          durationSec,
        });
      } else if (type === "voice") {
        const durationSec = await audioDuration(file).catch(() => 0);
        chooseMedia({ type, file, previewUrl: URL.createObjectURL(file), durationSec });
      }
    } catch {
      setError(type === "video" ? "영상을 불러오지 못했어요. 다른 영상을 골라 주세요." : "파일을 불러오지 못했어요. 다른 파일을 골라 주세요.");
    } finally {
      setReading(false);
    }
  }

  async function startRecording() {
    setError(null);
    const mime = recorderMime();
    if (mime === null) {
      setMicBlocked(true);
      return;
    }
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const r = mime ? new MediaRecorder(s, { mimeType: mime }) : new MediaRecorder(s);
      chunks.current = [];
      r.ondataavailable = (ev) => ev.data.size && chunks.current.push(ev.data);
      r.onstop = () => {
        s.getTracks().forEach((t) => t.stop());
        stream.current = null;
        setRecording(false);
        const duration = Math.max(1, Math.round((Date.now() - startedAt.current) / 1000));
        // bucket이 허용하는 형식 이름으로 ("audio/webm;codecs=opus" → "audio/webm")
        const blob = new Blob(chunks.current, { type: normalizeMime(r.mimeType || mime || "audio/webm") });
        const invalid = checkMomentMedia("voice", blob);
        if (invalid) {
          setError(invalid);
          return;
        }
        chooseMedia({ type: "voice", file: blob, previewUrl: URL.createObjectURL(blob), durationSec: duration, recordedInApp: true });
      };
      recorder.current = r;
      startedAt.current = Date.now();
      setSeconds(0);
      chooseMedia(null);
      r.start(1000);
      setRecording(true);
    } catch {
      stream.current?.getTracks().forEach((t) => t.stop());
      setMicBlocked(true);
      setError("마이크를 사용할 수 없어요. 권한을 허용하거나 음성 파일을 올려 주세요.");
    }
  }

  async function close() {
    if (recording) recorder.current?.stop();
    await clearDraft(creatorId);
    router.push("/studio");
  }

  const visual = type === "photo" || type === "video";
  const ready = type === "text" ? text.trim().length > 0 : media !== null && !recording && !reading;

  async function next() {
    try {
      await saveDraft({ ...initial, type, content: text.trim(), durationSec: media?.durationSec });
      router.push("/studio/record/preview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "임시 저장에 실패했어요.");
    }
  }

  const accept = type === "photo" ? "image/*" : type === "video" ? "video/*" : "audio/*";

  return (
    <main className="relative flex h-dvh flex-col overflow-hidden bg-[#121017] text-white">
      {/* 배경: 고른 사진 · 영상이 화면을 가득 채운다 */}
      {visual && media && (
        <div className="absolute inset-0 animate-open">
          {type === "photo" ? (
            <Photo src={media.previewUrl} alt="고른 사진" className="h-full w-full bg-black" />
          ) : (
            <video src={media.previewUrl} poster={media.posterUrl} autoPlay muted loop playsInline className="absolute inset-0 h-full w-full bg-black object-cover" />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/45 via-transparent via-35% to-black/70" />
        </div>
      )}

      <header className="relative z-10 flex h-12 items-center justify-between px-2">
        <button type="button" onClick={close} aria-label="닫기" className="pressable grid size-10 place-items-center rounded-full hover:bg-white/10">
          <X className="size-6" strokeWidth={1.8} />
        </button>
        <span className="text-meta text-white/60">{now ?? ""}</span>
        {media && !recording ? (
          <button type="button" onClick={() => chooseMedia(null)} aria-label="다시 고르기" className="pressable grid size-10 place-items-center rounded-full hover:bg-white/10">
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
        <input ref={albumInput} type="file" accept={accept} hidden onChange={onFileSelected} />
        <input ref={cameraInput} type="file" accept={accept} capture="environment" hidden onChange={onFileSelected} />
        <input ref={audioInput} type="file" accept={`audio/*,${MEDIA_RULES.audio.types.join(",")}`} hidden onChange={onFileSelected} />

        {error && (
          <p role="alert" className="pb-3 text-center text-caption text-white/85">
            {error}
          </p>
        )}

        {visual && !media && reading && (
          <div className="flex justify-center pb-10">
            <Loader2 className="size-7 animate-spin text-white/70" />
          </div>
        )}

        {visual && !media && !reading && (
          <div className="flex flex-col items-center pb-6">
            <div className="flex items-center justify-center gap-10">
              <button
                type="button"
                onClick={() => albumInput.current?.click()}
                className="pressable grid size-12 place-items-center rounded-full bg-white/12 backdrop-blur"
                aria-label="앨범에서 선택"
              >
                <ImagePlus className="size-5" />
              </button>
              <button
                type="button"
                onClick={() => cameraInput.current?.click()}
                aria-label={type === "photo" ? "지금 찍기" : "지금 촬영하기"}
                className="pressable grid size-[76px] place-items-center rounded-full border-4 border-white"
              >
                <span className={cn("block rounded-full", type === "video" ? "size-14 bg-danger" : "size-[58px] bg-white")} />
              </button>
              <span className="size-12" />
            </div>
            <p className="mt-4 text-meta text-white/50">{type === "photo" ? MEDIA_RULES.image.label : MEDIA_RULES.video.label}</p>
          </div>
        )}

        {visual && media && (
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            placeholder="한 줄 남기기"
            className="w-full border-b border-white/30 bg-transparent py-2 text-body text-white outline-none placeholder:text-white/55 focus:border-white"
          />
        )}

        {type === "voice" && (
          <div className="flex flex-col items-center pb-4">
            {media && !recording ? (
              <div className="w-full">
                <VoicePlayer seed="draft" src={media.previewUrl} durationSec={media.durationSec} size="lg" tone="dark" />
              </div>
            ) : (
              <>
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
                {canRecord !== false && (
                  <button
                    type="button"
                    onClick={() => (recording ? recorder.current?.stop() : void startRecording())}
                    className={cn(
                      "pressable mt-5 grid size-[76px] place-items-center rounded-full text-white transition-colors",
                      recording ? "bg-danger" : "bg-brand",
                    )}
                    aria-label={recording ? "녹음 멈추기" : "녹음 시작"}
                  >
                    {recording ? <Square className="size-6 fill-white" /> : <Mic className="size-7" />}
                  </button>
                )}
                <p className="mt-3 text-meta text-white/60">
                  {recording ? "듣고 있어요… 멈추면 들어볼 수 있어요" : canRecord === false ? "이 브라우저에서는 녹음할 수 없어요" : "눌러서 녹음 시작"}
                </p>
              </>
            )}
            {!recording && (
              <button type="button" onClick={() => audioInput.current?.click()} className="pressable mt-4 inline-flex h-9 items-center gap-1.5 rounded-full bg-white/12 px-3.5 text-meta text-white/85">
                <FileAudio className="size-4" />
                {media ? "다른 음성 파일 올리기" : "음성 파일 올리기"}
              </button>
            )}
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={2000}
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
            maxLength={2000}
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
