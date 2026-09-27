import type { Moment, MomentType, Visibility } from "@/lib/types";
import type { MomentMediaInput } from "../media";

export interface NewMoment {
  creatorId: string;
  type: MomentType;
  content: string;
  /** 사진 · 영상 · 음성 파일 — 공개하는 순간 Storage에 올린다 */
  media?: MomentMediaInput;
  durationSec?: number;
  visibility: Visibility;
  aiContextEnabled: boolean;
}

/** 공개 후 고칠 수 있는 것: 글 · 공개범위 · AI 참고 여부 (미디어 · 시각은 바꾸지 않는다) */
export type MomentPatch = Partial<Pick<Moment, "content" | "visibility" | "aiContextEnabled">>;

export interface MomentQuery {
  creatorIds?: string[];
  ids?: string[];
  /** created_at >= from (ISO) */
  from?: string;
  /** created_at < to (ISO) */
  to?: string;
  order?: "asc" | "desc";
  limit?: number;
}
