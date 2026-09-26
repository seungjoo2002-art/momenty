import { cn } from "@/lib/utils/cn";

/**
 * 오늘 남긴 Moment 수만큼의 작은 dot. 시간 축이 아니라 "개수"만 보여준다.
 * 콘텐츠보다 눈에 띄지 않도록 5px, 연한 라벤더 → 최근만 보라.
 */
export function MomentDots({
  count,
  activeIndex,
  max = 8,
  tone = "default",
  className,
}: {
  count: number;
  /** 강조할 dot (기본: 마지막 = 가장 최근) */
  activeIndex?: number;
  max?: number;
  /** onImage: 사진 위에 놓일 때 */
  tone?: "default" | "onImage";
  className?: string;
}) {
  const shown = Math.min(count, max);
  const active = Math.min(activeIndex ?? count - 1, shown - 1);
  return (
    <span className={cn("inline-flex items-center gap-[3px]", className)} aria-hidden>
      {Array.from({ length: shown }, (_, i) => (
        <span
          key={i}
          className={cn(
            "size-[5px] rounded-full",
            i === active ? (tone === "onImage" ? "bg-white" : "bg-brand") : tone === "onImage" ? "bg-white/45" : "bg-brand-2/40",
          )}
        />
      ))}
    </span>
  );
}

/** dot + "5 Moments" 한 줄 — 작은 meta 텍스트 */
export function MomentCount({ count, tone = "default", className }: { count: number; tone?: "default" | "onImage"; className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 text-meta", tone === "onImage" ? "text-white/85" : "text-muted", className)}
      aria-label={`Moment ${count}개`}
    >
      <MomentDots count={count} tone={tone} />
      {count} {count === 1 ? "Moment" : "Moments"}
    </span>
  );
}
