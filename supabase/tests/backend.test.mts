/**
 * Supabase backend 계약 테스트 — 실제 supabase-js가 만드는 요청을 가짜 fetch로 받아 확인한다.
 * (DB 없이도: 어떤 테이블/view를 어떤 조건으로 부르는지, 응답을 앱 타입으로 어떻게 바꾸는지)
 *
 *   npm run test:backend
 */
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://demo.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test";
process.env.NEXT_PUBLIC_DEMO_FAN_EMAIL = "fan@test.dev";
process.env.NEXT_PUBLIC_DEMO_FAN_PASSWORD = "pw";
process.env.NEXT_PUBLIC_DEMO_CREATOR_EMAIL = "creator@test.dev";
process.env.NEXT_PUBLIC_DEMO_CREATOR_PASSWORD = "pw";

const FAN = "00000000-0000-0000-0000-000000000001";
const CREATOR = "00000000-0000-0000-0000-00000000000a";
const M1 = "10000000-0000-0000-0000-000000000001";
const M2 = "10000000-0000-0000-0000-000000000002";

// 브라우저처럼 보이게 (세션 · 모드 판단)
const location = { pathname: "/today" };
Object.assign(globalThis, { window: { location, addEventListener() {}, removeEventListener() {} } });

interface Call {
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
  auth: string | null;
}
const calls: Call[] = [];
let reactionExists = false;

const feedRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  creator_id: "c1",
  type: "photo",
  visibility: "subscriber",
  duration_sec: null,
  created_at: "2026-09-26T15:30:00+00:00", // KST 9/27 00:30
  viewable: true,
  content: "사진",
  media_url: "c1/a.jpg",
  location: null,
  safe_share: [],
  ai_context_enabled: true,
  love_count: 3,
  cheer_count: 1,
  touched_count: 0,
  smile_count: 0,
  liked_by_me: false,
  ...over,
});

function jwt(sub: string) {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, exp: Math.floor(Date.now() / 1000) + 3600, role: "authenticated" })}.sig`;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = new Request(input, init);
  const url = new URL(req.url);
  const text = init?.body && typeof init.body === "string" ? init.body : null;
  const call: Call = {
    method: req.method,
    path: url.pathname,
    params: url.searchParams,
    body: text ? JSON.parse(text) : init?.body ?? null,
    auth: req.headers.get("authorization"),
  };
  calls.push(call);

  if (url.pathname === "/auth/v1/token") {
    const { email } = JSON.parse(text!);
    const sub = email.startsWith("creator") ? CREATOR : FAN;
    return json({ access_token: jwt(sub), refresh_token: "r", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer", user: { id: sub, aud: "authenticated", email } });
  }
  if (url.pathname === "/rest/v1/moment_feed") {
    const id = url.searchParams.get("id");
    // maybeSingle()은 배열을 받아 한 행을 고른다 (실제 PostgREST 동작)
    if (id === `eq.${M2}`) return json([feedRow(M2, { visibility: "premium", viewable: false, content: null, media_url: null })]);
    if (id) return json([feedRow(id.slice(3))]);
    return json([feedRow(M1), feedRow(M2, { visibility: "premium", viewable: false, content: null, media_url: null })]);
  }
  if (url.pathname === "/storage/v1/object/sign/moment-media") {
    const { paths } = JSON.parse(text!);
    return json(paths.map((p: string) => ({ path: p, signedURL: `/object/sign/moment-media/${p}?token=t`, error: null })));
  }
  if (url.pathname.startsWith("/storage/v1/object/moment-media/")) return json({ Key: url.pathname, Id: "x" });
  if (url.pathname === "/rest/v1/moments" && req.method === "POST") return json({ id: M1 }, 201);
  if (url.pathname === "/rest/v1/moments" && req.method === "DELETE") return json([{ media_url: "c1/a.jpg" }]);
  if (url.pathname === "/storage/v1/object/moment-media" && req.method === "DELETE") return json([]);
  if (url.pathname === "/rest/v1/moment_reactions") {
    if (req.method === "GET") return json(reactionExists ? [{ kind: "love" }] : []);
    if (req.method === "POST") return json(null, 201);
    if (req.method === "DELETE") return new Response(null, { status: 204 });
  }
  return json({ message: `unhandled ${req.method} ${url.pathname}` }, 500);
};

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok ? "" : `  → ${JSON.stringify(detail)}`}`);
}
/** Authorization 헤더의 JWT가 누구인지 */
const subOf = (auth: string | null) => {
  try {
    return JSON.parse(Buffer.from(auth!.split(".")[1], "base64url").toString()).sub as string;
  } catch {
    return null;
  }
};
const last = (path: string, method?: string) => [...calls].reverse().find((c) => c.path === path && (!method || c.method === method));

const svc = await import("../../src/lib/services/moments");

console.log("조회 (팬 모드)");
{
  calls.length = 0;
  const list = await svc.getMomentsOn("c1", "2026-09-27");
  const q = last("/rest/v1/moment_feed")!;
  check("moment_feed view를 읽는다", !!q);
  check("크리에이터 필터", q.params.get("creator_id") === "in.(c1)", q.params.get("creator_id"));
  check("KST 9/27 00:00 = UTC 9/26 15:00부터", q.params.get("created_at")?.includes("gte.2026-09-26T15:00:00.000Z") ?? false, q.params.getAll("created_at"));
  check("KST 9/28 00:00 전까지", q.params.getAll("created_at").some((v) => v === "lt.2026-09-27T15:00:00.000Z"), q.params.getAll("created_at"));
  check("시간 오름차순", q.params.get("order") === "created_at.asc", q.params.get("order"));
  check("팬 세션 토큰으로 요청 (RLS가 팬 기준)", subOf(q.auth) === FAN, q.auth);
  check("visibility subscriber → 앱의 subscribers", list[0].visibility === "subscribers");
  check("Storage 경로 → signed URL", list[0].mediaUrl?.startsWith("https://demo.supabase.co/storage/v1/object/sign/moment-media/c1/a.jpg") ?? false, list[0].mediaUrl);
  check("반응 개수 매핑", list[0].reactions.love === 3 && list[0].reactions.cheer === 1);
  check("잠긴 Moment: locked = true, 내용 없음", list[1].locked === true && list[1].content === "" && !list[1].mediaUrl);
  calls.length = 0;
  await svc.getMomentsOn("c1", "2026-09-27");
  check("signed URL은 다시 만들지 않는다 (캐시)", !last("/storage/v1/object/sign/moment-media"));
}

console.log("\n잘못된 id");
{
  calls.length = 0;
  check("uuid가 아닌 id → undefined (요청 없음)", (await svc.getMoment("m101")) === undefined && calls.length === 0);
  check("getMomentsByIds: 잘못된 id만 → []", (await svc.getMomentsByIds(["m101", "x"])).length === 0);
}

console.log("\n생성 (Studio 모드)");
location.pathname = "/studio/record/preview";
{
  calls.length = 0;
  const png = `data:image/png;base64,${Buffer.from("fake").toString("base64")}`;
  const m = await svc.createMoment({
    creatorId: "c1",
    type: "photo",
    content: "새 사진",
    mediaUrl: png,
    visibility: "subscribers",
    aiContextEnabled: false,
  });
  const upload = calls.find((c) => c.path.startsWith("/storage/v1/object/moment-media/c1/"));
  check("사진을 크리에이터 폴더에 업로드", !!upload, calls.map((c) => c.path));
  const insert = last("/rest/v1/moments", "POST")!;
  const body = insert?.body as Record<string, unknown>;
  check("moments에 insert (크리에이터 세션)", subOf(insert?.auth ?? null) === CREATOR, insert?.auth);
  check("visibility subscribers → DB subscriber", body?.visibility === "subscriber", body);
  check("media_url = 업로드 경로", typeof body?.media_url === "string" && (body.media_url as string).startsWith("c1/"), body?.media_url);
  check("ai_context_enabled 전달", body?.ai_context_enabled === false);
  check("created_at은 DB가 정한다 (보내지 않음)", body && !("created_at" in body));
  check("저장 후 feed에서 다시 읽어 돌려준다", m.id === M1);
}

console.log("\n삭제");
{
  calls.length = 0;
  let notified = 0;
  const off = svc.subscribeMoments(() => notified++);
  await svc.deleteMoment(M1);
  off();
  const del = last("/rest/v1/moments", "DELETE")!;
  check("id 조건으로 삭제", del?.params.get("id") === `eq.${M1}`, del?.params.toString());
  check("Storage 파일도 정리", !!last("/storage/v1/object/moment-media", "DELETE"));
  check("화면에 변경 알림", notified === 1);
  let threw = false;
  try {
    await svc.deleteMoment("m101");
  } catch (e) {
    threw = e instanceof Error && e.message.includes("지워진");
  }
  check("잘못된 id 삭제 → 안내 오류 (crash 없음)", threw);
}

console.log("\n반응 (팬 모드)");
location.pathname = "/moments/x";
{
  calls.length = 0;
  reactionExists = false;
  const on = await svc.toggleLove(M1);
  const ins = last("/rest/v1/moment_reactions", "POST")!;
  check("없으면 insert → true", on && !!ins);
  check("본인 user_id · love", JSON.stringify(ins?.body) === JSON.stringify({ moment_id: M1, user_id: FAN, kind: "love" }), ins?.body);
  check("팬 세션으로 요청", subOf(ins?.auth ?? null) === FAN);
  reactionExists = true;
  calls.length = 0;
  const off = await svc.toggleLove(M1);
  check("있으면 delete → false", off === false && !!last("/rest/v1/moment_reactions", "DELETE"));
}

console.log("\n네트워크 실패");
{
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError("Failed to fetch");
  };
  let message = "";
  try {
    await svc.getTodayMoments("c9");
  } catch (e) {
    message = e instanceof Error ? e.message : "";
  }
  globalThis.fetch = real;
  check("화면에 보여줄 한국어 메시지로 바뀐다", message === "네트워크 연결을 확인해 주세요.", message);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
