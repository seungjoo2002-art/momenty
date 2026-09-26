import { CloudOff } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./Button";

/**
 * 데이터를 불러오지 못했을 때 — 앱 전체가 멈추지 않고 이 자리에서만 다시 시도한다.
 * dark: Moment 상세처럼 검은 화면 위
 */
export function LoadError({
  message,
  onRetry,
  dark,
  className,
}: {
  message?: string | null;
  onRetry?: () => void;
  dark?: boolean;
  className?: string;
}) {
  return (
    <div role="alert" className={cn("flex flex-col items-center px-8 py-14 text-center", className)}>
      <CloudOff className={cn("size-6", dark ? "text-white/40" : "text-faint")} />
      <p className="mt-3 text-sub font-semibold">불러오지 못했어요</p>
      <p className={cn("mt-1 text-caption", dark ? "text-white/60" : "text-muted")}>{message || "잠시 후 다시 시도해 주세요."}</p>
      {onRetry && (
        <Button size="sm" variant={dark ? "light" : "soft"} className="mt-5" onClick={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}

/** 불러오는 동안 자리만 잡아 둔다 (레이아웃이 튀지 않도록, 스피너 없이) */
export function LoadingBlock({ className }: { className?: string }) {
  return <div aria-busy className={cn("min-h-[40vh]", className)} />;
}
