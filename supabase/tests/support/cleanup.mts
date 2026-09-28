/**
 * 테스트 정리 — 이 테스트 실행이 직접 만든 계정(id 목록)만 지운다.
 *
 *   그 계정들이 신고했거나 신고당한 message_reports → Storage(아바타 폴더 · 그 계정 채널의 moment-media 폴더) → auth 사용자(→ DB cascade)
 *
 * · 이메일 형식 · 이름으로 찾아서 지우지 않는다. 호출하는 쪽이 가입할 때 받은 user id만 넘긴다.
 * · admin(service role)은 테스트 준비 · 정리 전용 (앱 경로에서는 쓰지 않는다).
 * · 한 단계가 실패해도 나머지는 계속한다 — 테스트가 중간에 실패해도 최대한 정리되게.
 * · Ctrl+C로 끊겨도 정리하도록 registerCleanup()이 SIGINT · SIGTERM에 건다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

async function removeFolder(admin: SupabaseClient, bucket: string, folder: string): Promise<number> {
  let removed = 0;
  for (;;) {
    const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 100 });
    if (error || !data?.length) return removed;
    const files = data.filter((f) => f.id).map((f) => `${folder}/${f.name}`);
    if (!files.length) return removed;
    const { error: rmError } = await admin.storage.from(bucket).remove(files);
    if (rmError) return removed;
    removed += files.length;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 이 실행이 만든 사용자들의 신고 · Storage · 계정 정리. 남은 것(실패)을 돌려준다 */
export async function cleanupTestUsers(admin: SupabaseClient, userIds: string[]): Promise<{ reports: number; files: number; users: number; failed: string[] }> {
  let reports = 0;
  let files = 0;
  let users = 0;
  const failed: string[] = [];
  // 신고는 계정이 지워지면 익명화(reporter_id · reported_user_id → null)되어 남으므로 계정보다 먼저.
  // 이 사용자들이 신고했거나 신고당한 행만 — 정확한 id로만 고른다
  const ids = [...new Set(userIds)].filter((id) => UUID.test(id));
  if (ids.length) {
    const list = ids.join(",");
    const { data, error } = await admin.from("message_reports").delete().or(`reporter_id.in.(${list}),reported_user_id.in.(${list})`).select("id");
    if (error) failed.push(`message_reports: ${error.message}`);
    reports = data?.length ?? 0;
  }
  for (const uid of [...new Set(userIds)]) {
    try {
      const { data: channels } = await admin.from("creators").select("id").eq("profile_id", uid);
      for (const c of channels ?? []) files += await removeFolder(admin, "moment-media", c.id as string);
      files += await removeFolder(admin, "avatars", uid);
    } catch {
      /* Storage 정리 실패해도 계정 정리는 시도 */
    }
    const { error } = await admin.auth.admin.deleteUser(uid);
    if (!error || /not.*found/i.test(error.message)) users++;
    else failed.push(uid);
  }
  return { reports, files, users, failed };
}

let registered = false;
/** 중단(Ctrl+C 등)돼도 정리. userIds는 같은 배열을 계속 채워 가며 넘긴다 */
export function registerCleanup(admin: SupabaseClient, userIds: string[]) {
  if (registered) return;
  registered = true;
  const onSignal = (sig: string) => {
    console.error(`\n${sig} — 이 테스트가 만든 계정 ${userIds.length}개를 정리하는 중…`);
    void cleanupTestUsers(admin, userIds).finally(() => process.exit(130));
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
}
