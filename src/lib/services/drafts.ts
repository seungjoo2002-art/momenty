/**
 * 작성 중인 Moment (Draft) — 공개하기 전까지는 이 기기에만 있다 (서버에 아무것도 올리지 않는다).
 *
 *   글 · 유형 · 공개범위: localStorage (새로고침해도 이어 쓰기)
 *   고른 파일(사진 · 영상 · 음성): 메모리 — 기록 화면 ↔ 미리보기를 오가는 동안만 유지된다.
 *     새로고침하면 파일은 다시 골라야 한다 (큰 영상을 localStorage에 넣지 않는다).
 *
 * 공개하는 순간에만 Storage 업로드 + DB 저장이 일어난다 → 쓰다 만 Moment가 서버에 파일을 남기지 않는다.
 */
import { readJSON, removeKey, writeJSON } from "@/lib/storage/local";
import type { MomentType, Visibility } from "@/lib/types";

export interface MomentDraft {
  creatorId: string;
  type: MomentType;
  content: string;
  durationSec?: number;
  visibility: Visibility;
  aiContextEnabled: boolean;
}

export interface DraftMedia {
  type: MomentType;
  file: Blob;
  /** 미리보기용 object URL */
  previewUrl: string;
  poster?: Blob | null;
  posterUrl?: string;
  durationSec?: number;
}

const key = (creatorId: string) => `momenty:draft:v2:${creatorId}`;
const media = new Map<string, DraftMedia>();

export function emptyDraft(creatorId: string, type: MomentType): MomentDraft {
  return { creatorId, type, content: "", visibility: "subscribers", aiContextEnabled: true };
}

export async function getDraft(creatorId: string): Promise<MomentDraft | null> {
  return readJSON<MomentDraft | null>(key(creatorId), null);
}

/** 용량 초과 시 StorageFullError */
export async function saveDraft(draft: MomentDraft): Promise<void> {
  writeJSON(key(draft.creatorId), draft);
}

export function getDraftMedia(creatorId: string): DraftMedia | null {
  return media.get(creatorId) ?? null;
}

export function setDraftMedia(creatorId: string, next: DraftMedia | null) {
  const prev = media.get(creatorId);
  if (prev && prev !== next) {
    URL.revokeObjectURL(prev.previewUrl);
    if (prev.posterUrl) URL.revokeObjectURL(prev.posterUrl);
  }
  if (next) media.set(creatorId, next);
  else media.delete(creatorId);
}

export async function clearDraft(creatorId: string): Promise<void> {
  removeKey(key(creatorId));
  setDraftMedia(creatorId, null);
}
