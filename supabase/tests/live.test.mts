/**
 * 실제 Supabase 프로젝트 대상 통합 테스트 (localStorage · 가짜 서버 없음)
 *
 *   npm run test:live -- --confirm-dev
 *
 * · 모든 검증 요청은 실제 로그인 세션의 JWT(creator / fan / 비구독자)로 보낸다 → RLS가 그대로 적용된다.
 * · service role(admin)은 "준비·정리"에만 쓴다: 임시 비구독자 계정 생성/삭제, 남은 테스트 데이터 정리.
 * · 테스트가 만든 Moment · 반응 · 파일 · 임시 계정은 끝에서 지운다. seed 데이터는 건드리지 않는다.
 */
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
if (!process.argv.includes("--confirm-dev")) {
  console.error("실제 Supabase에 테스트 데이터를 썼다가 지우는 테스트예요. --confirm-dev 를 붙여 실행하세요.");
  process.exit(1);
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BUCKET = "moment-media";
const mask = (s: string) => s.replace(/^(.).*(@.*)$/, "$1***$2");

// 앱 코드(services)가 브라우저에서처럼 동작하도록: 세션 · 모드(pathname) 판단
const location = { pathname: "/today" };
Object.assign(globalThis, { window: { location, addEventListener() {}, removeEventListener() {} } });

/* ---------- 결과 기록 ---------- */
type Item = { name: string; ok: boolean; detail?: string };
const results: { no: number; title: string; items: Item[] }[] = [];
let current: (typeof results)[number];
function section(no: number, title: string) {
  current = { no, title, items: [] };
  results.push(current);
  console.log(`\n${no}. ${title}`);
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

/* ---------- 클라이언트 ---------- */
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const newClient = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn(email: string, password: string) {
  const sb = newClient();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { sb, uid: data.user.id, jwtRole: JSON.parse(Buffer.from(data.session.access_token.split(".")[1], "base64url").toString()).role as string };
}

/** 1x1이 아닌 진짜 PNG (8x8 보라색) */
function png(): Buffer {
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
  const rows = Buffer.concat(Array.from({ length: w }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array(w).fill([108, 77, 255]).flat())])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

/* ---------- 준비 ---------- */
const createdMomentIds: string[] = [];
const createdFiles: string[] = [];
let outsiderId: string | null = null;

const creatorEmail = process.env.NEXT_PUBLIC_DEMO_CREATOR_EMAIL!;
const fanEmail = process.env.NEXT_PUBLIC_DEMO_FAN_EMAIL!;
console.log(`대상: ${new URL(URL_).host.replace(/^[^.]+/, "<ref>")} · creator ${mask(creatorEmail)} · fan ${mask(fanEmail)}`);

// 임시 비구독자 (admin은 계정 생성에만 사용)
const outsiderEmail = `rls-outsider-${Date.now()}@seed.momenty.dev`;
const outsiderPassword = randomBytes(18).toString("base64url");
{
  const { data, error } = await admin.auth.admin.createUser({
    email: outsiderEmail,
    password: outsiderPassword,
    email_confirm: true,
    app_metadata: { momenty_seed: true, momenty_test: true },
  });
  if (error) throw error;
  outsiderId = data.user.id;
}

let creator!: Awaited<ReturnType<typeof signIn>>;
let fan!: Awaited<ReturnType<typeof signIn>>;
let outsider!: Awaited<ReturnType<typeof signIn>>;
const anon = newClient();

try {
  /* 1 */
  section(1, "Creator 테스트 계정 로그인");
  await step("signInWithPassword 성공", async () => {
    creator = await signIn(creatorEmail, process.env.NEXT_PUBLIC_DEMO_CREATOR_PASSWORD!);
    return [true, creator.uid];
  });
  check("JWT role = authenticated (service_role 아님)", creator?.jwtRole === "authenticated", creator?.jwtRole);

  /* 2 */
  section(2, "Fan 테스트 계정 로그인");
  await step("signInWithPassword 성공", async () => {
    fan = await signIn(fanEmail, process.env.NEXT_PUBLIC_DEMO_FAN_PASSWORD!);
    return true;
  });
  check("JWT role = authenticated", fan?.jwtRole === "authenticated", fan?.jwtRole);
  outsider = await signIn(outsiderEmail, outsiderPassword);

  /* 3 */
  section(3, "profiles 생성 확인");
  await step("Fan: 본인 profile 조회 (닉네임 새벽산책)", async () => {
    const { data, error } = await fan.sb.from("profiles").select("id, nickname, handle").eq("id", fan.uid).single();
    if (error) throw error;
    return [data.nickname === "새벽산책" && data.handle === "dawn.walk", data];
  });
  await step("Creator: 본인 profile 조회", async () => {
    const { data, error } = await creator.sb.from("profiles").select("nickname, handle").eq("id", creator.uid).single();
    if (error) throw error;
    return [data.handle === "harin.film", data];
  });
  await step("가입 trigger: 임시 계정도 profile 자동 생성", async () => {
    const { data } = await outsider.sb.from("profiles").select("id").eq("id", outsider.uid);
    return (data?.length ?? 0) === 1;
  });
  await step("Fan이 다른 사람 profile 수정 → 0행 (RLS)", async () => {
    const { data, error } = await fan.sb.from("profiles").update({ nickname: "hacked" }).eq("id", creator.uid).select("id");
    return [!error && data.length === 0, error ?? data];
  });

  /* 4 */
  section(4, "creators 연결 확인");
  await step("Creator 계정 = creators.c1 의 profile_id", async () => {
    const { data, error } = await creator.sb.from("creators").select("id, name").eq("profile_id", creator.uid);
    if (error) throw error;
    return [data.length === 1 && data[0].id === "c1", data];
  });
  await step("비로그인도 크리에이터 목록 조회 (8명)", async () => {
    const { count, error } = await anon.from("creators").select("id", { count: "exact", head: true });
    return [!error && count === 8, error ?? count];
  });
  await step("Fan이 c1 크리에이터 정보 수정 → 0행 (RLS)", async () => {
    const { data, error } = await fan.sb.from("creators").update({ bio: "hacked" }).eq("id", "c1").select("id");
    return [!error && data.length === 0, error ?? data];
  });

  /* 5 */
  section(5, "subscription 관계 확인");
  await step("Fan: 본인 구독 6건 (c1 premium · c3 subscriber …)", async () => {
    const { data, error } = await fan.sb.from("subscriptions").select("creator_id, tier");
    if (error) throw error;
    const tier = Object.fromEntries(data.map((s) => [s.creator_id, s.tier]));
    return [data.length === 6 && tier.c1 === "premium" && tier.c3 === "subscriber" && tier.c5 === "follow", tier];
  });
  await step("Creator(c1): 자기 채널 구독자만 조회", async () => {
    const { data, error } = await creator.sb.from("subscriptions").select("creator_id, fan_id");
    if (error) throw error;
    return [data.length >= 1 && data.every((s) => s.creator_id === "c1"), data.map((s) => s.creator_id)];
  });
  await step("비구독자: 남의 구독 조회 → 0행", async () => {
    const { data, error } = await outsider.sb.from("subscriptions").select("*");
    return [!error && data.length === 0, error ?? data.length];
  });
  await step("Fan이 스스로 premium으로 올리기 → 거부", async () => {
    const { data, error } = await fan.sb.from("subscriptions").update({ tier: "premium" }).eq("creator_id", "c3").select("tier");
    return [!!error || data.length === 0, error ? `${error.code} ${error.message}` : data];
  });
  await step("비구독자가 스스로 구독 생성 → 거부", async () => {
    const { error } = await outsider.sb.from("subscriptions").insert({ fan_id: outsider.uid, creator_id: "c1", tier: "premium" });
    return [!!error, error ? `${error.code} ${error.message}` : "insert 허용됨!"];
  });

  /* 6 — 앱 서비스 코드 경로 (services/moments.ts → Supabase backend) */
  const svc = await import("../../src/lib/services/moments");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  let textId = "";
  let subPhotoId = "";
  let premiumTextId = "";
  let photoPath = "";

  section(6, "Creator가 Moment 생성");
  location.pathname = "/studio/record/preview";
  await step("앱 createMoment: 텍스트 · 전체 공개", async () => {
    const m = await svc.createMoment({ creatorId: "c1", type: "text", content: `[live-test] 공개 텍스트 ${Date.now()}`, visibility: "public", aiContextEnabled: true });
    textId = m.id;
    createdMomentIds.push(m.id);
    return [m.creatorId === "c1" && !m.locked, { id: m.id, createdAt: m.createdAt }];
  });
  await step("createdAt = 서버 now() · 오늘(KST)", async () => {
    const m = await svc.getMoment(textId);
    const kst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date(m!.createdAt));
    return [kst === today && Math.abs(Date.now() - new Date(m!.createdAt).getTime()) < 5 * 60_000, m?.createdAt];
  });
  await step("앱 createMoment: 사진 · 구독자 공개 (Storage 업로드 포함)", async () => {
    const dataUrl = `data:image/png;base64,${png().toString("base64")}`;
    const m = await svc.createMoment({ creatorId: "c1", type: "photo", content: "[live-test] 구독자 사진", mediaUrl: dataUrl, visibility: "subscribers", aiContextEnabled: false });
    subPhotoId = m.id;
    createdMomentIds.push(m.id);
    const { data } = await creator.sb.from("moments").select("media_url").eq("id", m.id).single();
    photoPath = data!.media_url;
    createdFiles.push(photoPath);
    return [photoPath.startsWith("c1/") && !!m.mediaUrl?.includes("/storage/v1/object/sign/"), { photoPath }];
  });
  await step("직접 API: Creator JWT로 premium 텍스트 insert", async () => {
    const { data, error } = await creator.sb.from("moments").insert({ creator_id: "c1", type: "text", content: "[live-test] premium 원문", visibility: "premium" }).select("id").single();
    if (error) throw error;
    premiumTextId = data.id;
    createdMomentIds.push(data.id);
    return true;
  });

  /* 7 */
  section(7, "Creator가 자신의 Moment 수정");
  await step("앱 updateMoment: 본문 · 공개범위 변경", async () => {
    const m = await svc.updateMoment(textId, { content: "[live-test] 수정된 텍스트", visibility: "public" });
    return [m?.content === "[live-test] 수정된 텍스트", m?.content];
  });
  await step("updated_at 자동 갱신", async () => {
    const { data } = await creator.sb.from("moments").select("created_at, updated_at").eq("id", textId).single();
    return [new Date(data!.updated_at) > new Date(data!.created_at), data];
  });

  /* 8 */
  section(8, "Creator가 자신의 Moment 삭제");
  let deleteTargetId = "";
  await step("앱 deleteMoment", async () => {
    const m = await svc.createMoment({ creatorId: "c1", type: "text", content: "[live-test] 지울 Moment", visibility: "public", aiContextEnabled: true });
    deleteTargetId = m.id;
    await svc.deleteMoment(m.id);
    const { data } = await creator.sb.from("moments").select("id").eq("id", m.id);
    return [data!.length === 0, data];
  });
  await step("삭제된 id 조회 → 없음 (앱 getMoment)", async () => (await svc.getMoment(deleteTargetId)) === undefined);
  await step("삭제된 id 다시 삭제 → 안내 오류 (crash 없음)", async () => {
    try {
      await svc.deleteMoment(deleteTargetId);
      return [false, "오류 없이 통과됨"];
    } catch (e) {
      return [e instanceof Error && e.name === "ServiceError", (e as Error).message];
    }
  });

  /* 9 */
  section(9, "Fan이 Creator의 Today/Moment 조회");
  location.pathname = "/today";
  await step("앱 getTodayMoments(c1) — Fan 세션", async () => {
    const list = await svc.getTodayMoments("c1");
    const mine = list.find((m) => m.id === textId);
    const sorted = list.every((m, i) => i === 0 || list[i - 1].createdAt <= m.createdAt);
    return [!!mine && mine.content === "[live-test] 수정된 텍스트" && sorted, { count: list.length, sorted }];
  });
  await step("앱 getMoment(Detail) — Fan 세션", async () => {
    const m = await svc.getMoment(textId);
    return [m?.content === "[live-test] 수정된 텍스트" && m.locked === false, m?.content];
  });
  await step("앱 Archive: 지난 하루 Daily 계산 (seed Moment)", async () => {
    const d = await svc.getDailyRecords("c1");
    return [d.length >= 1 && d.every((x) => x.date < today), { days: d.length, latest: d[0]?.date }];
  });

  /* 10 */
  section(10, "subscriber Moment 접근");
  await step("Fan(c1 premium): c1 구독자 사진 원문 — moments 테이블 직접", async () => {
    const { data, error } = await fan.sb.from("moments").select("content, media_url").eq("id", subPhotoId);
    return [!error && data.length === 1 && data[0].content === "[live-test] 구독자 사진", error ?? data];
  });
  await step("Fan(c3 subscriber): c3 seed 구독자 Moment 원문 조회", async () => {
    const { data, error } = await fan.sb.from("moment_feed").select("id, viewable, content").eq("creator_id", "c3").eq("visibility", "subscriber").limit(1);
    if (error) throw error;
    if (!data.length) return [false, "c3에 subscriber Moment 없음"];
    const direct = await fan.sb.from("moments").select("content").eq("id", data[0].id);
    return [data[0].viewable && data[0].content !== null && direct.data?.length === 1, data[0]];
  });

  /* 11 */
  section(11, "premium Moment 접근 제어");
  await step("Fan(c1 premium): c1 premium 원문 조회 가능", async () => {
    const { data } = await fan.sb.from("moments").select("content").eq("id", premiumTextId);
    return [data?.length === 1 && data[0].content === "[live-test] premium 원문", data];
  });
  await step("Fan(c3 subscriber): c3 premium — moments 테이블 직접 → 0행", async () => {
    const { data: feed } = await fan.sb.from("moment_feed").select("id").eq("creator_id", "c3").eq("visibility", "premium").limit(1);
    if (!feed?.length) return [false, "c3에 premium Moment 없음"];
    const { data, error } = await fan.sb.from("moments").select("content, media_url").eq("id", feed[0].id);
    return [!error && data.length === 0, error ?? data];
  });
  await step("Fan(c3 subscriber): c3 premium — feed는 행만, content/media null", async () => {
    const { data } = await fan.sb.from("moment_feed").select("viewable, content, media_url, location").eq("creator_id", "c3").eq("visibility", "premium");
    return [!!data?.length && data.every((r) => !r.viewable && r.content === null && r.media_url === null && r.location === null), data?.length];
  });
  await step("앱 getMoment: 잠긴 Moment → locked, 본문 없음", async () => {
    const { data: feed } = await fan.sb.from("moment_feed").select("id").eq("creator_id", "c3").eq("visibility", "premium").limit(1);
    const m = await svc.getMoment(feed![0].id);
    return [m?.locked === true && m.content === "" && !m.mediaUrl, { locked: m?.locked, content: m?.content }];
  });

  /* 12 */
  section(12, "Fan reaction 생성/삭제");
  await step("앱 toggleLove → 생성 (♥, 개수 1)", async () => {
    const on = await svc.toggleLove(textId);
    const m = await svc.getMoment(textId);
    const { data } = await fan.sb.from("moment_reactions").select("user_id, kind").eq("moment_id", textId);
    return [on && m?.likedByMe === true && m.reactions.love === 1 && data?.length === 1 && data[0].user_id === fan.uid, { love: m?.reactions.love, rows: data }];
  });
  await step("같은 반응 중복 insert → 23505", async () => {
    const { error } = await fan.sb.from("moment_reactions").insert({ moment_id: textId, user_id: fan.uid, kind: "love" });
    return [error?.code === "23505", error?.code ?? "중복 허용됨!"];
  });
  await step("남의 user_id로 반응 insert → 42501", async () => {
    const { error } = await fan.sb.from("moment_reactions").insert({ moment_id: textId, user_id: creator.uid, kind: "cheer" });
    return [error?.code === "42501", error?.code ?? "허용됨!"];
  });
  await step("Creator는 Fan의 반응 행을 볼 수 없음 (본인 것만)", async () => {
    const { data } = await creator.sb.from("moment_reactions").select("*").eq("moment_id", textId);
    return [data?.length === 0, data];
  });
  await step("다른 사용자가 Fan 반응 삭제 → 0행", async () => {
    await outsider.sb.from("moment_reactions").delete().eq("moment_id", textId).eq("user_id", fan.uid);
    const { data } = await fan.sb.from("moment_reactions").select("kind").eq("moment_id", textId);
    return [data?.length === 1, data];
  });
  await step("앱 toggleLove 다시 → 삭제 (개수 0)", async () => {
    const on = await svc.toggleLove(textId);
    const m = await svc.getMoment(textId);
    return [on === false && m?.likedByMe === false && m.reactions.love === 0, m?.reactions];
  });
  await step("비구독자가 볼 수 없는 Moment에 반응 → 42501", async () => {
    const { error } = await outsider.sb.from("moment_reactions").insert({ moment_id: premiumTextId, user_id: outsider.uid, kind: "love" });
    return [error?.code === "42501", error?.code ?? "허용됨!"];
  });

  /* 13 */
  section(13, "다른 사용자의 Moment 수정/삭제 차단");
  for (const [who, c] of [
    ["Fan", () => fan],
    ["비구독자", () => outsider],
  ] as const) {
    await step(`${who}: c1 Moment update → 0행`, async () => {
      const { data, error } = await c().sb.from("moments").update({ content: "hacked" }).eq("id", textId).select("id");
      return [!error && data.length === 0, error ?? data];
    });
    await step(`${who}: c1 Moment delete → 0행`, async () => {
      const { data, error } = await c().sb.from("moments").delete().eq("id", textId).select("id");
      return [!error && data.length === 0, error ?? data];
    });
    await step(`${who}: c1 이름으로 Moment insert → 42501`, async () => {
      const { error } = await c().sb.from("moments").insert({ creator_id: "c1", type: "text", content: "fake", visibility: "public" });
      return [error?.code === "42501", error?.code ?? "허용됨!"];
    });
  }
  await step("원본은 그대로 (Creator 확인)", async () => {
    const { data } = await creator.sb.from("moments").select("content").eq("id", textId).single();
    return [data?.content === "[live-test] 수정된 텍스트", data];
  });
  await step("Creator: 다른 크리에이터(c2) Moment 수정 → 0행", async () => {
    const { data: feed } = await creator.sb.from("moment_feed").select("id").eq("creator_id", "c2").limit(1);
    const { data, error } = await creator.sb.from("moments").update({ content: "hacked" }).eq("id", feed![0].id).select("id");
    return [!error && data.length === 0, error ?? data];
  });
  await step("Creator: 자기 Moment를 c2로 옮기기 → 거부", async () => {
    const { data, error } = await creator.sb.from("moments").update({ creator_id: "c2" }).eq("id", textId).select("id");
    return [!!error || data.length === 0, error ? error.code : data];
  });
  await step("앱 updateMoment를 Fan 세션으로 흉내 → 권한 없음", async () => {
    const { data } = await fan.sb.from("moments").update({ visibility: "public" }).eq("id", premiumTextId).select("id");
    return [data?.length === 0, data];
  });

  /* 14 */
  section(14, "비구독자의 subscriber/premium 원문 접근 차단");
  for (const [who, sb] of [
    ["비구독자(로그인)", () => outsider.sb],
    ["비로그인(anon)", () => anon],
  ] as const) {
    await step(`${who}: subscriber 사진 — moments 직접 → 0행`, async () => {
      const { data, error } = await sb().from("moments").select("content, media_url").eq("id", subPhotoId);
      return [!error && data.length === 0, error ?? data];
    });
    await step(`${who}: premium 원문 — moments 직접 → 0행`, async () => {
      const { data, error } = await sb().from("moments").select("content").eq("id", premiumTextId);
      return [!error && data.length === 0, error ?? data];
    });
    await step(`${who}: feed에서는 행만, content · media_url null`, async () => {
      const { data, error } = await sb().from("moment_feed").select("viewable, content, media_url").in("id", [subPhotoId, premiumTextId]);
      return [!error && data.length === 2 && data.every((r) => !r.viewable && r.content === null && r.media_url === null), error ?? data];
    });
    await step(`${who}: public Moment는 원문 조회 가능`, async () => {
      const { data } = await sb().from("moments").select("content").eq("id", textId);
      return [data?.length === 1, data];
    });
  }
  await step("Fan(c5 follow): c5 subscriber Moment 원문 → 0행", async () => {
    const { data: feed } = await fan.sb.from("moment_feed").select("id, viewable, content").eq("creator_id", "c5").eq("visibility", "subscriber").limit(1);
    if (!feed?.length) return [false, "c5에 subscriber Moment 없음"];
    const { data } = await fan.sb.from("moments").select("id").eq("id", feed[0].id);
    return [data?.length === 0 && !feed[0].viewable && feed[0].content === null, { feed: feed[0], direct: data }];
  });
  await step("ai_context_enabled도 잠긴 Moment에서는 false", async () => {
    const { data } = await outsider.sb.from("moment_feed").select("ai_context_enabled").eq("id", premiumTextId).single();
    return [data?.ai_context_enabled === false, data];
  });

  /* 15 */
  section(15, "Storage moment-media 업로드/조회 권한");
  await step("Creator: 자기 폴더(c1/) 업로드 성공 (6번에서 확인한 파일 존재)", async () => {
    const { data, error } = await creator.sb.storage.from(BUCKET).list("c1", { search: photoPath.split("/")[1] });
    return [!error && data.length === 1, error ?? data.map((f) => f.name)];
  });
  await step("Fan(구독자 이상): signed URL 발급 + 실제 다운로드 200 · PNG", async () => {
    const { data, error } = await fan.sb.storage.from(BUCKET).createSignedUrl(photoPath, 60);
    if (error) throw error;
    const r = await fetch(data.signedUrl);
    const buf = Buffer.from(await r.arrayBuffer());
    return [r.status === 200 && buf.subarray(1, 4).toString() === "PNG", { status: r.status, bytes: buf.length }];
  });
  await step("비구독자: signed URL 발급 거부", async () => {
    const { data, error } = await outsider.sb.storage.from(BUCKET).createSignedUrl(photoPath, 60);
    return [!!error && !data, error?.message ?? "발급됨!"];
  });
  await step("비로그인: 직접 다운로드 거부", async () => {
    const { data, error } = await anon.storage.from(BUCKET).download(photoPath);
    return [!!error && !data, error?.message ?? "다운로드됨!"];
  });
  await step("bucket은 비공개 (public URL로 접근 불가)", async () => {
    const r = await fetch(anon.storage.from(BUCKET).getPublicUrl(photoPath).data.publicUrl);
    return [r.status >= 400, r.status];
  });
  await step("Fan: c1 폴더 업로드 → 거부", async () => {
    const { error } = await fan.sb.storage.from(BUCKET).upload(`c1/live-test-fan-${Date.now()}.png`, png(), { contentType: "image/png" });
    return [!!error, error?.message ?? "업로드됨!"];
  });
  await step("비구독자: 자기 이름 폴더라도 크리에이터가 아니면 업로드 거부", async () => {
    const { error } = await outsider.sb.storage.from(BUCKET).upload(`${outsider.uid}/x.png`, png(), { contentType: "image/png" });
    return [!!error, error?.message ?? "업로드됨!"];
  });
  await step("Fan: Creator 파일 삭제 → 파일 그대로", async () => {
    await fan.sb.storage.from(BUCKET).remove([photoPath]);
    const { data } = await creator.sb.storage.from(BUCKET).list("c1", { search: photoPath.split("/")[1] });
    return [data?.length === 1, data?.length];
  });
  await step("Creator: 앱 deleteMoment → DB 행 + Storage 파일 함께 삭제", async () => {
    await svc.deleteMoment(subPhotoId);
    const { data: rows } = await creator.sb.from("moments").select("id").eq("id", subPhotoId);
    const { data: files } = await creator.sb.storage.from(BUCKET).list("c1", { search: photoPath.split("/")[1] });
    return [rows?.length === 0 && files?.length === 0, { rows: rows?.length, files: files?.length }];
  });
} finally {
  /* ---------- 정리 (테스트가 만든 것만) ---------- */
  location.pathname = "/studio";
  if (creator) {
    for (const id of createdMomentIds) await creator.sb.from("moments").delete().eq("id", id);
    if (createdFiles.length) await creator.sb.storage.from(BUCKET).remove(createdFiles);
  }
  const { data: leftovers } = await admin.from("moments").select("id").like("content", "[live-test]%");
  if (leftovers?.length) await admin.from("moments").delete().in("id", leftovers.map((r) => r.id));
  if (outsiderId) await admin.auth.admin.deleteUser(outsiderId);
  console.log(`\n정리: 테스트 Moment ${createdMomentIds.length}개 · 파일 ${createdFiles.length}개 · 임시 계정 1명 삭제 (남은 [live-test] 행: ${leftovers?.length ?? 0} → 0)`);
}

/* ---------- 요약 ---------- */
console.log("\n요약");
let allOk = true;
for (const r of results) {
  const ok = r.items.length > 0 && r.items.every((i) => i.ok);
  allOk &&= ok;
  console.log(`${String(r.no).padStart(2)}. ${r.title} — ${ok ? "PASS" : "FAIL"} (${r.items.filter((i) => i.ok).length}/${r.items.length})`);
}
process.exit(allOk && results.length === 15 ? 0 : 1);
