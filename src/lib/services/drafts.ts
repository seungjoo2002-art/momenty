/**
 * 작성 중인 Moment (Draft).
 * 기록 화면 → 미리보기 → 수정하기를 오가도 내용이 사라지지 않도록 localStorage에 보관한다.
 * 공개하거나 닫으면 지운다. Supabase 연결 후에도 Draft는 기기 로컬에 두는 것을 권장.
 */
import { readJSON, removeKey, writeJSON } from "@/lib/storage/local";
import type { MomentType, Visibility } from "@/lib/types";

export interface MomentDraft {
  creatorId: string;
  type: MomentType;
  content: string;
  /** 사진: 기기에서 고른 이미지의 data URL / 영상: Mock 썸네일 */
  media?: string;
  durationSec?: number;
  visibility: Visibility;
  aiContextEnabled: boolean;
}

const key = (creatorId: string) => `momenty:draft:v1:${creatorId}`;

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

export async function clearDraft(creatorId: string): Promise<void> {
  removeKey(key(creatorId));
}
