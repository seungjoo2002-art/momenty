/**
 * 신규 계정 E2E — 실제 Supabase에서 새 Creator A · 새 Fan B를 가입시켜 v0.4 흐름과 보안을 검증한다.
 *
 *   npm run test:e2e -- --confirm-dev
 *
 * · 가입 · 로그인 · 프로필 · Moment · 팔로우 · 반응 · 보관은 전부 앱의 services 함수로 한다
 *   (화면의 버튼이 부르는 것과 같은 코드) → 요청은 그 사용자의 JWT로 나가고 RLS가 그대로 적용된다.
 * · 보안 공격은 같은 사용자의 JWT를 가진 supabase-js 클라이언트로 직접 보낸다 (앱이 막아 주는 것 말고 DB가 막는지).
 * · service role(admin)은 두 가지에만 쓴다:
 *     1) 가입 확인 메일의 링크 클릭 대신 이메일 확인 처리 (이 프로젝트는 메일 확인이 켜져 있다)
 *     2) 끝난 뒤 테스트 계정 · 파일 정리
 *   권한 검사에는 절대 쓰지 않는다.
 */
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase에 테스트 계정을 만들었다가 지우는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const env = (k: string) => process.env[`DEMO_${k}`] || "";
const DOMAIN = process.env.E2E_EMAIL_DOMAIN || "gmail.com";

// 메일 확인이 켜져 있으면 가입마다 실제 메일이 나간다 → 없는 주소로 보내면 반송이 쌓여 프로젝트 메일이 제한될 수 있다.
// 그래서 확인이 켜진 프로젝트에서는 E2E_EMAIL_DOMAIN(받을 수 있는 주소)을 직접 정해야만 실행한다.
{
  const settings = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } }).then((r) => r.json());
  if (!settings.mailer_autoconfirm && !process.env.E2E_EMAIL_DOMAIN) {
    console.error(
      "이 프로젝트는 가입 확인 메일이 켜져 있어요 (Authentication → Email → Confirm email).\n" +
        "끄고 실행하거나, 메일을 받을 수 있는 도메인을 E2E_EMAIL_DOMAIN 으로 지정하세요.",
    );
    process.exit(1);
  }
}

// 앱 코드(services)가 브라우저에서처럼 로그인 세션을 쓰도록
const location = { pathname: "/", href: "http://localhost:3000/", origin: "http://localhost:3000", hash: "", search: "" };
Object.assign(globalThis, { window: { location, addEventListener() {}, removeEventListener() {} } });

/* ---------- 결과 기록 ---------- */
type Item = { name: string; ok: boolean; detail?: string };
const results: { title: string; items: Item[] }[] = [];
let current: (typeof results)[number] = { title: "", items: [] };
function section(title: string) {
  current = { title, items: [] };
  results.push(current);
  console.log(`\n[${title}]`);
}
function check(name: string, ok: boolean, detail?: unknown) {
  const d = detail === undefined ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail);
  current.items.push({ name, ok, detail: d });
  console.log(`   ${ok ? "✓" : "✗"} ${name}${!ok && d ? `  → ${d}` : ""}`);
}
async function step(name: string, fn: () => Promise<boolean | [boolean, unknown]>) {
  try {
    const r = await fn();
    const [ok, detail] = Array.isArray(r) ? r : [r, undefined];
    check(name, ok, detail);
  } catch (e) {
    check(name, false, e instanceof Error ? `${e.name}: ${e.message}` : e);
  }
}
async function rejects(fn: () => Promise<unknown>): Promise<[boolean, unknown]> {
  try {
    const r = await fn();
    return [false, r ?? "허용됨!"];
  } catch (e) {
    return [true, e instanceof Error ? e.message : e];
  }
}

/** 진짜 PNG (8x8) */
function png(rgb: [number, number, number] = [108, 77, 255]): Uint8Array<ArrayBuffer> {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const t = Buffer.concat([Buffer.from(type), data]);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(t));
    return Buffer.concat([len, t, c]);
  };
  const w = 8;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(w, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: w }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill(rgb).flat())])));
  return Uint8Array.from(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
}
const pngBlob = (rgb?: [number, number, number]) => new Blob([png(rgb)], { type: "image/png" });

/* ---------- 준비 ---------- */
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anon = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
/** 같은 사용자의 JWT로 직접 요청을 보내는 클라이언트 (앱을 거치지 않는 공격 흉내) */
async function rawClient(email: string, password: string): Promise<{ sb: SupabaseClient; uid: string; role: string }> {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  const role = JSON.parse(Buffer.from(data.session.access_token.split(".")[1], "base64url").toString()).role as string;
  return { sb, uid: data.user.id, role };
}

const auth = await import("../../src/lib/services/auth");
const creators = await import("../../src/lib/services/creators");
const moments = await import("../../src/lib/services/moments");
const fanSvc = await import("../../src/lib/services/fan");
const { supabase } = await import("../../src/lib/supabase/client");

const stamp = Date.now().toString(36);
const A = { email: `momenty-e2e-creator-${stamp}@${DOMAIN}`, password: `E2e-${randomBytes(9).toString("base64url")}1a`, nickname: "E2E 크리에이터" };
const B = { email: `momenty-e2e-fan-${stamp}@${DOMAIN}`, password: `E2e-${randomBytes(9).toString("base64url")}1a`, nickname: "E2E 팬" };
const handle = `e2e.${stamp}`;
const createdUsers: string[] = [];
let creatorId = "";
let aUid = "";
let bUid = "";
const cleanupFiles: { bucket: string; path: string }[] = [];

/**
 * 가입은 앱 서비스(signUp)로. 메일 확인이 켜진 프로젝트라면 메일 링크 클릭 대신 admin으로 확인 처리만 한다.
 * (Confirm email이 꺼져 있으면 admin은 여기서 아무것도 하지 않는다)
 */
async function signUpAndConfirm(u: typeof A, role: "fan" | "creator") {
  await auth.signOut().catch(() => {});
  const { needsConfirmation } = await auth.signUp({ email: u.email, password: u.password, nickname: u.nickname, role });
  const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = list.users.find((x) => x.email === u.email);
  if (!user) throw new Error("가입한 사용자를 찾지 못함");
  createdUsers.push(user.id);
  if (needsConfirmation) {
    const { error } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
    if (error) throw error;
  }
  return { needsConfirmation, uid: user.id };
}
async function loginAs(u: typeof A) {
  await auth.signOut().catch(() => {});
  moments.clearSignedUrls();
  creators.invalidateCreators();
  await auth.signIn(u.email, u.password);
}

console.log(`대상: ${new URL(URL_).host.replace(/^[^.]+/, "<ref>")} · 테스트 이메일 도메인 ${DOMAIN}`);

let textId = "";
let photoId = "";
let subPhotoId = "";
let photoPath = "";
let subPhotoPath = "";

try {
  /* ================= Creator A ================= */
  section("Creator A · 가입");
  await step("앱 signUp (크리에이터로 시작)", async () => {
    const r = await signUpAndConfirm(A, "creator");
    aUid = r.uid;
    return [!!r.uid, r];
  });
  if (!aUid) throw new Error("Creator A 가입 실패 — 이후 단계를 건너뜀");
  await step("이메일 확인 후 앱 signIn → 로그인 성공", async () => {
    await loginAs(A);
    return [(await auth.getAccount())?.userId === aUid, aUid];
  });
  await step("가입 trigger: profile 자동 생성 (닉네임 = 가입 때 이름)", async () => {
    const { data } = await supabase().from("profiles").select("nickname").eq("id", aUid).single();
    return [data?.nickname === A.nickname, data];
  });
  await step("계정 상태: 시작 방식 creator · 크리에이터 프로필 없음 → /setup/creator 로 안내", async () => {
    const acc = (await auth.getAccount())!;
    return [acc.startRole === "creator" && acc.creator === null && auth.nextPathFor(acc) === "/setup/creator", { startRole: acc.startRole, next: auth.nextPathFor(acc) }];
  });

  section("Creator A · 프로필");
  await step("앱 createCreatorProfile: 이름 · 사용자 이름 · 소개 · 카테고리 · 프로필 사진(Storage)", async () => {
    const c = await creators.createCreatorProfile({ name: "E2E 크리에이터 A", handle, bio: "E2E 테스트용 크리에이터", category: "art", avatarFile: pngBlob() });
    creatorId = c.id;
    return [c.handle === handle && c.profileId === aUid && c.avatarUrl.includes(`/avatars/${aUid}/`), { id: c.id, avatar: c.avatarUrl.replace(/^.*\/avatars\//, "avatars/") }];
  });
  await step("프로필 사진 공개 URL → 200 · PNG", async () => {
    const c = (await creators.getMyCreator())!;
    const r = await fetch(c.avatarUrl);
    const buf = Buffer.from(await r.arrayBuffer());
    return [r.status === 200 && buf.subarray(1, 4).toString() === "PNG", { status: r.status }];
  });
  await step("verified=false · follower_count=0 (DB 기본값, 앱에서 정할 수 없음)", async () => {
    const c = (await creators.getMyCreator())!;
    return [c.verified === false && c.followers === 0, { verified: c.verified, followers: c.followers }];
  });
  await step("같은 사용자 이름으로 다른 사람이 쓰려 하면 사용 불가로 판단", async () => [!(await creators.isHandleAvailable(handle)), handle]);
  await step("크리에이터 프로필 생성 후 → Studio(/studio)로 안내", async () => {
    const acc = (await auth.getAccount())!;
    return [acc.creator?.id === creatorId && auth.nextPathFor(acc) === "/studio", auth.nextPathFor(acc)];
  });
  await step("잘못된 형식의 프로필 사진(gif) → 업로드 전에 거부", async () => {
    const [ok, detail] = await rejects(() => creators.updateCreatorProfile(creatorId, { name: "E2E 크리에이터 A", handle, bio: "x", category: "art", avatarFile: new Blob(["GIF89a"], { type: "image/gif" }) }));
    return [ok && String(detail).includes("지원하지 않는 형식"), detail];
  });
  await step("프로필 수정 + 사진 교체 → 예전 사진 파일 삭제", async () => {
    const before = (await creators.getMyCreator())!;
    const oldPath = before.avatarUrl.replace(/^.*\/avatars\//, "").split("?")[0];
    const after = await creators.updateCreatorProfile(creatorId, { name: "E2E 크리에이터 A", handle, bio: "수정한 소개", category: "art", avatarFile: pngBlob([255, 180, 0]) });
    const { data: files } = await admin.storage.from("avatars").list(aUid);
    const names = (files ?? []).map((f) => `${aUid}/${f.name}`);
    return [after.bio === "수정한 소개" && after.avatarUrl !== before.avatarUrl && !names.includes(oldPath) && names.length === 1, { names, oldPath }];
  });

  section("Creator A · Moment 기록");
  await step("앱 createMoment: 텍스트 · 전체 공개", async () => {
    const m = await moments.createMoment({ creatorId, type: "text", content: "E2E 첫 번째 순간", visibility: "public", aiContextEnabled: true });
    textId = m.id;
    return [m.creatorId === creatorId && !m.locked && m.content === "E2E 첫 번째 순간", m.id];
  });
  await step("앱 createMoment: 사진 · 전체 공개 (Storage 업로드 → insert)", async () => {
    const m = await moments.createMoment({ creatorId, type: "photo", content: "E2E 사진", media: { file: pngBlob() }, visibility: "public", aiContextEnabled: true });
    photoId = m.id;
    const { data } = await supabase().from("moments").select("media_url").eq("id", m.id).single();
    photoPath = data!.media_url;
    return [photoPath.startsWith(`${creatorId}/`) && !!m.mediaUrl?.includes("/object/sign/moment-media/"), photoPath];
  });
  await step("앱 createMoment: 사진 · 구독자 공개 (잠금 테스트용)", async () => {
    const m = await moments.createMoment({ creatorId, type: "photo", content: "E2E 구독자 사진 원문", media: { file: pngBlob([0, 160, 120]) }, visibility: "subscribers", aiContextEnabled: false });
    subPhotoId = m.id;
    const { data } = await supabase().from("moments").select("media_url").eq("id", m.id).single();
    subPhotoPath = data!.media_url;
    return [m.visibility === "subscribers", subPhotoPath];
  });
  await step("Creator Today: 실제로 남긴 3개만 시간순 (TODAY · 3 MOMENTS)", async () => {
    const list = await moments.getTodayMoments(creatorId);
    const sorted = list.every((m, i) => i === 0 || list[i - 1].createdAt <= m.createdAt);
    return [list.length === 3 && sorted && list[0].id === textId, list.map((m) => m.type)];
  });
  await step("createdAt = 서버 시각(now)", async () => {
    const m = (await moments.getMoment(textId))!;
    return [Math.abs(Date.now() - new Date(m.createdAt).getTime()) < 5 * 60_000, m.createdAt];
  });
  await step("앱 updateMoment: 본문 수정", async () => {
    const m = await moments.updateMoment(textId, { content: "E2E 첫 번째 순간 (수정)" });
    return [m?.content === "E2E 첫 번째 순간 (수정)", m?.content];
  });
  await step("앱 deleteMoment: 사진 Moment 삭제 → DB 행 + Storage 파일 함께 삭제", async () => {
    const extra = await moments.createMoment({ creatorId, type: "photo", content: "지울 사진", media: { file: pngBlob() }, visibility: "public", aiContextEnabled: true });
    const { data: row } = await supabase().from("moments").select("media_url").eq("id", extra.id).single();
    await moments.deleteMoment(extra.id);
    const { data: rows } = await supabase().from("moments").select("id").eq("id", extra.id);
    const { data: files } = await admin.storage.from("moment-media").list(creatorId, { search: row!.media_url.split("/")[1] });
    return [rows?.length === 0 && files?.length === 0, { rows: rows?.length, files: files?.length }];
  });
  await step("로그아웃 → 다시 로그인 → 프로필 · Moment 그대로", async () => {
    await auth.signOut();
    const out = await auth.getAccount();
    await loginAs(A);
    const acc = (await auth.getAccount())!;
    const list = await moments.getTodayMoments(creatorId);
    return [out === null && acc.creator?.id === creatorId && list.length === 3, { afterLogout: out, creator: acc.creator?.id, today: list.length }];
  });

  /* ================= Fan B ================= */
  section("Fan B · 가입 · 온보딩");
  await step("앱 signUp (팬으로 시작) → 확인 → 로그인", async () => {
    const r = await signUpAndConfirm(B, "fan");
    bUid = r.uid;
    await loginAs(B);
    return [(await auth.getAccount())?.userId === bUid, r];
  });
  if (!bUid) throw new Error("Fan B 가입 실패 — 이후 단계를 건너뜀");
  await step("계정 상태: 크리에이터 아님 · 관심 카테고리 단계로 안내", async () => {
    const acc = (await auth.getAccount())!;
    return [acc.creator === null && acc.startRole === "fan" && auth.nextPathFor(acc) === "/setup/interests", auth.nextPathFor(acc)];
  });
  await step("앱 saveInterests(['art']) → 온보딩 완료 · 이후 /today", async () => {
    await auth.saveInterests(["art"]);
    const acc = (await auth.getAccount())!;
    return [acc.onboarded && acc.interests.includes("art") && auth.nextPathFor(acc) === "/today", { interests: acc.interests }];
  });
  await step("신규 팬: 팔로우 0 → Today feed 비어 있음 (mock 없음)", async () => {
    const feed = await fanSvc.getTodayFeed();
    const saved = await fanSvc.getSavedMomentIds();
    return [feed.length === 0 && saved.length === 0, { feed: feed.length, saved: saved.length }];
  });

  section("Fan B · Discover → Follow → Today");
  await step("Discover(getCreators)에 Creator A가 보인다", async () => {
    creators.invalidateCreators();
    const list = await creators.getCreators();
    return [list.some((c) => c.id === creatorId && c.handle === handle), list.length];
  });
  await step("Creator Profile(getCreator) · 아직 팔로우 전", async () => {
    const c = await creators.getCreator(creatorId);
    return [c?.name === "E2E 크리에이터 A" && (await fanSvc.getTier(creatorId)) === undefined, c?.followers];
  });
  await step("앱 follow → subscriptions에 tier=follow 저장 · 팔로워 수 +1 (trigger)", async () => {
    await fanSvc.follow(creatorId);
    const c = await creators.getCreator(creatorId);
    return [(await fanSvc.getTier(creatorId)) === "follow" && c?.followers === 1, { tier: await fanSvc.getTier(creatorId), followers: c?.followers }];
  });
  await step("Today feed: Creator A의 오늘 3개 · 공개 2개는 원문, 구독자 1개는 잠김", async () => {
    const item = (await fanSvc.getTodayFeed()).find((f) => f.creator.id === creatorId);
    const open = item?.moments.filter((m) => !m.locked) ?? [];
    const locked = item?.moments.filter((m) => m.locked) ?? [];
    return [
      item?.moments.length === 3 && open.length === 2 && locked.length === 1 && locked[0].content === "" && !locked[0].mediaUrl,
      { total: item?.moments.length, open: open.length, locked: locked.length },
    ];
  });
  await step("공개 사진: signed URL로 실제 다운로드 200", async () => {
    const m = (await moments.getMoment(photoId))!;
    const r = await fetch(m.mediaUrl!);
    return [r.status === 200, r.status];
  });
  await step("앱 toggleReaction: ♥ + 👏 저장, 개수 반영", async () => {
    await moments.toggleReaction(photoId, "love");
    await moments.toggleReaction(photoId, "cheer");
    const m = (await moments.getMoment(photoId))!;
    const mine = await moments.getMyReactions(photoId);
    return [m.likedByMe === true && m.reactions.love === 1 && m.reactions.cheer === 1 && mine.length === 2, { reactions: m.reactions, mine }];
  });
  await step("앱 toggleSaved: 보관", async () => [await fanSvc.toggleSaved(photoId, false), await fanSvc.getSavedMomentIds()]);
  await step("잠긴 Moment에는 반응 · 보관 불가 (RLS)", async () => {
    const [r1] = await rejects(() => moments.toggleReaction(subPhotoId, "love"));
    const [r2] = await rejects(() => fanSvc.toggleSaved(subPhotoId, false));
    return [r1 && r2, { reaction: r1, bookmark: r2 }];
  });
  await step("로그아웃 → 로그인 → 팔로우 · 반응 · 보관 유지", async () => {
    await loginAs(B);
    const tier = await fanSvc.getTier(creatorId);
    const mine = await moments.getMyReactions(photoId);
    const saved = await fanSvc.getSavedMomentIds();
    return [tier === "follow" && mine.length === 2 && saved.includes(photoId), { tier, mine, saved: saved.length }];
  });

  /* ================= Security ================= */
  const fan = await rawClient(B.email, B.password);
  const creator = await rawClient(A.email, A.password);
  section("Security · 토큰");
  check("Fan B · Creator A 요청은 authenticated JWT (service_role 아님)", fan.role === "authenticated" && creator.role === "authenticated", [fan.role, creator.role]);

  section("Security · Fan B의 /studio 접근");
  await step("Fan B 계정에는 크리에이터 프로필이 없다 → Studio 화면 대신 안내 (CreatorGate 판단 근거)", async () => {
    await loginAs(B);
    return [(await auth.getAccount())!.creator === null, null];
  });
  await step("Studio 쓰기 API를 직접 호출해도: Creator A 이름으로 Moment insert → 42501", async () => {
    const { error } = await fan.sb.from("moments").insert({ creator_id: creatorId, type: "text", content: "fake", visibility: "public" });
    return [error?.code === "42501", error?.code ?? "허용됨!"];
  });
  await step("Creator A의 팔로워 목록(subscriptions) 조회 → 본인 행만 (다른 팬 정보 없음)", async () => {
    const { data } = await fan.sb.from("subscriptions").select("fan_id").eq("creator_id", creatorId);
    return [(data ?? []).every((r) => r.fan_id === fan.uid), data?.length];
  });
  await step("Creator A 폴더에 파일 업로드 → 거부", async () => {
    const { error } = await fan.sb.storage.from("moment-media").upload(`${creatorId}/evil.png`, png(), { contentType: "image/png" });
    return [!!error, error?.message ?? "업로드됨!"];
  });

  section("Security · 남의 Moment 수정/삭제");
  await step("Fan B가 Creator A Moment update → 0행 (RLS)", async () => {
    const { data, error } = await fan.sb.from("moments").update({ content: "hacked" }).eq("id", textId).select("id");
    return [!error && data.length === 0, error ?? data];
  });
  await step("Fan B가 Creator A Moment delete → 0행 (RLS)", async () => {
    const { data, error } = await fan.sb.from("moments").delete().eq("id", textId).select("id");
    return [!error && data.length === 0, error ?? data];
  });
  await step("앱 updateMoment / deleteMoment를 Fan B로 호출 → 실패", async () => {
    const u = await moments.updateMoment(textId, { content: "hacked" });
    const [d, msg] = await rejects(() => moments.deleteMoment(textId));
    return [u === undefined && d, { update: u, delete: msg }];
  });
  await step("원본 그대로 (Creator A 확인)", async () => {
    const { data } = await creator.sb.from("moments").select("content").eq("id", textId).single();
    return [data?.content === "E2E 첫 번째 순간 (수정)", data];
  });
  await step("Fan B가 Creator A 프로필 수정 → 0행 · 아바타 폴더 업로드 거부", async () => {
    const { data } = await fan.sb.from("creators").update({ bio: "hacked" }).eq("id", creatorId).select("id");
    const { error } = await fan.sb.storage.from("avatars").upload(`${aUid}/evil.png`, png(), { contentType: "image/png" });
    return [data?.length === 0 && !!error, { rows: data?.length, upload: error?.message }];
  });

  section("Security · 잠긴 원문 · 미디어");
  await step("비로그인: 구독자 Moment 원문 — moments 직접 → 0행", async () => {
    const { data, error } = await anon.from("moments").select("content, media_url").eq("id", subPhotoId);
    return [!error && data.length === 0, error ?? data];
  });
  await step("비로그인: feed에서는 행만, content · media_url null", async () => {
    const { data } = await anon.from("moment_feed").select("viewable, content, media_url").eq("id", subPhotoId).single();
    return [data?.viewable === false && data.content === null && data.media_url === null, data];
  });
  await step("비구독자(Fan B, 팔로우만): 구독자 Moment 원문 → 0행", async () => {
    const { data } = await fan.sb.from("moments").select("content").eq("id", subPhotoId);
    return [data?.length === 0, data];
  });
  await step("비구독자(Fan B): 구독자 사진 signed URL 발급 거부", async () => {
    const { data, error } = await fan.sb.storage.from("moment-media").createSignedUrl(subPhotoPath, 60);
    return [!!error && !data, error?.message ?? "발급됨!"];
  });
  await step("비구독자(Fan B) · 비로그인: 구독자 사진 직접 다운로드 거부", async () => {
    const f = await fan.sb.storage.from("moment-media").download(subPhotoPath);
    const a = await anon.storage.from("moment-media").download(subPhotoPath);
    return [!!f.error && !!a.error, { fan: f.error?.message, anon: a.error?.message }];
  });
  await step("비공개 bucket: public URL로 접근 불가", async () => {
    const r = await fetch(anon.storage.from("moment-media").getPublicUrl(subPhotoPath).data.publicUrl);
    return [r.status >= 400, r.status];
  });

  section("Security · 결제 없이 등급 올리기");
  await step("Fan B가 스스로 premium 구독 생성 → 거부", async () => {
    await fan.sb.from("subscriptions").delete().eq("fan_id", fan.uid).eq("creator_id", "c1");
    const { error } = await fan.sb.from("subscriptions").insert({ fan_id: fan.uid, creator_id: "c1", tier: "premium" });
    return [!!error, error?.code ?? "허용됨!"];
  });
  await step("Fan B가 follow → premium으로 올리기 → 거부 · 여전히 follow", async () => {
    const { data, error } = await fan.sb.from("subscriptions").update({ tier: "premium" }).eq("creator_id", creatorId).select("tier");
    const tier = await fanSvc.getTier(creatorId);
    return [(!!error || data?.length === 0) && tier === "follow", { error: error?.code, data, tier }];
  });
  await step("Creator A가 자기 채널 팔로우 → 거부", async () => {
    const { error } = await creator.sb.from("subscriptions").insert({ fan_id: creator.uid, creator_id: creatorId, tier: "follow" });
    return [!!error, error?.code ?? "허용됨!"];
  });

  section("Security · 미디어 소유권 · created_at");
  const demo = env("CREATOR_EMAIL") ? await rawClient(env("CREATOR_EMAIL"), env("CREATOR_PASSWORD")) : null;
  let otherPath = "";
  await step("다른 크리에이터(seed c1)가 자기 폴더에 파일 업로드 (준비)", async () => {
    if (!demo) return [false, "DEMO_CREATOR_* 없음"];
    otherPath = `c1/e2e-other-${stamp}.png`;
    const { error } = await demo.sb.storage.from("moment-media").upload(otherPath, png(), { contentType: "image/png" });
    if (!error) cleanupFiles.push({ bucket: "moment-media", path: otherPath });
    return [!error, error?.message];
  });
  await step("Creator A: 다른 크리에이터의 파일을 내 공개 Moment의 media_url로 연결 → 42501", async () => {
    const { error } = await creator.sb.from("moments").insert({ creator_id: creatorId, type: "photo", content: "x", media_url: otherPath, visibility: "public" });
    return [error?.code === "42501", error ? `${error.code} ${error.message}` : "허용됨!"];
  });
  await step("Creator A: 기존 Moment의 media_url을 다른 크리에이터 파일로 수정 → 거부", async () => {
    const { data, error } = await creator.sb.from("moments").update({ media_url: otherPath }).eq("id", photoId).select("id");
    return [!!error || data?.length === 0, error ? error.code : data];
  });
  await step("Creator A: 업로드되지 않은 경로로 Moment 생성 → 23503", async () => {
    const { error } = await creator.sb.from("moments").insert({ creator_id: creatorId, type: "photo", content: "x", media_url: `${creatorId}/missing-${stamp}.jpg`, visibility: "public" });
    return [error?.code === "23503", error ? `${error.code} ${error.message}` : "허용됨!"];
  });
  await step("Creator A: 경로 조작(..) → 거부", async () => {
    const { error } = await creator.sb.from("moments").insert({ creator_id: creatorId, type: "photo", content: "x", media_url: `${creatorId}/../c1/a.png`, visibility: "public" });
    return [!!error, error?.code ?? "허용됨!"];
  });
  await step("Creator A: created_at 지정해 생성 → 거부 (컬럼 권한)", async () => {
    const { error } = await creator.sb.from("moments").insert({ creator_id: creatorId, type: "text", content: "과거", visibility: "public", created_at: "2020-01-01T00:00:00Z" });
    return [!!error, error ? `${error.code} ${error.message}` : "허용됨!"];
  });
  await step("Creator A: 자기 Moment의 created_at 수정 → 거부 · 값 그대로", async () => {
    const before = (await creator.sb.from("moments").select("created_at").eq("id", textId).single()).data!.created_at;
    const { error } = await creator.sb.from("moments").update({ created_at: "2020-01-01T00:00:00Z" }).eq("id", textId);
    const after = (await creator.sb.from("moments").select("created_at").eq("id", textId).single()).data!.created_at;
    return [!!error && before === after, { error: error?.code, before, after }];
  });
  await step("Creator A: verified · follower_count 수정 → 거부", async () => {
    const r1 = await creator.sb.from("creators").update({ verified: true }).eq("id", creatorId);
    const r2 = await creator.sb.from("creators").update({ follower_count: 99999 }).eq("id", creatorId);
    return [!!r1.error && !!r2.error, [r1.error?.code, r2.error?.code]];
  });
  await step("공격이 모두 실패한 뒤에도 비구독자는 잠긴 파일을 읽을 수 없음", async () => {
    const { error } = await fan.sb.storage.from("moment-media").createSignedUrl(subPhotoPath, 60);
    return [!!error, error?.message];
  });
} catch (e) {
  check("중단", false, e instanceof Error ? e.message : e);
} finally {
  /* ---------- 정리 (테스트가 만든 것만 — admin) ---------- */
  await auth.signOut().catch(() => {});
  if (creatorId) {
    const { data: files } = await admin.storage.from("moment-media").list(creatorId, { limit: 1000 });
    for (const f of files ?? []) cleanupFiles.push({ bucket: "moment-media", path: `${creatorId}/${f.name}` });
  }
  for (const uid of createdUsers) {
    const { data: files } = await admin.storage.from("avatars").list(uid, { limit: 1000 });
    for (const f of files ?? []) cleanupFiles.push({ bucket: "avatars", path: `${uid}/${f.name}` });
  }
  for (const bucket of ["moment-media", "avatars"]) {
    const paths = cleanupFiles.filter((f) => f.bucket === bucket).map((f) => f.path);
    if (paths.length) await admin.storage.from(bucket).remove(paths);
  }
  for (const uid of createdUsers) await admin.auth.admin.deleteUser(uid); // profiles → creators → moments · subscriptions · reactions cascade
  const { data: left } = await admin.from("creators").select("id").eq("handle", handle);
  console.log(`\n정리: 테스트 계정 ${createdUsers.length}명 · 파일 ${cleanupFiles.length}개 삭제 (남은 E2E 크리에이터: ${left?.length ?? "?"})`);
}

/* ---------- 요약 ---------- */
console.log("\n요약");
let pass = 0;
let total = 0;
for (const r of results) {
  const ok = r.items.filter((i) => i.ok).length;
  pass += ok;
  total += r.items.length;
  console.log(`${ok === r.items.length ? "PASS" : "FAIL"}  ${r.title} (${ok}/${r.items.length})`);
}
console.log(`\n${pass}/${total} passed`);
process.exit(pass === total && total > 0 ? 0 : 1);
