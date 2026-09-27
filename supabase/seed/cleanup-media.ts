/**
 * orphan 미디어 정리 — 어떤 Moment도 가리키지 않는 moment-media 파일을 지운다.
 * (업로드는 됐지만 DB 저장 전에 창을 닫은 경우 · 삭제 후 파일 정리가 실패한 경우)
 *
 *   npm run db:cleanup-media -- --confirm-dev            하루 넘게 참조 없는 파일 목록 → 삭제
 *   npm run db:cleanup-media -- --dry-run --confirm-dev  목록만
 *
 * service role 전용: public.orphan_moment_media()는 service_role만 호출할 수 있다 (v0.4 migration).
 * 참조 여부 판단은 DB가 하고, 파일 삭제는 Storage API로 한다.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const args = new Set(process.argv.slice(2));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;

function fail(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

if (!url || !serviceKey) fail("NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요해요 (.env.local).");
if (!args.has("--confirm-dev")) fail(`Storage 파일을 지우는 스크립트예요. 대상: ${url}\n  확인했다면 --confirm-dev 를 붙여 다시 실행하세요.`);

const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data, error } = await db.rpc("orphan_moment_media", { p_older_than: "1 day" });
if (error) fail(error.message);
const names = (data as { name: string }[]).map((r) => r.name);
console.log(`참조 없는 파일 ${names.length}개${names.length ? `:\n  ${names.join("\n  ")}` : ""}`);

if (names.length && !args.has("--dry-run")) {
  for (let i = 0; i < names.length; i += 100) {
    const { error: removeError } = await db.storage.from("moment-media").remove(names.slice(i, i + 100));
    if (removeError) fail(removeError.message);
  }
  console.log(`✓ ${names.length}개 삭제`);
}
