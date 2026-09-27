import { ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import { VisibilityBadge } from "@/components/badges";
import { FEATURES } from "@/lib/constants";
import type { Moment } from "@/lib/types";
import { MomentMedia } from "./MomentMedia";
import { ReactionButton } from "./ReactionButton";

interface MomentCardProps {
  moment: Moment;
  locked?: boolean;
  /**
   * fan: 반응 · 상세 · 대화로 연결
   * owner: 크리에이터 본인 화면 (링크 없음, 공개범위 항상 표시)
   * preview: 업로드 전 미리보기
   */
  mode?: "fan" | "owner" | "preview";
  /** 팬이 Creator AI와 대화할 수 있는 등급인지 */
  canChat?: boolean;
}

/**
 * Timeline 안의 Moment 하나 — 카드로 감싸지 않는다.
 * 사진·영상은 크게, 텍스트는 그대로 글로, 음성은 플레이어로. 서로 자연스럽게 섞인다.
 */
export function MomentCard({ moment, locked, mode = "fan", canChat }: MomentCardProps) {
  if (locked) {
    return (
      <Link href={`/subscribe/${moment.creatorId}`} className="pressable block">
        <MomentMedia moment={moment} variant="card" locked />
        <p className="mt-2 flex items-center text-meta text-muted">
          구독하면 이 순간을 함께 볼 수 있어요
          <ChevronRight className="size-3.5" />
        </p>
      </Link>
    );
  }

  const linked = mode === "fan";
  const detailHref = `/moments/${moment.id}`;
  const isText = moment.type === "text";
  const isVoice = moment.type === "voice";

  const body = isText ? (
    <p className="text-name leading-relaxed font-normal text-ink">{moment.content || "…"}</p>
  ) : isVoice ? null : (
    <MomentMedia moment={moment} variant="card" />
  );

  const showVisibility = mode !== "fan" || moment.visibility !== "public";

  return (
    <article>
      {isVoice && <MomentMedia moment={moment} variant="card" />}
      {body &&
        (linked ? (
          <Link href={detailHref} className="pressable block">
            {body}
          </Link>
        ) : (
          body
        ))}

      {!isText && moment.content && (
        <p className="mt-2 text-sub text-ink">
          {linked ? <Link href={detailHref}>{moment.content}</Link> : moment.content}
        </p>
      )}

      {(showVisibility || moment.location) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          {showVisibility && <VisibilityBadge visibility={moment.visibility} />}
          {moment.location && (
            <span className="inline-flex items-center gap-0.5 text-meta text-muted">
              <MapPin className="size-3" />
              {moment.location}
            </span>
          )}
        </div>
      )}

      {mode !== "preview" && (
        <div className="mt-1 flex items-center gap-3">
          <ReactionButton moment={moment} readOnly={!linked} />
          {linked && canChat && FEATURES.creatorAI && (
            <Link href={`/chat/${moment.creatorId}?moment=${moment.id}`} className="py-2 text-meta text-muted hover:text-ink">
              이 순간 이야기하기
            </Link>
          )}
          {linked && (
            <Link href={detailHref} className="ml-auto flex items-center py-2 text-meta text-muted hover:text-ink">
              자세히
              <ChevronRight className="size-3.5" />
            </Link>
          )}
        </div>
      )}
    </article>
  );
}
