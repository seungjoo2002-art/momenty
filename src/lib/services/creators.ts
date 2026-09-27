/**
 * Creator 데이터 접근 레이어 (public.creators).
 * 조회는 누구나, 생성은 본인 profile로만, 수정은 본인만 (RLS + 컬럼 단위 권한).
 * verified · follower_count · 가격 같은 값은 앱에서 바꿀 수 없다 (DB가 거부한다).
 */
import { currentUserId, supabase } from "@/lib/supabase/client";
import type { CategoryKey, Creator } from "@/lib/types";
import { ServiceError, toServiceError } from "./errors";
import { AVATAR_BUCKET, avatarPathOf, removeFiles, uploadAvatar } from "./media";

interface CreatorRow {
  id: string;
  profile_id: string;
  name: string;
  handle: string;
  job: string;
  category: CategoryKey;
  bio: string;
  avatar_url: string | null;
  cover_url: string | null;
  price_subscriber: number;
  price_premium: number;
  verified: boolean;
  tags: string[];
  persona_enabled: boolean;
  follower_count: number;
  subscriber_count: number;
}

const COLUMNS =
  "id, profile_id, name, handle, job, category, bio, avatar_url, cover_url, price_subscriber, price_premium, verified, tags, persona_enabled, follower_count, subscriber_count";

function toCreator(r: CreatorRow): Creator {
  return {
    id: r.id,
    profileId: r.profile_id,
    name: r.name,
    handle: r.handle,
    job: r.job,
    category: r.category,
    bio: r.bio,
    avatarUrl: r.avatar_url ?? "",
    // 커버 사진이 없는 새 크리에이터는 프로필 사진을 커버로 쓴다
    coverUrl: r.cover_url || r.avatar_url || "",
    followers: r.follower_count,
    subscribers: r.subscriber_count,
    pricing: { subscriber: r.price_subscriber, premium: r.price_premium },
    verified: r.verified,
    tags: r.tags,
    personaEnabled: r.persona_enabled,
  };
}

// 크리에이터 목록 — 브라우저에서는 잠시 재사용한다 (가입 · 수정 · 팔로우하면 invalidateCreators로 비운다)
let cached: { at: number; list: Promise<Creator[]> } | null = null;
const CACHE_MS = 30_000;

export function invalidateCreators() {
  cached = null;
}

async function loadAll(): Promise<Creator[]> {
  const run = async () => {
    const { data, error } = await supabase().from("creators").select(COLUMNS).order("created_at");
    if (error) throw toServiceError(error, "크리에이터 정보를 불러오지 못했어요.");
    return (data as CreatorRow[]).map(toCreator);
  };
  if (typeof window === "undefined") return run();
  if (!cached || Date.now() - cached.at > CACHE_MS) {
    const list = run().catch((e) => {
      cached = null;
      throw e;
    });
    cached = { at: Date.now(), list };
  }
  return cached.list;
}

export async function getCreators(category?: CategoryKey): Promise<Creator[]> {
  const all = await loadAll();
  return category ? all.filter((c) => c.category === category) : all;
}

export async function getCreator(id: string): Promise<Creator | undefined> {
  if (!/^[a-z0-9_-]{1,40}$/.test(id)) return undefined;
  const { data, error } = await supabase().from("creators").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw toServiceError(error, "크리에이터 정보를 불러오지 못했어요.");
  return data ? toCreator(data as CreatorRow) : undefined;
}

/** 로그인한 사용자의 크리에이터 프로필 (없으면 null) */
export async function getMyCreator(userId?: string): Promise<Creator | null> {
  const uid = userId ?? (await currentUserId());
  if (!uid) return null;
  const { data, error } = await supabase().from("creators").select(COLUMNS).eq("profile_id", uid).maybeSingle();
  if (error) throw toServiceError(error, "크리에이터 정보를 불러오지 못했어요.");
  return data ? toCreator(data as CreatorRow) : null;
}

/* ---------- 크리에이터 프로필 만들기 · 수정 ---------- */

export const HANDLE_RULE = /^[a-z0-9._]{2,30}$/;

export interface CreatorProfileInput {
  name: string;
  handle: string;
  bio: string;
  category: CategoryKey;
  /** 새로 고른 프로필 사진 (없으면 그대로) */
  avatarFile?: Blob | null;
}

export function validateCreatorProfile(input: Omit<CreatorProfileInput, "avatarFile">): string | null {
  const name = input.name.trim();
  if (!name) return "활동명을 입력해 주세요.";
  if (name.length > 40) return "활동명은 40자까지 쓸 수 있어요.";
  if (!HANDLE_RULE.test(input.handle)) return "사용자 이름은 영문 소문자 · 숫자 · 마침표 · 밑줄로 2~30자예요.";
  if (input.bio.length > 300) return "소개는 300자까지 쓸 수 있어요.";
  if (!input.category) return "카테고리를 골라 주세요.";
  return null;
}

/** 사용자 이름을 쓸 수 있는지 (본인이 이미 쓰는 이름이면 true) */
export async function isHandleAvailable(handle: string, myCreatorId?: string): Promise<boolean> {
  const { data, error } = await supabase().from("creators").select("id").eq("handle", handle).maybeSingle();
  if (error) throw toServiceError(error);
  return !data || data.id === myCreatorId;
}

async function requireUser(): Promise<string> {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError("로그인이 필요해요.", "auth");
  return uid;
}

/** 프로필 사진을 먼저 올리고, DB 저장이 실패하면 방금 올린 사진을 지운다 */
async function withAvatar<T>(uid: string, file: Blob | null | undefined, save: (avatarUrl: string | undefined) => Promise<T>): Promise<T> {
  const uploaded = file ? await uploadAvatar(uid, file) : null;
  try {
    return await save(uploaded?.url);
  } catch (e) {
    if (uploaded) await removeFiles(AVATAR_BUCKET, [uploaded.path]);
    throw e;
  }
}

function duplicateHandle(e: unknown) {
  const err = e as { code?: string; message?: string };
  return err?.code === "23505" && /handle/.test(err.message ?? "");
}

/** 크리에이터 시작하기 — 본인 profile로 creators 행을 만든다 (한 계정에 하나) */
export async function createCreatorProfile(input: CreatorProfileInput): Promise<Creator> {
  const invalid = validateCreatorProfile(input);
  if (invalid) throw new ServiceError(invalid, "invalid");
  const uid = await requireUser();
  try {
    if (await getMyCreator(uid)) throw new ServiceError("이미 크리에이터 프로필이 있어요.", "conflict");
    const creator = await withAvatar(uid, input.avatarFile, async (avatarUrl) => {
      const { data, error } = await supabase()
        .from("creators")
        .insert({
          profile_id: uid,
          name: input.name.trim(),
          handle: input.handle,
          bio: input.bio.trim(),
          category: input.category,
          avatar_url: avatarUrl ?? null,
        })
        .select(COLUMNS)
        .single();
      if (error) throw error;
      return toCreator(data as CreatorRow);
    });
    // 팬 화면(My · 댓글 자리)에서도 같은 이름 · 사진을 쓰도록 profile도 맞춘다
    await supabase()
      .from("profiles")
      .update({ nickname: creator.name, ...(creator.avatarUrl ? { avatar_url: creator.avatarUrl } : {}) })
      .eq("id", uid);
    invalidateCreators();
    return creator;
  } catch (e) {
    if (duplicateHandle(e)) throw new ServiceError("이미 사용 중인 사용자 이름이에요.", "conflict", e);
    throw toServiceError(e, "크리에이터 프로필을 만들지 못했어요.");
  }
}

/** 크리에이터 본인 프로필 수정. 사진을 바꾸면 예전 사진 파일은 지운다. */
export async function updateCreatorProfile(creatorId: string, input: CreatorProfileInput): Promise<Creator> {
  const invalid = validateCreatorProfile(input);
  if (invalid) throw new ServiceError(invalid, "invalid");
  const uid = await requireUser();
  try {
    const before = await getMyCreator(uid);
    if (!before || before.id !== creatorId) throw new ServiceError("내 크리에이터 프로필만 고칠 수 있어요.", "forbidden");
    const updated = await withAvatar(uid, input.avatarFile, async (avatarUrl) => {
      const { data, error } = await supabase()
        .from("creators")
        .update({
          name: input.name.trim(),
          handle: input.handle,
          bio: input.bio.trim(),
          category: input.category,
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        })
        .eq("id", creatorId)
        .select(COLUMNS);
      if (error) throw error;
      if (!data?.length) throw new ServiceError("내 크리에이터 프로필만 고칠 수 있어요.", "forbidden");
      return toCreator(data[0] as CreatorRow);
    });
    if (input.avatarFile) {
      await supabase().from("profiles").update({ avatar_url: updated.avatarUrl }).eq("id", uid);
      const old = avatarPathOf(before.avatarUrl);
      if (old && old.startsWith(`${uid}/`)) await removeFiles(AVATAR_BUCKET, [old]);
    }
    invalidateCreators();
    return updated;
  } catch (e) {
    if (duplicateHandle(e)) throw new ServiceError("이미 사용 중인 사용자 이름이에요.", "conflict", e);
    throw toServiceError(e, "프로필을 저장하지 못했어요.");
  }
}
