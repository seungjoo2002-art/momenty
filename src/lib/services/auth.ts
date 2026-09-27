/**
 * 로그인 · 가입 · 계정 상태 (Supabase Auth).
 *
 * 역할 구조
 *   · 모든 가입자는 profiles 행을 가진다 (가입 trigger가 만든다).
 *   · 크리에이터 = creators 행이 있는 사람. 역할을 잠그는 플래그는 없다 —
 *     팬으로 가입한 사람도 나중에 크리에이터 프로필을 만들 수 있고, 크리에이터도 다른 크리에이터를 팔로우할 수 있다.
 *   · 가입할 때 고른 시작 방식(signup_role)은 "가입 직후 어디로 안내할지"에만 쓴다 (권한과 무관).
 *   · 관심 카테고리 · 온보딩 완료 여부는 본인만 바꿀 수 있는 Auth user_metadata에 둔다.
 */
import type { AuthChangeEvent, User } from "@supabase/supabase-js";
import { currentUserId, supabase } from "@/lib/supabase/client";
import type { CategoryKey, Creator } from "@/lib/types";
import { getMyCreator } from "./creators";
import { ServiceError, toServiceError } from "./errors";

export type StartRole = "fan" | "creator";

export interface Account {
  userId: string;
  email: string;
  nickname: string;
  avatarUrl: string;
  joinedAt: string;
  /** 가입할 때 고른 시작 방식 — 안내용 */
  startRole: StartRole | null;
  interests: CategoryKey[];
  /** 팬 온보딩(관심 카테고리)을 마쳤는지 */
  onboarded: boolean;
  /** 크리에이터 프로필 (없으면 팬 기능만) */
  creator: Creator | null;
}

export const PASSWORD_MIN = 8;

function origin() {
  return typeof window === "undefined" ? "" : window.location.origin;
}

export function validateEmail(email: string): string | null {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ? null : "이메일 주소를 확인해 주세요.";
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `비밀번호는 ${PASSWORD_MIN}자 이상이어야 해요.`;
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) return "비밀번호에 영문과 숫자를 함께 넣어 주세요.";
  return null;
}

export interface SignUpInput {
  email: string;
  password: string;
  nickname: string;
  role: StartRole;
}

/** 가입. 메일 확인이 필요한 프로젝트면 needsConfirmation = true (세션 없음) */
export async function signUp({ email, password, nickname, role }: SignUpInput): Promise<{ needsConfirmation: boolean }> {
  const invalid = validateEmail(email) ?? validatePassword(password) ?? (nickname.trim() ? null : "이름을 입력해 주세요.");
  if (invalid) throw new ServiceError(invalid, "invalid");
  try {
    const { data, error } = await supabase().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { nickname: nickname.trim().slice(0, 30), signup_role: role },
        emailRedirectTo: `${origin()}/auth/callback`,
      },
    });
    if (error) throw error;
    // 메일 확인이 켜져 있으면 이미 가입된 이메일도 오류 없이 빈 identities로 돌아온다
    if (data.user && data.user.identities?.length === 0) {
      throw new ServiceError("이미 가입된 이메일일 수 있어요. 로그인하거나 비밀번호를 재설정해 주세요.", "conflict");
    }
    return { needsConfirmation: !data.session };
  } catch (e) {
    throw toServiceError(e, "가입하지 못했어요. 다시 시도해 주세요.");
  }
}

export async function resendConfirmation(email: string): Promise<void> {
  try {
    const { error } = await supabase().auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: `${origin()}/auth/callback` },
    });
    if (error) throw error;
  } catch (e) {
    throw toServiceError(e, "메일을 다시 보내지 못했어요.");
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  if (validateEmail(email)) throw new ServiceError("이메일 주소를 확인해 주세요.", "invalid");
  if (!password) throw new ServiceError("비밀번호를 입력해 주세요.", "invalid");
  try {
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  } catch (e) {
    throw toServiceError(e, "로그인하지 못했어요. 다시 시도해 주세요.");
  }
}

export async function signOut(): Promise<void> {
  try {
    const { error } = await supabase().auth.signOut();
    if (error) throw error;
  } catch (e) {
    throw toServiceError(e, "로그아웃하지 못했어요.");
  }
}

/** 비밀번호 재설정 메일 — 가입 여부와 상관없이 같은 안내를 보여준다 (계정 존재 여부 노출 방지) */
export async function requestPasswordReset(email: string): Promise<void> {
  if (validateEmail(email)) throw new ServiceError("이메일 주소를 확인해 주세요.", "invalid");
  try {
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${origin()}/reset-password` });
    if (error) throw error;
  } catch (e) {
    throw toServiceError(e, "메일을 보내지 못했어요. 다시 시도해 주세요.");
  }
}

/** 재설정 링크로 들어와 세션이 생긴 뒤 새 비밀번호 저장 */
export async function updatePassword(password: string): Promise<void> {
  const invalid = validatePassword(password);
  if (invalid) throw new ServiceError(invalid, "invalid");
  try {
    const { error } = await supabase().auth.updateUser({ password });
    if (error) throw error;
  } catch (e) {
    throw toServiceError(e, "비밀번호를 바꾸지 못했어요.");
  }
}

export function onAuthChange(listener: (event: AuthChangeEvent, userId: string | null) => void): () => void {
  const { data } = supabase().auth.onAuthStateChange((event, session) => listener(event, session?.user.id ?? null));
  return () => data.subscription.unsubscribe();
}

function metaOf(user: User) {
  const m = (user.user_metadata ?? {}) as { signup_role?: string; interests?: unknown; onboarded?: boolean };
  return {
    startRole: m.signup_role === "creator" || m.signup_role === "fan" ? (m.signup_role as StartRole) : null,
    interests: Array.isArray(m.interests) ? (m.interests.filter((x) => typeof x === "string") as CategoryKey[]) : [],
    onboarded: m.onboarded === true,
  };
}

/** 로그인한 사용자의 계정 상태. 로그인하지 않았으면 null. */
export async function getAccount(): Promise<Account | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  try {
    const sb = supabase();
    const [{ data: userData, error: userError }, profile, creator] = await Promise.all([
      sb.auth.getUser(),
      sb.from("profiles").select("nickname, avatar_url, created_at").eq("id", uid).maybeSingle(),
      getMyCreator(uid),
    ]);
    if (userError) throw userError;
    if (profile.error) throw profile.error;
    const user = userData.user;
    return {
      userId: uid,
      email: user.email ?? "",
      nickname: profile.data?.nickname || creator?.name || "",
      avatarUrl: profile.data?.avatar_url || creator?.avatarUrl || "",
      joinedAt: String(profile.data?.created_at ?? user.created_at ?? "").slice(0, 10),
      ...metaOf(user),
      creator,
    };
  } catch (e) {
    throw toServiceError(e, "계정 정보를 불러오지 못했어요.");
  }
}

/** 팬 온보딩: 관심 카테고리 저장 (건너뛰어도 완료로 표시) */
export async function saveInterests(interests: CategoryKey[]): Promise<void> {
  try {
    const { error } = await supabase().auth.updateUser({ data: { interests, onboarded: true } });
    if (error) throw error;
  } catch (e) {
    throw toServiceError(e, "저장하지 못했어요.");
  }
}

/** 가입 직후 · 로그인 직후 어디로 보낼지 */
export function nextPathFor(account: Account): string {
  if (account.creator) return "/studio";
  if (account.startRole === "creator") return "/setup/creator";
  if (!account.onboarded) return "/setup/interests";
  return "/today";
}
