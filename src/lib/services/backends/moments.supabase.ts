/**
 * Moment 저장소 — Supabase.
 *
 * 읽기: public.moment_feed view — 볼 수 없는 Moment는 content · media_url · poster_url이 DB에서 null로 온다.
 * 쓰기: public.moments 테이블 — RLS + 컬럼 권한이 크리에이터 본인만, 허용된 컬럼만 허락한다.
 *       (created_at은 DB now() — 앱에서 정할 수 없다)
 *       media_url · poster_url은 DB trigger가 "내 폴더 + 실제로 업로드된 파일"인지 검사한다.
 * 반응: public.moment_reactions — (moment_id, user_id, kind) 기본키로 중복 방지.
 * 미디어: Storage bucket "moment-media" (비공개) → 읽을 때 signed URL로 바꾼다.
 */
import { currentUserId, supabase } from "@/lib/supabase/client";
import type { Moment, MomentType, ReactionKey, SafeShareFlag, Visibility } from "@/lib/types";
import { createChannel } from "@/lib/storage/local";
import { ServiceError, toServiceError } from "../errors";
import { MOMENT_BUCKET, removeFiles, uploadMomentMedia } from "../media";
import type { MomentPatch, MomentQuery, NewMoment } from "./types";

const FEED_COLUMNS =
  "id, creator_id, type, visibility, duration_sec, created_at, viewable, content, media_url, poster_url, location, safe_share, ai_context_enabled, love_count, cheer_count, touched_count, smile_count, liked_by_me";

type DbVisibility = "public" | "subscriber" | "premium";

interface FeedRow {
  id: string;
  creator_id: string;
  type: MomentType;
  visibility: DbVisibility;
  duration_sec: number | null;
  created_at: string;
  viewable: boolean;
  content: string | null;
  media_url: string | null;
  poster_url: string | null;
  location: string | null;
  safe_share: string[] | null;
  ai_context_enabled: boolean;
  love_count: number;
  cheer_count: number;
  touched_count: number;
  smile_count: number;
  liked_by_me: boolean;
}

/* 앱의 "subscribers" ↔ DB의 "subscriber" */
const toDbVisibility = (v: Visibility): DbVisibility => (v === "subscribers" ? "subscriber" : v);
const fromDbVisibility = (v: DbVisibility): Visibility => (v === "subscriber" ? "subscribers" : v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (id: string) => UUID.test(id);

/** Storage 경로인지 (seed의 외부 URL이 아닌 것) */
const isStoragePath = (url: string) => !/^(https?:|data:|blob:)/.test(url);

const channel = createChannel([]);

/** Moment · 반응 · 보관함이 바뀌었을 때 화면에 알린다 */
export function notifyMomentsChanged() {
  channel.emit();
}

/* ---------- signed URL ---------- */

// 같은 파일이 다시 불러올 때마다 다른 URL이 되어 깜빡이지 않도록 잠시 기억한다
const signed = new Map<string, { url: string; expires: number }>();
const SIGN_SECONDS = 60 * 60;

/** 로그인 · 로그아웃하면 이전 사용자 권한으로 만든 URL을 버린다 */
export function clearSignedUrls() {
  signed.clear();
}

async function signMedia(rows: FeedRow[]): Promise<Map<string, string>> {
  const now = Date.now();
  const paths = [
    ...new Set(rows.flatMap((r) => [r.media_url, r.poster_url]).filter((u): u is string => !!u && isStoragePath(u))),
  ];
  const missing = paths.filter((p) => (signed.get(p)?.expires ?? 0) < now + 5 * 60_000);
  if (missing.length) {
    const { data, error } = await supabase().storage.from(MOMENT_BUCKET).createSignedUrls(missing, SIGN_SECONDS);
    if (error) console.error("[momenty/storage]", error);
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) signed.set(item.path, { url: item.signedUrl, expires: now + SIGN_SECONDS * 1000 });
    }
  }
  return new Map(paths.flatMap((p) => (signed.has(p) ? [[p, signed.get(p)!.url] as const] : [])));
}

function resolveUrl(value: string | null, urls: Map<string, string>) {
  if (!value) return undefined;
  return isStoragePath(value) ? urls.get(value) : value;
}

/** seed 데이터의 "영상"은 외부 이미지 URL이다 — 영상 파일이 아니면 포스터로만 쓴다 (재생하지 않음) */
const isExternalStill = (url: string | null) => !!url && /^https?:/.test(url) && !/\.(mp4|mov|webm)(\?|$)/i.test(url);

function toMoment(r: FeedRow, urls: Map<string, string>): Moment {
  const stillVideo = r.type === "video" && isExternalStill(r.media_url);
  return {
    id: r.id,
    creatorId: r.creator_id,
    type: r.type,
    content: r.content ?? "",
    mediaUrl: stillVideo ? undefined : resolveUrl(r.media_url, urls),
    posterUrl: stillVideo ? (r.media_url ?? undefined) : resolveUrl(r.poster_url, urls),
    durationSec: r.duration_sec ?? undefined,
    createdAt: new Date(r.created_at).toISOString(),
    visibility: fromDbVisibility(r.visibility),
    reactions: { love: r.love_count, cheer: r.cheer_count, touched: r.touched_count, smile: r.smile_count },
    location: r.location ?? undefined,
    safeShare: r.safe_share?.length ? (r.safe_share as SafeShareFlag[]) : undefined,
    aiContextEnabled: r.ai_context_enabled,
    locked: !r.viewable,
    likedByMe: r.liked_by_me,
  };
}

async function hydrate(rows: FeedRow[]): Promise<Moment[]> {
  const urls = await signMedia(rows);
  return rows.map((r) => toMoment(r, urls));
}

async function requireUser(message: string): Promise<string> {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError(message, "auth");
  return uid;
}

async function fetchOne(id: string): Promise<Moment | undefined> {
  const { data, error } = await supabase().from("moment_feed").select(FEED_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw toServiceError(error);
  return data ? (await hydrate([data as FeedRow]))[0] : undefined;
}

export const supabaseMoments = {
  async list(q: MomentQuery): Promise<Moment[]> {
    const ids = q.ids?.filter(isUuid);
    if (ids && ids.length === 0) return [];
    if (q.creatorIds && q.creatorIds.length === 0) return [];
    try {
      let query = supabase().from("moment_feed").select(FEED_COLUMNS);
      if (q.creatorIds) query = query.in("creator_id", q.creatorIds);
      if (ids) query = query.in("id", ids);
      if (q.from) query = query.gte("created_at", q.from);
      if (q.to) query = query.lt("created_at", q.to);
      query = query.order("created_at", { ascending: q.order !== "desc" }).limit(q.limit ?? 1000);
      const { data, error } = await query;
      if (error) throw error;
      return hydrate((data ?? []) as FeedRow[]);
    } catch (e) {
      throw toServiceError(e, "Moment를 불러오지 못했어요.");
    }
  },

  async get(id: string): Promise<Moment | undefined> {
    if (!isUuid(id)) return undefined; // 잘못된 id → 없는 Moment
    try {
      return await fetchOne(id);
    } catch (e) {
      throw toServiceError(e, "Moment를 불러오지 못했어요.");
    }
  },

  /** 파일 업로드 → moments insert. insert가 실패하면 올린 파일을 지운다 (orphan 방지) */
  async create(input: NewMoment): Promise<Moment> {
    await requireUser("크리에이터 계정으로 로그인해야 해요.");
    if ((input.type === "photo" || input.type === "video" || input.type === "voice") && !input.media) {
      throw new ServiceError("파일을 골라 주세요.", "invalid");
    }
    if (input.type === "text" && !input.content.trim()) throw new ServiceError("내용을 입력해 주세요.", "invalid");
    if (input.content.length > 2000) throw new ServiceError("글은 2000자까지 쓸 수 있어요.", "invalid");

    let uploaded: { media: string; poster: string | null } | null = null;
    try {
      if (input.media && input.type !== "text") uploaded = await uploadMomentMedia(input.creatorId, input.type, input.media);
      const { data, error } = await supabase()
        .from("moments")
        .insert({
          creator_id: input.creatorId,
          type: input.type,
          content: input.content,
          media_url: uploaded?.media ?? null,
          poster_url: uploaded?.poster ?? null,
          duration_sec: input.durationSec && input.durationSec > 0 ? Math.min(3600, Math.round(input.durationSec)) : null,
          visibility: toDbVisibility(input.visibility),
          ai_context_enabled: input.aiContextEnabled,
        })
        .select("id")
        .single();
      if (error) throw error;

      const moment = await fetchOne(data.id);
      if (!moment) throw new ServiceError("저장했지만 불러오지 못했어요.");
      channel.emit();
      return moment;
    } catch (e) {
      if (uploaded) await removeFiles(MOMENT_BUCKET, [uploaded.media, uploaded.poster ?? ""]);
      throw toServiceError(e, "공개하지 못했어요. 다시 시도해 주세요.");
    }
  },

  async update(id: string, patch: MomentPatch): Promise<Moment | undefined> {
    if (!isUuid(id)) return undefined;
    try {
      await requireUser("크리에이터 계정으로 로그인해야 해요.");
      const row: Record<string, unknown> = {};
      if (patch.content !== undefined) {
        if (patch.content.length > 2000) throw new ServiceError("글은 2000자까지 쓸 수 있어요.", "invalid");
        row.content = patch.content;
      }
      if (patch.visibility !== undefined) row.visibility = toDbVisibility(patch.visibility);
      if (patch.aiContextEnabled !== undefined) row.ai_context_enabled = patch.aiContextEnabled;
      const { data, error } = await supabase().from("moments").update(row).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) return undefined; // 없거나 본인 Moment가 아님 (RLS)
      channel.emit();
      return fetchOne(id);
    } catch (e) {
      throw toServiceError(e, "수정하지 못했어요.");
    }
  },

  /**
   * DB 행을 먼저 지우고 → 연결된 파일을 지운다.
   * 순서가 반대면 "파일 없는 Moment"가 남을 수 있다. 파일 삭제가 실패해 남은 파일은 orphan 정리 스크립트가 지운다.
   */
  async remove(id: string): Promise<void> {
    if (!isUuid(id)) throw new ServiceError("이미 지워진 Moment예요.", "not_found");
    try {
      await requireUser("크리에이터 계정으로 로그인해야 해요.");
      const { data, error } = await supabase().from("moments").delete().eq("id", id).select("media_url, poster_url");
      if (error) throw error;
      if (!data?.length) throw new ServiceError("이미 지워졌거나 지울 수 없는 Moment예요.", "not_found");
      const row = data[0] as { media_url: string | null; poster_url: string | null };
      const files = [row.media_url, row.poster_url].filter((p): p is string => !!p && isStoragePath(p));
      await removeFiles(MOMENT_BUCKET, files);
      for (const f of files) signed.delete(f);
      channel.emit();
    } catch (e) {
      throw toServiceError(e, "삭제하지 못했어요.");
    }
  },

  /** 반응 토글 — 눌린 상태가 되면 true */
  async toggleReaction(id: string, kind: ReactionKey): Promise<boolean> {
    if (!isUuid(id)) throw new ServiceError("이미 지워진 Moment예요.", "not_found");
    try {
      const uid = await requireUser("로그인하면 반응을 남길 수 있어요.");
      const sb = supabase();
      const mine = { moment_id: id, user_id: uid, kind };
      const { data: existing, error } = await sb.from("moment_reactions").select("kind").match(mine).maybeSingle();
      if (error) throw error;
      const { error: writeError } = existing
        ? await sb.from("moment_reactions").delete().match(mine)
        : await sb.from("moment_reactions").insert(mine);
      // 동시에 두 번 눌러 이미 있는 경우(23505)는 성공으로 본다
      if (writeError && writeError.code !== "23505") throw writeError;
      channel.emit();
      return !existing;
    } catch (e) {
      throw toServiceError(e, "반응을 남기지 못했어요.");
    }
  },

  /** 내가 이 Moment에 남긴 반응 (RLS: 본인 반응만 보인다) */
  async myReactions(id: string): Promise<ReactionKey[]> {
    if (!isUuid(id)) return [];
    const uid = await currentUserId();
    if (!uid) return [];
    const { data, error } = await supabase().from("moment_reactions").select("kind").eq("moment_id", id).eq("user_id", uid);
    if (error) throw toServiceError(error);
    return (data ?? []).map((r) => r.kind as ReactionKey);
  },

  subscribe: (listener: () => void) => channel.subscribe(listener),
};
