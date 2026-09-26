"use client";

import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

type Tone = "default" | "overlay" | "dark";

interface TopBarProps {
  title?: React.ReactNode;
  /**
   * 뒤로가기는 브라우저 기록을 우선 따른다 (들어온 곳으로 돌아가기).
   * 기록이 없을 때(직접 진입)만 이 경로로 이동한다.
   */
  backHref?: string;
  showBack?: boolean;
  right?: React.ReactNode;
  /**
   * default: 라벤더 바탕 sticky 바
   * overlay: 사진 위에 겹치는 투명 바 (흰 아이콘)
   * dark: 검은 화면(Moment 상세, 기록)용
   */
  tone?: Tone;
  /** 하단 구분선 */
  divider?: boolean;
  /** 제목 가운데 정렬 */
  center?: boolean;
  className?: string;
}

export function TopBar({
  title,
  backHref,
  showBack = true,
  right,
  tone = "default",
  divider = false,
  center = false,
  className,
}: TopBarProps) {
  const router = useRouter();
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(backHref ?? "/today");
  };

  return (
    <header
      className={cn(
        "z-30 flex h-12 items-center gap-1 px-2",
        tone === "overlay" && "absolute inset-x-0 top-0 text-white",
        tone === "dark" && "sticky top-0 bg-black/70 text-white backdrop-blur-md",
        tone === "default" && "sticky top-0 bg-canvas/90 text-ink backdrop-blur-md",
        divider && tone === "default" && "border-b border-line",
        className,
      )}
    >
      {showBack ? (
        <TopBarIcon label="뒤로" onClick={goBack} tone={tone}>
          <ChevronLeft className="size-[22px]" strokeWidth={2} />
        </TopBarIcon>
      ) : (
        <span className="w-2" />
      )}
      <div className={cn("min-w-0 flex-1 truncate text-name font-semibold", center && "text-center")}>{title}</div>
      <div className={cn("flex shrink-0 items-center gap-0.5", center && "min-w-10 justify-end")}>{right}</div>
    </header>
  );
}

/** TopBar에 두는 아이콘 버튼 (44px 터치 영역) */
export function TopBarIcon({
  label,
  onClick,
  children,
  tone = "default",
  pressed,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
  tone?: Tone;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "pressable grid size-10 shrink-0 place-items-center rounded-full",
        tone === "overlay" && "bg-black/25 text-white backdrop-blur",
        tone === "dark" && "text-white hover:bg-white/10",
        tone === "default" && "hover:bg-brand-tint",
      )}
    >
      {children}
    </button>
  );
}
