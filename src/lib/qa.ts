/**
 * QA 전용 임시 구독 (v0.9 결제 전까지) — 서버 전용 설정.
 * `server-only` → Client Component가 import하면 빌드 실패 (키 · 플래그 판단이 브라우저로 가지 않는다).
 *
 * 켜지는 조건 (모두):
 *   ENABLE_QA_SUBSCRIPTION=true   서버 환경변수 (NEXT_PUBLIC 아님)
 *   QA_SUBSCRIPTION_KEY           32자 이상 · DB private.server_keys(id 'qa')에 해시가 등록된 키
 *   VERCEL_ENV ≠ production       운영 배포에서는 플래그가 있어도 꺼진다
 * DB도 한 번 더 막는다: 'qa' 키가 등록되지 않은 DB(운영)에서는 qa_set_my_subscription이 qa_disabled.
 */
import "server-only";

export function qaSubscriptionKey(): string | null {
  if (process.env.ENABLE_QA_SUBSCRIPTION?.trim() !== "true") return null;
  if (process.env.VERCEL_ENV === "production") return null;
  const key = process.env.QA_SUBSCRIPTION_KEY?.trim();
  return key && key.length >= 32 ? key : null;
}

export function isQaSubscriptionEnabled(): boolean {
  return qaSubscriptionKey() !== null;
}
