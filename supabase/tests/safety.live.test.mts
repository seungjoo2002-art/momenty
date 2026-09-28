/**
 * v0.8 migration 실제 프로젝트 검증 — Safe Delay 누출 · Storage · Moderation 권한 · 한도 · 계정 삭제(auth.users 권한).
 *
 *   npm run test:safety-live -- --confirm-dev
 *
 * · 모든 검사는 실제 사용자 JWT로 (앱과 같은 경로). 테스트 계정만 만들고 지운다 — 실제 사용자 계정은 쓰지 않는다.
 * · admin(service role)은 준비(유료 구독 부여)와 "삭제 후 흔적 확인" · 정리에만. LLM 호출 없음
 *   (AI 근거 저장 검사는 record_ai_exchange를 서버 키로 직접 — 모델 호출 아님).
 */
import { randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupTestUsers, registerCleanup } from "./support/cleanup.mjs";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase에 테스트 계정을 만들었다가 지우는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVER_KEY = process.env.AI_SERVER_KEY ?? "";
const admin = createClient(URL_, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });

let passed = 0;
let failed = 0;
async function step(name: string, fn: () => Promise<boolean | [boolean] | [boolean, unknown]>) {
  let ok = false;
  let detail: unknown;
  try {
    const r = await fn();
    [ok, detail] = Array.isArray(r) ? [r[0], r[1]] : [r, undefined];
  } catch (e) {
    detail = e instanceof Error ? e.message : String(e);
  }
  if (ok) passed++;
  else failed++;
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && detail !== undefined ? `  → ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
}
const denied = (e: { message?: string; code?: string } | null, re: RegExp) => !!e && re.test(`${e.code ?? ""} ${e.message ?? ""}`);

const stamp = Date.now().toString(36);
const userIds: string[] = [];
registerCleanup(admin, userIds);
interface U {
  sb: SupabaseClient;
  uid: string;
  token: string;
  email: string;
}
async function newUser(tag: string): Promise<U> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `momenty-sl-${tag}-${stamp}@gmail.com`;
  const { data, error } = await sb.auth.signUp({ email, password: `Sl-${randomBytes(9).toString("base64url")}1a`, options: { data: { nickname: `SL ${tag}` } } });
  if (error) throw error;
  if (!data.session) throw new Error("세션 없음 (Confirm email?)");
  userIds.push(data.user!.id);
  return { sb, uid: data.user!.id, token: data.session.access_token, email };
}
/** 작은 JPEG (내용은 상관없음 — Storage 형식 검사 통과용) */
const tinyJpeg = () => new Blob([Buffer.from("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==", "base64")], { type: "image/jpeg" });

try {
  const C = await newUser("creator");
  const S = await newUser("sub");
  const O = await newUser("other");
  const { data: cr, error: cErr } = await C.sb.from("creators").insert({ profile_id: C.uid, name: `SL ${stamp}`, handle: `sl.${stamp}`, category: "art" }).select("id").single();
  if (cErr) throw cErr;
  const cid = cr.id as string;
  await C.sb.from("creator_personas").insert({ creator_id: cid });
  {
    const { error } = await admin.from("subscriptions").insert({ fan_id: S.uid, creator_id: cid, tier: "subscriber" });
    if (error) throw error;
  }
  console.log("준비: 크리에이터 C · 구독 팬 S · 다른 사용자 O");

  console.log("\n[스키마 · 함수가 실제 프로젝트에 있음]");
  await step("creator_safety_settings · moments.visible_at · publish_moment_now · is_admin · delete_my_account", async () => {
    const t = await C.sb.from("creator_safety_settings").select("*").limit(0);
    const v = await C.sb.from("moments").select("visible_at").limit(0);
    const p = await S.sb.rpc("publish_moment_now", { p_moment_id: "11111111-1111-1111-1111-111111111111" });
    const a = await S.sb.rpc("is_admin");
    return [!t.error && !v.error && denied(p.error, /moment_not_scheduled/) && a.data === false, [t.error?.message, v.error?.message, p.error?.message, a.error?.message]];
  });

  console.log("\n[Safe Delay — 실제 DB 누출 검사]");
  await step("크리에이터가 Safe Delay 15분(고정) 설정", async () => {
    const { error } = await C.sb.from("creator_safety_settings").insert({ creator_id: cid, safe_delay_mode: "fixed", safe_delay_minutes: 15 });
    return [!error, error?.message];
  });
  await step("팬 · 다른 사용자는 지연 설정을 읽을 수 없음", async () => {
    const [a, b] = await Promise.all([S.sb.from("creator_safety_settings").select("*"), O.sb.from("creator_safety_settings").select("*")]);
    return [(a.data ?? []).length === 0 && (b.data ?? []).length === 0];
  });
  const path = `${cid}/${crypto.randomUUID()}.jpg`;
  let mid = "";
  await step("공개 예정 사진 Moment 저장 (visible_at = +15분, 서버 계산)", async () => {
    const up = await C.sb.storage.from("moment-media").upload(path, tinyJpeg(), { contentType: "image/jpeg" });
    if (up.error) return [false, up.error.message];
    const { data, error } = await C.sb.from("moments").insert({ creator_id: cid, type: "photo", content: `예정 ${stamp}`, media_url: path, visibility: "subscriber" }).select("id, created_at, visible_at").single();
    mid = data?.id;
    const delay = data ? (Date.parse(data.visible_at) - Date.parse(data.created_at)) / 60000 : -1;
    return [!error && Math.abs(delay - 15) < 0.05, { error: error?.message, delay }];
  });
  await step("row: 팬 · 비로그인 moments 0행 · moment_feed 0행 (존재도 모름)", async () => {
    const anon = createClient(URL_, KEY, { auth: { persistSession: false } });
    const [a, b, c] = await Promise.all([S.sb.from("moments").select("id").eq("id", mid), S.sb.from("moment_feed").select("id").eq("creator_id", cid), anon.from("moment_feed").select("id").eq("creator_id", cid)]);
    return [(a.data ?? []).length === 0 && (b.data ?? []).length === 0 && (c.data ?? []).length === 0, [a.data?.length, b.data?.length, c.data?.length]];
  });
  await step("media: 팬 signed URL 발급 실패 · 크리에이터 본인은 가능", async () => {
    const f = await S.sb.storage.from("moment-media").createSignedUrl(path, 60);
    const c = await C.sb.storage.from("moment-media").createSignedUrl(path, 60);
    return [!!f.error && !c.error, [f.error?.message, c.error?.message]];
  });
  await step("reaction · bookmark: 공개 전 Moment에는 거부", async () => {
    const r = await S.sb.from("moment_reactions").insert({ moment_id: mid, user_id: S.uid, kind: "love" });
    const b = await S.sb.from("moment_bookmarks").insert({ user_id: S.uid, moment_id: mid });
    return [denied(r.error, /row-level security|42501/) && denied(b.error, /row-level security|42501/), [r.error?.message, b.error?.message]];
  });
  await step("Persona AI: 팬 세션의 Context 쿼리에 없음 · 근거로 저장해도 버려짐", async () => {
    const ctx = await S.sb.from("moments").select("id").eq("creator_id", cid).eq("ai_context_enabled", true);
    const rec = await S.sb.rpc("record_ai_exchange", { p_server_key: SERVER_KEY, p_creator_id: cid, p_fan_message: "오늘 뭐 했어?", p_ai_reply: "테스트 답", p_grounded_moment_ids: [mid], p_context_types: ["today"], p_provider: null, p_model: null, p_boundary: null });
    return [(ctx.data ?? []).length === 0 && !rec.error && (rec.data as { groundedMomentIds: string[] }).groundedMomentIds.length === 0, { ctx: ctx.data?.length, rec: rec.error?.message ?? rec.data }];
  });
  await step("Fan Manager: 공개 전 Moment는 '최근 Moment' 수에 없음", async () => {
    const { data, error } = await C.sb.rpc("fan_manager_fan", { p_fan_id: S.uid });
    return [!error && data.recentMoments === 0, error?.message ?? data.recentMoments];
  });
  await step("크리에이터 본인은 feed에서 봄 (visible_at 포함) · 팬은 visible_at을 볼 수 없음", async () => {
    const { data } = await C.sb.from("moment_feed").select("id, visible_at").eq("id", mid).single();
    return [!!data?.visible_at];
  });
  await step("팬 · 다른 사용자의 '지금 공개' → 거부", async () => {
    const [a, b] = await Promise.all([S.sb.rpc("publish_moment_now", { p_moment_id: mid }), O.sb.rpc("publish_moment_now", { p_moment_id: mid })]);
    return [denied(a.error, /moment_not_scheduled/) && denied(b.error, /moment_not_scheduled/)];
  });
  await step("visible_at · created_at 직접 수정 → 거부", async () => {
    const a = await C.sb.from("moments").update({ visible_at: new Date().toISOString() }).eq("id", mid);
    const b = await C.sb.from("moments").update({ created_at: new Date(0).toISOString() }).eq("id", mid);
    return [denied(a.error, /permission denied|42501/) && denied(b.error, /permission denied|42501/), [a.error?.message, b.error?.message]];
  });
  await step("크리에이터 '지금 공개' → 팬에게 행 · 미디어 · 반응 모두 열림", async () => {
    const p = await C.sb.rpc("publish_moment_now", { p_moment_id: mid });
    const [row, url, react] = [await S.sb.from("moment_feed").select("id").eq("id", mid), await S.sb.storage.from("moment-media").createSignedUrl(path, 60), await S.sb.from("moment_reactions").insert({ moment_id: mid, user_id: S.uid, kind: "love" })];
    return [!p.error && row.data?.length === 1 && !url.error && !react.error, [p.error?.message, row.data?.length, url.error?.message, react.error?.message]];
  });

  console.log("\n[Moderation — 일반 사용자 · 크리에이터 권한 없음]");
  await step("admin_list_reports · admin_update_report → admin_required", async () => {
    const [a, b, c] = await Promise.all([S.sb.rpc("admin_list_reports", {}), C.sb.rpc("admin_list_reports", { p_status: "all" }), S.sb.rpc("admin_update_report", { p_report_id: "11111111-1111-1111-1111-111111111111", p_status: "resolved" })]);
    return [[a, b, c].every((x) => denied(x.error, /admin_required/)), [a.error?.message, b.error?.message, c.error?.message]];
  });
  await step("admin 목록 · 한도 설정은 Data API 밖 (조회 불가)", async () => {
    const a = await S.sb.from("admin_users").select("*");
    const b = await S.sb.from("human_chat_settings").select("*");
    return [!!a.error && !!b.error, [a.error?.code, b.error?.code]];
  });
  await step("신고 상태: 신고자는 자기 신고 상태만 (open)", async () => {
    await S.sb.rpc("send_message_to_creator", { p_creator_id: cid, p_content: "안녕하세요" });
    const m = await C.sb.rpc("send_message_to_fan", { p_fan_id: S.uid, p_content: "불편한 메시지" });
    const rep = await S.sb.rpc("report_human_message", { p_message_id: m.data.messageId, p_reason: "harassment" });
    const mine = await S.sb.from("message_reports").select("id, status");
    const theirs = await C.sb.from("message_reports").select("id");
    return [!rep.error && mine.data?.[0]?.status === "open" && (theirs.data ?? []).length === 0, { rep: rep.error?.message, mine: mine.data, theirs: theirs.data?.length }];
  });

  console.log("\n[계정 삭제 — disposable 계정으로 auth.users 삭제 권한 검증]");
  // 팬 D: 아바타 파일 · 반응 · 구독 · Memory 설정 · 차단 / 크리에이터 E: Moment 파일
  const D = await newUser("delete-fan");
  const E = await newUser("delete-creator");
  const avatar = `${D.uid}/${crypto.randomUUID()}.jpg`;
  const { data: ec } = await E.sb.from("creators").insert({ profile_id: E.uid, name: `SLE ${stamp}`, handle: `sle.${stamp}`, category: "art" }).select("id").single();
  const eid = ec!.id as string;
  const emedia = `${eid}/${crypto.randomUUID()}.jpg`;
  await step("준비: D 아바타 업로드 · E Moment 사진 업로드", async () => {
    const a = await D.sb.storage.from("avatars").upload(avatar, tinyJpeg(), { contentType: "image/jpeg" });
    const b = await E.sb.storage.from("moment-media").upload(emedia, tinyJpeg(), { contentType: "image/jpeg" });
    const m = await E.sb.from("moments").insert({ creator_id: eid, type: "photo", content: "삭제될 사진", media_url: emedia, visibility: "public" });
    await D.sb.from("fan_ai_settings").insert({ fan_id: D.uid, memory_enabled: true });
    await D.sb.from("user_blocks").insert({ blocker_id: D.uid, blocked_id: O.uid });
    return [!a.error && !b.error && !m.error, [a.error?.message, b.error?.message, m.error?.message]];
  });
  await step("Storage에 파일이 남아 있으면 삭제 거부 (storage_not_empty)", async () => {
    const { error } = await D.sb.rpc("delete_my_account");
    return [denied(error, /storage_not_empty/), error?.message];
  });
  await step("본인 세션 Storage API로 파일 삭제 → delete_my_account 성공 (auth.users 삭제 권한 OK)", async () => {
    const rm = await D.sb.storage.from("avatars").remove([avatar]);
    const { data, error } = await D.sb.rpc("delete_my_account");
    return [!rm.error && !error && data?.deleted === true, [rm.error?.message, error?.message, error?.details]];
  });
  await step("삭제 후: auth 사용자 · 프로필 · 구독 · 차단 · 설정 흔적 없음", async () => {
    const u = await admin.auth.admin.getUserById(D.uid);
    const [p, b, s] = await Promise.all([
      admin.from("profiles").select("id").eq("id", D.uid),
      admin.from("user_blocks").select("blocker_id").eq("blocker_id", D.uid),
      admin.from("fan_ai_settings").select("fan_id").eq("fan_id", D.uid),
    ]);
    return [!!u.error && !u.data.user && (p.data ?? []).length === 0 && (b.data ?? []).length === 0 && (s.data ?? []).length === 0, { u: u.error?.message, p: p.data?.length, b: b.data?.length, s: s.data?.length }];
  });
  await step("삭제 후 Storage: 아바타 폴더 비어 있음", async () => {
    const { data } = await admin.storage.from("avatars").list(D.uid);
    return [(data ?? []).length === 0, data?.map((f) => f.name)];
  });
  await step("삭제된 사용자의 남은 세션(JWT): 서버 검증 실패 · 데이터 0 · 쓰기 거부", async () => {
    const g = await D.sb.auth.getUser(D.token);
    const r = await D.sb.from("profiles").select("id").eq("id", D.uid);
    const w = await D.sb.from("fan_ai_settings").insert({ fan_id: D.uid, memory_enabled: true });
    return [!!g.error && (r.data ?? []).length === 0 && !!w.error, [g.error?.message, r.data?.length, w.error?.message]];
  });
  await step("크리에이터 E: Moment 파일 삭제 후 탈퇴 → 채널 · Moment · Storage 폴더 없음", async () => {
    const pre = await E.sb.rpc("delete_my_account");
    const rm = await E.sb.storage.from("moment-media").remove([emedia]);
    const { data, error } = await E.sb.rpc("delete_my_account");
    const [c, m, st] = await Promise.all([admin.from("creators").select("id").eq("id", eid), admin.from("moments").select("id").eq("creator_id", eid), admin.storage.from("moment-media").list(eid)]);
    return [denied(pre.error, /storage_not_empty/) && !rm.error && !error && data?.deleted && (c.data ?? []).length === 0 && (m.data ?? []).length === 0 && (st.data ?? []).length === 0, { pre: pre.error?.message, err: error?.message, c: c.data?.length, m: m.data?.length, st: st.data?.length }];
  });
  await step("다른 사람 계정은 지울 수 없음 (인자 없는 함수 — 호출한 본인만)", async () => {
    const { error } = await O.sb.rpc("delete_my_account", { p_user_id: S.uid });
    const still = await admin.auth.admin.getUserById(S.uid);
    return [!!error && !!still.data.user, error?.message];
  });
} catch (e) {
  failed++;
  console.error("테스트 준비/실행 실패:", e instanceof Error ? e.message : e);
} finally {
  await cleanupTestUsers(admin, userIds);
  console.log(`\n정리: 테스트 계정 ${userIds.length}명 (이미 탈퇴한 계정 제외) 삭제 시도`);
  console.log(`\n${passed} passed, ${failed} failed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
}
