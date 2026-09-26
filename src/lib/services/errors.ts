/**
 * 서비스 레이어 오류 → 화면에 보여줄 수 있는 한국어 메시지.
 * UI는 ServiceError.message만 보여주면 된다 (DB 오류 원문은 콘솔에만).
 */
export class ServiceError extends Error {
  constructor(
    message: string,
    readonly kind: "network" | "auth" | "forbidden" | "not_found" | "storage" | "unknown" = "unknown",
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
}

export function toServiceError(e: unknown, fallback = "잠시 후 다시 시도해 주세요."): ServiceError {
  if (e instanceof ServiceError) return e;
  if (typeof console !== "undefined") console.error("[momenty/service]", e);

  const err = (e ?? {}) as DbError;
  const message = String(err.message ?? "");
  if (e instanceof TypeError || /fetch|network|Failed to fetch|NetworkError/i.test(message)) {
    return new ServiceError("네트워크 연결을 확인해 주세요.", "network", e);
  }
  if (err.code === "42501" || err.status === 401 || err.status === 403 || /row-level security/i.test(message)) {
    return new ServiceError("이 작업을 할 수 있는 권한이 없어요.", "forbidden", e);
  }
  if (/invalid login|email not confirmed/i.test(message)) {
    return new ServiceError("로그인하지 못했어요. 계정 설정을 확인해 주세요.", "auth", e);
  }
  if (e instanceof Error && e.name === "StorageFullError") return new ServiceError(e.message, "storage", e);
  return new ServiceError(fallback, "unknown", e);
}
