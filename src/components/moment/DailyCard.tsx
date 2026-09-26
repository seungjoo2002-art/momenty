import { Photo } from "@/components/ui/Photo";
import type { DailyRecord } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatDate } from "@/lib/utils/format";

/** 지난 하루 타일 (Archive · Creator 아카이브 탭 · Records) */
export function DailyCard({ daily, caption, className }: { daily: DailyRecord; caption?: string; className?: string }) {
  return (
    <div className={className}>
      <Photo src={daily.coverUrl} alt={daily.title} className="aspect-[4/5] rounded-card">
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/60 to-transparent" />
        <span className="absolute top-2 left-2 rounded-full bg-black/35 px-1.5 py-0.5 text-micro font-medium text-white backdrop-blur-sm">
          {daily.momentCount} Moments
        </span>
        <div className="absolute inset-x-2.5 bottom-2.5 text-white">
          <p className="text-micro opacity-80">{formatDate(daily.date, false)}</p>
          <p className="mt-0.5 line-clamp-2 text-caption leading-snug font-semibold">{daily.title}</p>
        </div>
      </Photo>
      {caption && <p className={cn("mt-1.5 truncate px-0.5 text-meta text-muted")}>{caption}</p>}
    </div>
  );
}
