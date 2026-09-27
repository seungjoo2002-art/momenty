import "server-only";

/** 모델 호출이 실패했을 때 (Route가 503/502로 바꾼다 — 키 · 원문 오류는 응답에 넣지 않는다) */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
