import { cn } from "@/lib/utils/cn";
import { Photo } from "./Photo";

const SIZES = {
  xs: "size-6",
  sm: "size-8",
  md: "size-10",
  lg: "size-[52px]",
  xl: "size-16",
  "2xl": "size-[84px]",
} as const;

const INITIAL: Record<keyof typeof SIZES, string> = {
  xs: "text-[10px]",
  sm: "text-meta",
  md: "text-sub",
  lg: "text-name",
  xl: "text-section",
  "2xl": "text-title",
};

interface AvatarProps {
  src?: string;
  name: string;
  size?: keyof typeof SIZES;
  /**
   * today: 오늘 새 Moment가 있음 (보라 링)
   * seen: 링은 있지만 조용하게 (연한 라벤더)
   * human: 본인 메시지 / ai: Creator AI 메시지
   */
  ring?: "today" | "seen" | "human" | "ai" | "none";
  className?: string;
}

export function Avatar({ src, name, size = "md", ring = "none", className }: AvatarProps) {
  const ringClass = {
    today: "p-[2px] bg-brand",
    seen: "p-[2px] bg-brand-soft",
    human: "p-[1.5px] bg-brand",
    ai: "p-[1.5px] bg-ai-line",
    none: "",
  }[ring];

  return (
    <div className={cn("h-fit w-fit shrink-0 rounded-full", ringClass, className)}>
      <Photo
        src={src || undefined}
        alt={name}
        className={cn("rounded-full", SIZES[size], ring !== "none" && "ring-2 ring-surface")}
      >
        {/* 프로필 사진이 없으면 이름의 첫 글자 */}
        {!src && (
          <span aria-hidden className={cn("absolute inset-0 grid place-items-center font-semibold text-brand-deep/70", INITIAL[size])}>
            {name.trim().charAt(0).toUpperCase()}
          </span>
        )}
      </Photo>
    </div>
  );
}
