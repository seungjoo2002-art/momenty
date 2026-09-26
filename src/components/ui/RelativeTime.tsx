"use client";

import { useSyncExternalStore } from "react";
import { formatRelative, formatTime } from "@/lib/utils/format";

const subscribe = (onChange: () => void) => {
  const t = setInterval(onChange, 30_000);
  return () => clearInterval(t);
};
/** 분 단위로 고정된 값이어야 스냅샷이 안정적이다 */
const getMinute = () => Math.floor(Date.now() / 60_000);
const getServerMinute = () => null;

/**
 * "32분 전" 같은 상대 시간.
 * 서버 렌더링 시에는 절대 시각을 보여주고, 브라우저에서 상대 시간으로 바뀐다 (hydration 안전).
 */
export function RelativeTime({ iso }: { iso: string }) {
  const minute = useSyncExternalStore(subscribe, getMinute, getServerMinute);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {minute === null ? formatTime(iso) : formatRelative(iso, minute * 60_000)}
    </time>
  );
}
