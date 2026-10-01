/**
 * 테스트가 남긴 흔적 찾기 — 읽기 전용. 아무것도 지우지 않는다.
 *
 *   npx tsx scripts/find-test-leftovers.mts
 *
 * 보고하는 것
 *   · 테스트 스크립트가 만드는 이메일 형식(momenty-{접두어}-…@gmail.com)의 계정 — "후보"일 뿐, 자동 삭제하지 않는다
 *   · seed 표시(app_metadata.momenty_seed)가 있는 계정 — 운영 프로젝트에는 없어야 한다
 *   · 주인 없는 Storage 파일: moment-media/{없는 채널}/… · avatars/{없는 사용자}/… · 어떤 Moment도 가리키지 않는 파일
 *   · 신고(message_reports): 테스트 형식 계정과 연결된 신고 · 신고자와 대상이 모두 없는(익명화된) 신고.
 *     익명 신고는 실제 탈퇴한 사용자의 운영 신고일 수도 있다 — 테스트 문구와 일치하는지는 참고 표시일 뿐, 원문은 출력하지 않는다
 * 지울지는 사람이 확인하고 정한다 (삭제는 별도의 승인된 작업으로).
 */
import { createClient } from "@supabase/supabase-js";

process.loadEnvFile(".env.local");
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
const TEST_EMAIL = /^momenty-(e2e|ui|mem|hl|sl|hx|sx|dx|lt|pl|hard|hdbg|llm|loop|ai|cui|pui|rt|ax|av)-[a-z0-9-]+@gmail\.com$/;

const users = [];
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  users.push(...data.users);
  if (data.users.length < 1000) break;
}
const userIds = new Set(users.map((u) => u.id));
const testLike = users.filter((u) => TEST_EMAIL.test((u.email ?? "").toLowerCase()));
const seedLike = users.filter((u) => u.app_metadata?.momenty_seed === true);

const { data: creators } = await db.from("creators").select("id");
const creatorIds = new Set((creators ?? []).map((c) => c.id));
const { data: moments } = await db.from("moments").select("media_url, poster_url");
const refs = new Set((moments ?? []).flatMap((m) => [m.media_url, m.poster_url]).filter(Boolean));

async function files(bucket: string) {
  const out: string[] = [];
  const { data: folders } = await db.storage.from(bucket).list("", { limit: 1000 });
  for (const f of folders ?? []) {
    const { data } = await db.storage.from(bucket).list(f.name, { limit: 1000 });
    out.push(...(data ?? []).filter((x) => x.id).map((x) => `${f.name}/${x.name}`));
  }
  return out;
}
const media = await files("moment-media");
const avatars = await files("avatars");
const orphanMedia = media.filter((p) => !creatorIds.has(p.split("/")[0]) || !refs.has(p));
const orphanAvatars = avatars.filter((p) => !userIds.has(p.split("/")[0]));

// 테스트 스크립트가 신고하는 메시지 문구 (human.live · human.e2e · safety.live) — 참고 표시용
const TEST_REPORT_SNAPSHOT = /^(안녕하세요|반가워요) 실시간-[a-z0-9]+$|^안녕하세요, 직접 인사드려요!$|^불편한 메시지$/;
const { data: reports, error: reportsError } = await db.from("message_reports").select("id, reporter_id, reported_user_id, message_snapshot, created_at").order("created_at");
if (reportsError) throw reportsError;
const testIds = new Set(testLike.map((u) => u.id));
const testLinkedReports = (reports ?? []).filter((r) => testIds.has(r.reporter_id) || testIds.has(r.reported_user_id));
const anonymousReports = (reports ?? []).filter((r) => r.reporter_id === null && r.reported_user_id === null);

console.log(`계정 ${users.length}개 중`);
console.log(`  테스트 이메일 형식 후보: ${testLike.length}`);
for (const u of testLike) console.log(`    ${u.id}  ${u.email}  created ${u.created_at.slice(0, 16)}`);
console.log(`  seed 표시 계정: ${seedLike.length}`);
for (const u of seedLike) console.log(`    ${u.id}  created ${u.created_at.slice(0, 16)}`);
console.log(`Storage moment-media ${media.length}개 중 주인 없음 · 참조 없음: ${orphanMedia.length}`);
for (const p of orphanMedia) console.log(`    ${p}  (채널 ${creatorIds.has(p.split("/")[0]) ? "있음 · Moment 참조 없음 (작성 중 업로드일 수 있음)" : "없음"})`);
console.log(`Storage avatars ${avatars.length}개 중 사용자 없는 폴더: ${orphanAvatars.length}`);
for (const p of orphanAvatars) console.log(`    ${p}`);
console.log(`신고 ${reports?.length ?? 0}개 중`);
console.log(`  테스트 형식 계정과 연결된 신고: ${testLinkedReports.length}`);
for (const r of testLinkedReports) console.log(`    ${r.id}  created ${r.created_at.slice(0, 16)}`);
console.log(`  익명화된 신고(신고자 · 대상 모두 없음): ${anonymousReports.length}`);
for (const r of anonymousReports) console.log(`    ${r.id}  created ${r.created_at.slice(0, 16)}  ${TEST_REPORT_SNAPSHOT.test(r.message_snapshot) ? "테스트 문구와 일치 — 테스트 흔적일 가능성 높음" : "테스트 문구 아님 — 운영 신고일 수 있음"}`);
console.log("\n(읽기 전용 — 아무것도 지우지 않았어요)");
