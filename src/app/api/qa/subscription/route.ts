/**
 * POST /api/qa/subscription — QA 전용 임시 구독 (개발 · QA 환경만, v0.9 결제 전까지).
 *
 *   0. QA 모드가 아니면 404 (서버 환경변수로 판단 — 버튼을 숨기는 것만으로 막지 않는다)
 *   1. 같은 origin · 쿠키 세션 → Auth 서버 검증(getUser)
 *   2. 입력: creatorId · targetPlan(follow | subscriber | premium)만. fan id는 받지 않는다 (= auth.uid())
 *   3. qa_set_my_subscription(QA 키, …) — 팬 본인 JWT로. DB가 QA 키 · 크리에이터 · 자기 채널 · 차단 · 등급을 확인하고
 *      실제 subscriptions 행을 바꾼다 → 환영 메시지 · AI 권한 · Premium Moment가 운영 로직 그대로 동작한다.
 * service role을 쓰지 않는다. 실제 결제는 일어나지 않는다.
 */
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { qaSubscriptionKey } from "@/lib/qa";
import { createServerSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const schema = z.strictObject({
  creatorId: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  targetPlan: z.enum(["follow", "subscriber", "premium"]),
});

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).host === req.headers.get("host");
  } catch {
    return false;
  }
}

const DENIALS: Record<string, [number, string]> = {
  qa_disabled: [404, "Not Found"],
  unauthenticated: [401, "로그인이 필요해요."],
  invalid_tier: [400, "요청 형식이 올바르지 않아요."],
  creator_not_found: [404, "크리에이터를 찾을 수 없어요."],
  own_channel: [403, "내 채널은 구독할 수 없어요."],
  blocked: [403, "지금은 이 크리에이터를 구독할 수 없어요."],
};

export async function POST(req: NextRequest) {
  const key = qaSubscriptionKey();
  if (!key) return json(404, { ok: false, error: { code: "not_found" } });
  if (!sameOrigin(req)) return json(403, { ok: false, error: { code: "forbidden_origin" } });

  const sb = await createServerSupabase();
  const { data: auth, error: authError } = await sb.auth.getUser();
  if (authError || !auth.user) return json(401, { ok: false, error: { code: "unauthenticated", message: DENIALS.unauthenticated[1] } });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: { code: "invalid_input" } });
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return json(400, { ok: false, error: { code: "invalid_input", issues: parsed.error.issues.map((i) => i.path.join(".") || i.code) } });

  const { data, error } = await sb.rpc("qa_set_my_subscription", { p_server_key: key, p_creator_id: parsed.data.creatorId, p_tier: parsed.data.targetPlan });
  if (error) {
    const code = Object.keys(DENIALS).find((k) => error.message.includes(k));
    if (code) {
      const [status, message] = DENIALS[code];
      return json(status, { ok: false, error: { code: code === "qa_disabled" ? "not_found" : code, message } });
    }
    console.error("[momenty/qa] subscription failed", error.code);
    return json(500, { ok: false, error: { code: "error", message: "잠시 후 다시 시도해 주세요." } });
  }
  return json(200, { ok: true, qa: true, subscription: data });
}
