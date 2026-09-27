/**
 * 서비스 레이어 오류 → 화면에 보여줄 수 있는 한국어 메시지.
 * UI는 ServiceError.message만 보여주면 된다 (DB 오류 원문은 콘솔에만).
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "auth" | "forbidden" | "not_found" | "invalid" | "conflict" | "storage" | "unknown" = "unknown",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

interface DbError {
  code?: string;
  message?: string;
  status?: number;
  statusCode?: string | number;
}

/** Supabase Auth 오류 코드 → 안내 문구 */
const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: "이메일 또는 비밀번호가 맞지 않아요.",
  email_not_confirmed: "메일함에서 가입 확인 링크를 먼저 눌러 주세요.",
  user_already_exists: "이미 가입된 이메일이에요. 로그인해 주세요.",
  email_exists: "이미 가입된 이메일이에요. 로그인해 주세요.",
  weak_password: "비밀번호가 너무 쉬워요. 8자 이상, 영문과 숫자를 섞어 주세요.",
  same_password: "지금 쓰는 비밀번호와 다른 비밀번호를 입력해 주세요.",
  email_address_invalid: "사용할 수 없는 이메일 주소예요.",
  validation_failed: "입력한 내용을 다시 확인해 주세요.",
  over_email_send_rate_limit: "메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.",
  over_request_rate_limit: "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.",
  signup_disabled: "지금은 새 가입을 받지 않아요.",
  session_not_found: "로그인이 만료됐어요. 다시 로그인해 주세요.",
  otp_expired: "링크가 만료됐어요. 다시 요청해 주세요.",
};

export function toServiceError(e: unknown, fallback = "잠시 후 다시 시도해 주세요."): ServiceError {
  if (e instanceof ServiceError) return e;
  if (typeof console !== "undefined") console.error("[momenty/service]", e);

  const err = (e ?? {}) as DbError;
  const message = String(err.message ?? "");
  if (err.code && AUTH_MESSAGES[err.code]) return new ServiceError(AUTH_MESSAGES[err.code], "auth", e);
  if (e instanceof TypeError || /fetch|network|Failed to fetch|NetworkError/i.test(message)) {
    return new ServiceError("네트워크 연결을 확인해 주세요.", "network", e);
  }
  if (/invalid login credentials/i.test(message)) return new ServiceError(AUTH_MESSAGES.invalid_credentials, "auth", e);
  if (/email not confirmed/i.test(message)) return new ServiceError(AUTH_MESSAGES.email_not_confirmed, "auth", e);
  if (err.code === "23505") return new ServiceError("이미 사용 중이에요.", "conflict", e);
  if (err.code === "23503" || /not uploaded/i.test(message)) return new ServiceError("파일 업로드가 끝나지 않았어요. 다시 시도해 주세요.", "storage", e);
  if (/mime type|invalid_mime_type/i.test(message)) return new ServiceError("지원하지 않는 파일 형식이에요.", "invalid", e);
  if (/exceeded the maximum allowed size|payload too large|entity too large/i.test(message) || String(err.statusCode) === "413") {
    return new ServiceError("파일이 너무 커요.", "invalid", e);
  }
  if (err.code === "42501" || err.status === 401 || err.status === 403 || /row-level security|violates row-level/i.test(message)) {
    return new ServiceError("이 작업을 할 수 있는 권한이 없어요.", "forbidden", e);
  }
  if (e instanceof Error && e.name === "StorageFullError") return new ServiceError(e.message, "storage", e);
  return new ServiceError(fallback, "unknown", e);
}
