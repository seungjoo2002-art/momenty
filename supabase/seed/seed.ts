/**
 * MOMENTY 개발용 seed — 기존 Mock 데이터(크리에이터 8명 · 데모 팬 · 구독 · 지난 하루 · 오늘)를 Supabase에 넣는다.
 *
 *   npm run db:seed -- --confirm-dev      넣기 (여러 번 실행해도 중복되지 않는다)
 *   npm run db:seed -- --reset --confirm-dev   seed로 만든 사용자와 그 데이터를 모두 지우기
 *
 * · 운영 데이터와 섞이지 않도록: seed가 만든 사용자는 app_metadata.momenty_seed = true 로 표시하고,
 *   --reset은 그 사용자(와 cascade로 연결된 creators · moments · subscriptions · reactions)만 지운다.
 * · 이미 있는 "진짜" 계정의 이메일을 데모 계정으로 지정하면 건드리지 않고 멈춘다.
 * · service role key는 이 스크립트(로컬)에서만 쓴다. 절대 NEXT_PUBLIC_ 으로 노출하지 않는다.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { creators } from "@/lib/mock/creators";
import { demoFan } from "@/lib/mock/fan";
import { buildMockDay, buildPastMoments } from "@/lib/mock/moments";
import type { Moment } from "@/lib/types";
import { kstDate } from "@/lib/utils/format";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = new Set(process.argv.slice(2));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!url || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요해요 (.env.local).");
if (!args.has("--confirm-dev")) {
  fail(`개발/데모용 데이터를 넣는 스크립트예요. 대상: ${url}\n  확인했다면 --confirm-dev 를 붙여 다시 실행하세요.`);
}
if (process.env.NODE_ENV === "production") fail("NODE_ENV=production 에서는 실행하지 않아요.");

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const SEED_FLAG = { momenty_seed: true };
const BUCKET = "moment-media";

/** 같은 입력이면 항상 같은 uuid — 다시 실행해도 같은 행이 된다 */
function seedUuid(key: string): string {
  const h = createHash("sha1").update(`momenty-seed:${key}`).digest("hex");
  const variant = (8 | (parseInt(h[16], 16) & 3)).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function allUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
}

async function ensureUser(email: string, password: string, nickname: string): Promise<string> {
  const found = (await allUsers()).find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (found) {
    if (!found.app_metadata?.momenty_seed) fail(`${email} 은(는) seed가 만든 계정이 아니에요. 다른 이메일을 쓰세요.`);
    const { error } = await db.auth.admin.updateUserById(found.id, { password, user_metadata: { nickname } });
    if (error) throw error;
    return found.id;
  }
  const { data, error } = await db.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nickname },
    app_metadata: SEED_FLAG,
  });
  if (error) throw error;
  return data.user.id;
}

async function reset() {
  const seeded = (await allUsers()).filter((u) => u.app_metadata?.momenty_seed);
  const { data: owned } = await db.from("creators").select("id").in(
    "profile_id",
    seeded.map((u) => u.id),
  );
  for (const { id } of owned ?? []) {
    const { data: files } = await db.storage.from(BUCKET).list(id, { limit: 1000 });
    if (files?.length) await db.storage.from(BUCKET).remove(files.map((f) => `${id}/${f.name}`));
  }
  for (const u of seeded) {
    const { error } = await db.auth.admin.deleteUser(u.id);
    if (error) throw error;
  }
  console.log(`✓ seed 사용자 ${seeded.length}명과 연결된 데이터를 지웠어요.`);
}

const toDbVisibility = (v: Moment["visibility"]) => (v === "subscribers" ? "subscriber" : v);

function momentRow(m: Moment, key: string) {
  return {
    id: seedUuid(key),
    creator_id: m.creatorId,
    type: m.type,
    content: m.content,
    media_url: m.mediaUrl ?? null,
    duration_sec: m.durationSec ?? null,
    visibility: toDbVisibility(m.visibility),
    ai_context_enabled: m.aiContextEnabled,
    location: m.location ?? null,
    safe_share: m.safeShare ?? [],
    created_at: m.createdAt,
  };
}

async function seed() {
  // 데모 계정 — 앱 화면은 읽지 않는다 (seed · 테스트 전용, 서버 환경 변수)
  const env = (k: string) => process.env[`DEMO_${k}`];
  const fanEmail = env("FAN_EMAIL");
  const fanPassword = env("FAN_PASSWORD");
  const creatorEmail = env("CREATOR_EMAIL");
  const creatorPassword = env("CREATOR_PASSWORD");
  if (!fanEmail || !fanPassword || !creatorEmail || !creatorPassword) {
    fail("DEMO_FAN_EMAIL/PASSWORD, DEMO_CREATOR_EMAIL/PASSWORD 를 .env.local에 설정하세요.");
  }

  // 1) 사용자 — 데모 팬 1명, 데모 크리에이터(c1) + 나머지 크리에이터 7명
  const fanId = await ensureUser(fanEmail, fanPassword, demoFan.nickname);
  const profileOf: Record<string, string> = {};
  for (const c of creators) {
    profileOf[c.id] =
      c.id === "c1"
        ? await ensureUser(creatorEmail, creatorPassword, c.name)
        : await ensureUser(`seed-${c.id}@seed.momenty.dev`, randomBytes(24).toString("base64url"), c.name);
  }
  console.log(`✓ 사용자 ${creators.length + 1}명`);

  // 2) profiles (가입 trigger가 만든 행을 채운다)
  const profiles = [
    { id: fanId, nickname: demoFan.nickname, handle: demoFan.handle, avatar_url: demoFan.avatarUrl },
    ...creators.map((c) => ({ id: profileOf[c.id], nickname: c.name, handle: c.handle, avatar_url: c.avatarUrl })),
  ];
  const { error: pErr } = await db.from("profiles").upsert(profiles);
  if (pErr) throw pErr;

  // 3) creators
  const { error: cErr } = await db.from("creators").upsert(
    creators.map((c) => ({
      id: c.id,
      profile_id: profileOf[c.id],
      name: c.name,
      handle: c.handle,
      job: c.job,
      category: c.category,
      bio: c.bio,
      avatar_url: c.avatarUrl,
      cover_url: c.coverUrl,
      price_subscriber: c.pricing.subscriber,
      price_premium: c.pricing.premium,
      verified: c.verified,
      tags: c.tags,
      persona_enabled: c.personaEnabled,
      follower_count: c.followers,
      subscriber_count: c.subscribers,
    })),
  );
  if (cErr) throw cErr;
  console.log(`✓ 크리에이터 ${creators.length}명`);

  // 4) 데모 팬의 구독 (결제 연동 전이므로 seed가 직접 넣는다)
  const { error: sErr } = await db.from("subscriptions").upsert(
    demoFan.subscriptions.map((s) => ({
      fan_id: fanId,
      creator_id: s.creatorId,
      tier: s.tier,
      started_at: s.since,
      renews_at: s.renewsAt ?? null,
    })),
    { onConflict: "fan_id,creator_id" },
  );
  if (sErr) throw sErr;
  console.log(`✓ 구독 ${demoFan.subscriptions.length}건 (데모 팬)`);

  // 5) Moment — 지난 하루는 처음 한 번만, 오늘은 지금까지 지난 시각의 것만 (다시 실행하면 이어서 채움)
  const today = kstDate();
  const rows = [
    ...buildPastMoments().map((m) => momentRow(m, m.id)),
    ...buildMockDay(today).map((m) => momentRow(m, `${m.id}|${today}`)),
  ];
  const { data: inserted, error: mErr } = await db
    .from("moments")
    .upsert(rows, { onConflict: "id", ignoreDuplicates: true })
    .select("id");
  if (mErr) throw mErr;
  console.log(`✓ Moment ${inserted?.length ?? 0}개 추가 (이미 있던 것은 그대로)`);

  console.log(`\n데모 팬: ${fanEmail}\n데모 크리에이터(한하린 · c1): ${creatorEmail}\n`);
}

(args.has("--reset") ? reset() : seed()).catch((e) => fail(e instanceof Error ? e.message : JSON.stringify(e)));
