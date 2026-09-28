/**
 * 계정 삭제 (클라이언트) — 실제 삭제는 POST /api/account/delete 가 본인 세션으로 한다 (service role 없음).
 */
export const DELETE_CONFIRM_PHRASE = "계정 삭제";

export async function deleteMyAccount(password: string, confirm: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password, confirm }),
    });
  } catch {
    throw new Error("네트워크 연결을 확인해 주세요.");
  }
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: { message?: string } };
  if (!res.ok || !body.ok) throw new Error(body.error?.message ?? "지금은 삭제하지 못했어요. 잠시 후 다시 시도해 주세요.");
}
