"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/**
 * 브라우저에서만 알 수 있는 값 (주소의 #해시 · 기기 기능 등).
 * 서버 렌더링과 첫 hydration에서는 null — 화면이 서버 HTML과 어긋나지 않는다.
 */
export function useBrowserValue<T>(read: () => T): T | null {
  return useSyncExternalStore(noop, read, () => null);
}

/** 메일 링크가 실패하면 Supabase가 주소 뒤에 붙여 주는 오류 설명 (#error_description=… 또는 ?error_description=…) */
export function readLinkError(): string {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const query = new URLSearchParams(window.location.search);
  return hash.get("error_description") ?? query.get("error_description") ?? "";
}
