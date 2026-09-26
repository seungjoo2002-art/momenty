/**
 * Moment 저장소 — Supabase 구현.
 *
 * 읽기: public.moment_feed view — 볼 수 없는 Moment는 content · media_url이 DB에서 null로 온다.
 * 쓰기: public.moments 테이블 — RLS가 크리에이터 본인만 허용한다.
 * 반응: public.moment_reactions — (moment_id, user_id, kind) 기본키로 중복 방지.
 * 사진: Storage bucket "moment-media" (비공개) → 읽을 때 signed URL로 바꾼다.
 */
import { activeRole, sessionUserId, supabaseFor, type Role } from "@/lib/supabase/client";
import type { Moment, MomentType, SafeShareFlag, Visibility } from "@/lib/types";
import { createChannel } from "@/lib/storage/local";
import { ServiceError, toServiceError } from "../errors";
import type { MomentBackend, MomentPatch, MomentQuery, NewMoment } from "./types";

const BUCKET = "moment-media";
const FEED_COLUMNS =
  "id, creator_id, type, visibility, duration_sec, created_at, viewable, content, media_url, location, safe_share, ai_context_enabled, love_count, cheer_count, touched_count, smile_count, liked_by_me";

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
const isUuid = (id: string) => UUID.test(id);

/** Storage 경로인지 (외부 URL · data URL이 아닌 것) */
const isStoragePath = (url: string) => !/^(https?:|data:|blob:)/.test(url);

const channel = createChannel([]);

/* ---------- signed URL ---------- */

// 같은 사진이 다시 불러올 때마다 다른 URL이 되어 깜빡이지 않도록 잠시 기억한다
const signed = new Map<string, { url: string; expires: number }>();
const SIGN_SECONDS = 60 * 60;

async function signMedia(role: Role | null, rows: FeedRow[]): Promise<Map<string, string>> {
  const now = Date.now();
  const paths = [...new Set(rows.map((r) => r.media_url).filter((u): u is string => !!u && isStoragePath(u)))];
  const missing = paths.filter((p) => (signed.get(p)?.expires ?? 0) < now + 5 * 60_000);
  if (missing.length) {
    const sb = await supabaseFor(role);
    const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(missing, SIGN_SECONDS);
    if (error) console.error("[momenty/storage]", error);
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) signed.set(item.path, { url: item.signedUrl, expires: now + SIGN_SECONDS * 1000 });
    }
  }
  return new Map(paths.flatMap((p) => (signed.has(p) ? [[p, signed.get(p)!.url] as const] : [])));
}

function toMoment(r: FeedRow, urls: Map<string, string>): Moment {
  const media = r.media_url ? (isStoragePath(r.media_url) ? urls.get(r.media_url) : r.media_url) : undefined;
  return {
    id: r.id,
    creatorId: r.creator_id,
    type: r.type,
    content: r.content ?? "",
    mediaUrl: media,
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

async function hydrate(role: Role | null, rows: FeedRow[]): Promise<Moment[]> {
  const urls = await signMedia(role, rows);
  return rows.map((r) => toMoment(r, urls));
}

/** 쓰기는 크리에이터 세션이 있어야 한다 */
async function creatorClient() {
  const uid = await sessionUserId("creator").catch((e) => {
    throw toServiceError(e);
  });
  if (!uid) throw new ServiceError("크리에이터 계정으로 로그인해야 해요.", "auth");
  return supabaseFor("creator");
}

async function fetchOne(role: Role | null, id: string): Promise<Moment | undefined> {
  const sb = await supabaseFor(role);
  const { data, error } = await sb.from("moment_feed").select(FEED_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw toServiceError(error);
  return data ? (await hydrate(role, [data as FeedRow]))[0] : undefined;
}

async function uploadPhoto(creatorId: string, dataUrl: string): Promise<string> {
  const sb = await creatorClient();
  const blob = await (await fetch(dataUrl)).blob();
  const ext = blob.type === "image/png" ? "png" : "jpg";
  const path = `${creatorId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, blob, { contentType: blob.type || "image/jpeg", upsert: false });
  if (error) throw toServiceError(error, "사진을 올리지 못했어요. 다시 시도해 주세요.");
  return path;
}

export const supabaseMoments: MomentBackend = {
  async list(q: MomentQuery) {
    const ids = q.ids?.filter(isUuid);
    if (ids && ids.length === 0) return [];
    const role = activeRole();
    try {
      const sb = await supabaseFor(role);
      let query = sb.from("moment_feed").select(FEED_COLUMNS);
      if (q.creatorIds) query = query.in("creator_id", q.creatorIds);
      if (ids) query = query.in("id", ids);
      if (q.from) query = query.gte("created_at", q.from);
      if (q.to) query = query.lt("created_at", q.to);
      query = query.order("created_at", { ascending: q.order !== "desc" }).limit(q.limit ?? 1000);
      const { data, error } = await query;
      if (error) throw error;
      return hydrate(role, (data ?? []) as FeedRow[]);
    } catch (e) {
      throw toServiceError(e, "Moment를 불러오지 못했어요.");
    }
  },

  async get(id) {
    if (!isUuid(id)) return undefined; // 잘못된 id → 없는 Moment
    try {
      return await fetchOne(activeRole(), id);
    } catch (e) {
      throw toServiceError(e, "Moment를 불러오지 못했어요.");
    }
  },

  async create(input: NewMoment) {
    let uploaded: string | undefined;
    try {
      const sb = await creatorClient();
      let mediaUrl = input.mediaUrl;
      if (mediaUrl?.startsWith("data:")) mediaUrl = uploaded = await uploadPhoto(input.creatorId, mediaUrl);

      const { data, error } = await sb
        .from("moments")
        .insert({
          creator_id: input.creatorId,
          type: input.type,
          content: input.content,
          media_url: mediaUrl ?? null,
          duration_sec: input.durationSec ?? null,
          visibility: toDbVisibility(input.visibility),
          ai_context_enabled: input.aiContextEnabled,
        })
        .select("id")
        .single();
      if (error) throw error;

      const moment = await fetchOne("creator", data.id);
      if (!moment) throw new ServiceError("저장했지만 불러오지 못했어요.");
      channel.emit();
      return moment;
    } catch (e) {
      // DB 저장에 실패하면 올린 사진도 지운다
      if (uploaded) {
        const sb = await supabaseFor("creator");
        await sb.storage.from(BUCKET).remove([uploaded]);
      }
      throw toServiceError(e, "공개하지 못했어요. 다시 시도해 주세요.");
    }
  },

  async update(id, patch: MomentPatch) {
    if (!isUuid(id)) return undefined;
    try {
      const sb = await creatorClient();
      const row: Record<string, unknown> = {};
      if (patch.content !== undefined) row.content = patch.content;
      if (patch.mediaUrl !== undefined) row.media_url = patch.mediaUrl;
      if (patch.visibility !== undefined) row.visibility = toDbVisibility(patch.visibility);
      if (patch.aiContextEnabled !== undefined) row.ai_context_enabled = patch.aiContextEnabled;
      const { data, error } = await sb.from("moments").update(row).eq("id", id).select("id");
      if (error) throw error;
      if (!data?.length) return undefined; // 없거나 본인 Moment가 아님 (RLS)
      channel.emit();
      return fetchOne("creator", id);
    } catch (e) {
      throw toServiceError(e, "수정하지 못했어요.");
    }
  },

  async remove(id) {
    if (!isUuid(id)) throw new ServiceError("이미 지워진 Moment예요.", "not_found");
    try {
      const sb = await creatorClient();
      const { data, error } = await sb.from("moments").delete().eq("id", id).select("media_url");
      if (error) throw error;
      if (!data?.length) throw new ServiceError("이미 지워졌거나 지울 수 없는 Moment예요.", "not_found");
      const media = (data[0] as { media_url: string | null }).media_url;
      if (media && isStoragePath(media)) {
        const { error: storageError } = await sb.storage.from(BUCKET).remove([media]);
        if (storageError) console.error("[momenty/storage] 파일 정리 실패", storageError);
      }
      channel.emit();
    } catch (e) {
      throw toServiceError(e, "삭제하지 못했어요.");
    }
  },

  async toggleLove(id) {
    if (!isUuid(id)) throw new ServiceError("이미 지워진 Moment예요.", "not_found");
    try {
      const uid = await sessionUserId("fan");
      if (!uid) throw new ServiceError("로그인하면 반응을 남길 수 있어요.", "auth");
      const sb = await supabaseFor("fan");
      const mine = { moment_id: id, user_id: uid, kind: "love" as const };
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

  subscribe: (listener) => channel.subscribe(listener),
};
