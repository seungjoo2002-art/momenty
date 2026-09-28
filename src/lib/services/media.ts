/**
 * 파일 업로드 (Supabase Storage).
 *
 *   avatars       공개 bucket · {auth.uid}/{uuid}.jpg        — 본인 폴더만 쓰기 (Storage 정책)
 *   moment-media  비공개 bucket · {creator_id}/{uuid}.{ext}  — 크리에이터 본인 폴더만 쓰기,
 *                 읽기는 볼 수 있는 Moment에 연결된 파일만 (signed URL)
 *
 * 형식 · 크기는 여기서 먼저 확인하고, bucket 설정(allowed_mime_types · file_size_limit)이 한 번 더 막는다.
 * 파일 이름은 uuid — 같은 이름으로 덮어쓰지 않는다 (upsert: false). 원래 파일 이름은 경로에도, 업로드 본문에도 들어가지 않는다.
 * metadata(위치 · 기기)는 크리에이터 선택과 관계없이 지운다 — lib/safeshare/metadata.ts.
 */
import { supabase } from "@/lib/supabase/client";
import type { MomentType } from "@/lib/types";
import { sanitizeMediaBlob } from "@/lib/safeshare/metadata";
import { resizeImage } from "@/lib/utils/image";
import { ServiceError, toServiceError } from "./errors";

export const AVATAR_BUCKET = "avatars";
export const MOMENT_BUCKET = "moment-media";

const MB = 1024 * 1024;

export const MEDIA_RULES = {
  image: { types: ["image/jpeg", "image/png", "image/webp"], maxBytes: 20 * MB, label: "사진은 JPG · PNG · WEBP" },
  video: { types: ["video/mp4", "video/quicktime", "video/webm"], maxBytes: 50 * MB, label: "영상은 MP4 · MOV · WEBM, 50MB 이하" },
  audio: {
    types: ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/aac", "audio/wav", "audio/x-m4a"],
    maxBytes: 50 * MB,
    label: "음성은 M4A · MP3 · WEBM · OGG · WAV · AAC, 50MB 이하",
  },
} as const;

/** 업로드 후 크기 상한 (bucket 설정과 같다) */
const AVATAR_MAX_BYTES = 2 * MB;

/** 브라우저마다 다르게 붙이는 형식 이름을 bucket이 허용하는 이름으로 맞춘다 ("audio/webm;codecs=opus" → "audio/webm") */
export function normalizeMime(type: string): string {
  const base = type.split(";")[0].trim().toLowerCase();
  const alias: Record<string, string> = {
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/m4a": "audio/x-m4a",
    "audio/mp3": "audio/mpeg",
    "audio/x-mp4": "audio/mp4",
    "image/jpg": "image/jpeg",
  };
  return alias[base] ?? base;
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/wav": "wav",
};

/** 파일이 형식 · 크기 규칙에 맞는지. 맞지 않으면 안내 문구 */
export function checkFile(kind: keyof typeof MEDIA_RULES, file: Blob): string | null {
  const rule = MEDIA_RULES[kind];
  const type = normalizeMime(file.type);
  if (!(rule.types as readonly string[]).includes(type)) return `지원하지 않는 형식이에요. ${rule.label}만 올릴 수 있어요.`;
  if (file.size > rule.maxBytes) return `파일이 너무 커요. ${rule.label}.`;
  if (file.size === 0) return "빈 파일이에요.";
  return null;
}

/** 사진은 줄여서(EXIF 제거) 올린다. DOM이 없는 환경(Node 통합 테스트)에서는 원본 그대로 — bucket 제한은 똑같이 적용된다. */
function prepareImage(file: Blob, maxSide: number): Promise<Blob> {
  return typeof document === "undefined" ? Promise.resolve(file) : resizeImage(file, maxSide, 0.85);
}

/** Storage 경로: {폴더}/{uuid}.{확장자} — 원래 파일 이름은 쓰지 않는다 */
export function newPath(folder: string, type: string) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${folder}/${id}.${EXT[type] ?? "bin"}`;
}

async function upload(bucket: string, folder: string, blob: Blob): Promise<string> {
  const type = normalizeMime(blob.type);
  const path = newPath(folder, type);
  // File이면 이름이 업로드 본문(multipart)에 따라갈 수 있다 → 이름 없는 Blob으로 다시 싼다
  const body = typeof File !== "undefined" && blob instanceof File ? new Blob([blob], { type }) : blob;
  const { error } = await supabase().storage.from(bucket).upload(path, body, { contentType: type, upsert: false, cacheControl: "3600" });
  if (error) throw error;
  return path;
}

/** 업로드한 파일 지우기 (실패해도 흐름을 막지 않는다 — 남은 파일은 orphan 정리 스크립트가 찾는다) */
export async function removeFiles(bucket: string, paths: string[]): Promise<void> {
  const list = paths.filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase().storage.from(bucket).remove(list);
  if (error) console.error("[momenty/storage] 파일 정리 실패", list, error);
}

/* ---------- 프로필 이미지 ---------- */

/** 프로필 이미지: 정사각에 가깝게 줄여 JPEG로 올리고 공개 URL을 돌려준다 */
export async function uploadAvatar(userId: string, file: Blob): Promise<{ url: string; path: string }> {
  const invalid = checkFile("image", file);
  if (invalid) throw new ServiceError(invalid, "invalid");
  try {
    const blob = await prepareImage(file, 640);
    if (blob.size > AVATAR_MAX_BYTES) throw new ServiceError("사진이 너무 커요. 다른 사진을 골라 주세요.", "invalid");
    const path = await upload(AVATAR_BUCKET, userId, blob);
    const { data } = supabase().storage.from(AVATAR_BUCKET).getPublicUrl(path);
    return { url: data.publicUrl, path };
  } catch (e) {
    throw toServiceError(e, "프로필 사진을 올리지 못했어요.");
  }
}

/** avatars 공개 URL → Storage 경로 (우리 bucket의 파일이 아니면 null) */
export function avatarPathOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${AVATAR_BUCKET}/`;
  const i = url.indexOf(marker);
  return i === -1 ? null : decodeURIComponent(url.slice(i + marker.length).split("?")[0]);
}

/* ---------- Moment 미디어 ---------- */

export interface MomentMediaInput {
  /** 사진 · 영상 · 음성 원본 */
  file: Blob;
  /** 영상 첫 장면 (없어도 된다) */
  poster?: Blob | null;
  /** 이 앱에서 녹음한 음성 (위치 metadata가 없다) */
  recordedInApp?: boolean;
}

/** Moment 유형별로 받을 수 있는 파일인지 */
export function checkMomentMedia(type: MomentType, file: Blob): string | null {
  if (type === "photo") return checkFile("image", file);
  if (type === "video") return checkFile("video", file);
  if (type === "voice") return checkFile("audio", file);
  return "글 Moment에는 파일을 올리지 않아요.";
}

/** Moment 미디어 업로드 → { media, poster } Storage 경로. 사진은 줄여서(EXIF 제거) 올린다. */
export async function uploadMomentMedia(creatorId: string, type: MomentType, input: MomentMediaInput): Promise<{ media: string; poster: string | null }> {
  const invalid = checkMomentMedia(type, input.file);
  if (invalid) throw new ServiceError(invalid, "invalid");
  const uploaded: string[] = [];
  try {
    const resized = type === "photo" ? await prepareImage(input.file, 1600) : input.file;
    // 위치 · 기기 metadata 제거 (사진: JPEG 세그먼트 · 영상/음성: MP4·MOV·M4A metadata 박스 · MP3 ID3)
    const { blob: body } = await sanitizeMediaBlob(resized, type === "photo" ? "image" : type === "video" ? "video" : "audio", { recordedInApp: input.recordedInApp });
    const media = await upload(MOMENT_BUCKET, creatorId, body);
    uploaded.push(media);
    let poster: string | null = null;
    if (type === "video" && input.poster) {
      poster = await upload(MOMENT_BUCKET, creatorId, input.poster);
      uploaded.push(poster);
    }
    return { media, poster };
  } catch (e) {
    await removeFiles(MOMENT_BUCKET, uploaded);
    throw toServiceError(e, "파일을 올리지 못했어요. 다시 시도해 주세요.");
  }
}
