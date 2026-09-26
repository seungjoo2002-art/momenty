"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { subscribeMoments } from "@/lib/services/moments";

export interface MomentData<T> {
  /** undefined면 아직 불러오는 중 (또는 처음부터 실패) */
  data: T | undefined;
  /** 마지막 불러오기가 실패했을 때의 메시지. 이전 데이터가 있으면 그대로 두고 보여준다. */
  error: string | null;
  retry: () => void;
}

/**
 * 서비스 함수로 Moment 데이터를 불러오고, Moment가 바뀌면(새 Moment · 반응 · 삭제) 다시 불러온다.
 * UI는 이 hook으로 services만 호출한다 — 저장소(Supabase / localStorage)를 알지 못한다.
 *
 * key: 불러올 대상이 바뀌면 달라지는 문자열 (예: `today:${creatorId}`)
 */
export function useMomentData<T>(key: string, load: () => Promise<T>): MomentData<T> {
  const [state, setState] = useState<{ key: string; data?: T; error: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    let alive = true;
    const run = () => {
      loadRef.current().then(
        (data) => alive && setState({ key, data, error: null }),
        (e: unknown) =>
          alive &&
          setState((prev) => ({
            key,
            data: prev?.key === key ? prev.data : undefined,
            error: e instanceof Error ? e.message : "불러오지 못했어요.",
          })),
      );
    };
    run();
    const off = subscribeMoments(run);
    return () => {
      alive = false;
      off();
    };
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = state?.key === key ? state : null;
  return { data: current?.data, error: current?.error ?? null, retry };
}
