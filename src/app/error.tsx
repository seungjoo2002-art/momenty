"use client";

import { useEffect } from "react";
import { LoadError } from "@/components/ui/LoadState";

/**
 * 서버에서 데이터를 불러오다 실패했을 때 (DB · 네트워크) — 앱 전체가 깨지지 않고 이 화면에서 다시 시도한다.
 * 클라이언트 화면의 실패는 각 화면의 LoadError가 처리한다.
 */
export default function RouteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[momenty]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[430px] flex-col justify-center bg-canvas">
      <LoadError message="연결 상태를 확인하고 다시 시도해 주세요." onRetry={retry} />
    </main>
  );
}
