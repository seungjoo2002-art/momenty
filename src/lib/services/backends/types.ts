import type { Moment } from "@/lib/types";

export type NewMoment = Pick<
  Moment,
  "creatorId" | "type" | "content" | "mediaUrl" | "durationSec" | "visibility" | "aiContextEnabled"
>;

export type MomentPatch = Partial<Pick<Moment, "content" | "mediaUrl" | "visibility" | "aiContextEnabled">>;

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

/**
 * Moment 저장소 구현이 지켜야 하는 최소 기능.
 * services/moments.ts는 이 위에 Today · Daily 같은 도메인 함수를 만든다.
 */
export interface MomentBackend {
  list(query: MomentQuery): Promise<Moment[]>;
  get(id: string): Promise<Moment | undefined>;
  create(input: NewMoment): Promise<Moment>;
  update(id: string, patch: MomentPatch): Promise<Moment | undefined>;
  remove(id: string): Promise<void>;
  /** ♥ 토글 — 눌린 상태가 되면 true */
  toggleLove(id: string): Promise<boolean>;
  subscribe(listener: () => void): () => void;
}
