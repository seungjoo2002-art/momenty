"use client";

import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import Link from "next/link";
import { SafetyBadge, VerifiedMark, VisibilityBadge } from "@/components/badges";
import { MomentActions } from "@/components/moment/MomentActions";
import { MomentDots } from "@/components/moment/MomentDots";
import { MomentMedia } from "@/components/moment/MomentMedia";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadState";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getCreator } from "@/lib/services/creators";
import { getCurrentFan } from "@/lib/services/fan";
import { getMoment, getMomentsOn } from "@/lib/services/moments";
import { canChat, canViewMoment, tierFor } from "@/lib/utils/access";
import { dateKeyOf, formatClock, formatDate, formatTime, isTodayKst } from "@/lib/utils/format";

async function loadDetail(momentId: string) {
  const moment = await getMoment(momentId);
  if (!moment) return null;
  const [creator, fan, dayMoments] = await Promise.all([
    getCreator(moment.creatorId),
    getCurrentFan(),
    getMomentsOn(moment.creatorId, dateKeyOf(moment.createdAt)),
  ]);
  return creator ? { moment, creator, fan, dayMoments } : null;
}

/** Moment 상세 — 검은 화면에서 미디어를 가장 크게. 저장소의 실제 Moment를 id로 읽는다. */
export function MomentDetailView({ momentId }: { momentId: string }) {
  const { data, error, retry } = useMomentData(`moment:${momentId}`, () => loadDetail(momentId));

  if (data === undefined) {
    return (
      <main className="flex min-h-dvh flex-col bg-black text-white">
        {error && (
          <>
            <TopBar tone="dark" backHref="/today" />
            <LoadError dark message={error} onRetry={retry} className="flex-1 justify-center" />
          </>
        )}
      </main>
    );
  }
  // 없거나, 지워졌거나, 잘못된 id
  if (data === null) {
    return (
      <main className="flex min-h-dvh flex-col bg-black text-white">
        <TopBar tone="dark" backHref="/today" />
        <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
          <p className="text-name font-semibold">이 Moment를 찾을 수 없어요</p>
          <p className="mt-1 text-caption text-white/60">크리에이터가 지웠거나 잘못된 주소예요.</p>
          <ButtonLink href="/today" variant="light" className="mt-6">
            Today로 돌아가기
          </ButtonLink>
        </div>
      </main>
    );
  }

  const { moment, creator, fan, dayMoments } = data;
  const tier = tierFor(fan, creator.id);
  const locked = !canViewMoment(fan, moment);
  const today = isTodayKst(moment.createdAt);
  const dayHref = today ? `/creators/${creator.id}/today` : `/creators/${creator.id}?tab=archive`;
  const index = dayMoments.findIndex((m) => m.id === moment.id);
  const prev = dayMoments[index - 1];
  const next = dayMoments[index + 1];
  const visual = moment.type === "photo" || moment.type === "video";

  return (
    <main className="flex min-h-dvh animate-open flex-col bg-black text-white">
      <TopBar
        tone="dark"
        backHref={dayHref}
        title={
          <Link href={dayHref} className="flex min-w-0 items-center gap-2">
            <Avatar src={creator.avatarUrl} name={creator.name} size="xs" />
            <span className="truncate text-sub font-semibold">{creator.name}</span>
            {creator.verified && <VerifiedMark className="size-3.5 shrink-0" />}
            <span className="shrink-0 text-caption font-normal text-white/55 tabular-nums">
              {!today && `${formatDate(moment.createdAt, false)} `}
              {formatClock(moment.createdAt)}
            </span>
          </Link>
        }
      />

      {/* Media */}
      {locked ? (
        <MomentMedia moment={moment} variant="full" locked />
      ) : visual ? (
        <MomentMedia moment={moment} variant="full" />
      ) : moment.type === "text" ? (
        <div className="flex min-h-[56vh] items-center px-8">
          <p className="text-[22px] leading-[1.6] font-medium tracking-tight">{moment.content}</p>
        </div>
      ) : (
        <div className="flex min-h-[44vh] items-center px-5">
          <div className="w-full">
            <MomentMedia moment={moment} variant="full" dark />
          </div>
        </div>
      )}

      <section className="px-4 pt-2">
        {locked ? (
          <div className="px-1 pt-4 text-center">
            <p className="text-name font-semibold">{moment.visibility === "premium" ? "Premium" : "구독자"} 전용 Moment예요</p>
            <p className="mt-1 text-caption text-white/60">
              {formatTime(moment.createdAt)}에 남긴 이 순간을 함께 보려면 구독이 필요해요.
            </p>
            <ButtonLink href={`/subscribe/${creator.id}`} variant="light" className="mt-5" block>
              구독 플랜 보기
            </ButtonLink>
          </div>
        ) : (
          <>
            <MomentActions moment={moment} initialSaved={fan.savedMomentIds.includes(moment.id)} />

            {moment.type !== "text" && <p className="mt-1 px-1 text-body text-white/90">{moment.content}</p>}

            {(moment.visibility !== "public" || moment.safeShare?.length || moment.location) && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5 px-1">
                {moment.visibility !== "public" && <VisibilityBadge visibility={moment.visibility} />}
                {moment.safeShare?.map((f) => <SafetyBadge key={f} flag={f} />)}
                {moment.location && (
                  <span className="inline-flex items-center gap-0.5 text-meta text-white/55">
                    <MapPin className="size-3" />
                    {moment.location}
                  </span>
                )}
              </div>
            )}

            {canChat(tier) && (
              <Link
                href={`/chat/${creator.id}?moment=${moment.id}`}
                className="mt-4 flex items-center justify-between border-t border-white/10 px-1 py-3.5 text-caption text-white/60 hover:text-white"
              >
                이 순간에 대해 AI와 이야기하기
                <ChevronRight className="size-4" />
              </Link>
            )}
          </>
        )}
      </section>

      {/* 하루 속 이 순간 */}
      {dayMoments.length > 1 && (
        <nav
          aria-label={today ? "오늘의 다른 Moment" : "이날의 다른 Moment"}
          className="mt-auto flex items-center gap-2 px-3 pt-4 pb-[max(env(safe-area-inset-bottom),16px)]"
        >
          {prev ? (
            <Link href={`/moments/${prev.id}`} className="pressable flex h-11 flex-1 items-center gap-1 px-2 text-caption text-white/70">
              <ChevronLeft className="size-4" />
              <span className="tabular-nums">{formatClock(prev.createdAt)}</span>
            </Link>
          ) : (
            <span className="flex-1" />
          )}
          <MomentDots count={dayMoments.length} activeIndex={index} max={12} tone="onImage" />
          {next ? (
            <Link
              href={`/moments/${next.id}`}
              className="pressable flex h-11 flex-1 items-center justify-end gap-1 px-2 text-caption text-white/70"
            >
              <span className="tabular-nums">{formatClock(next.createdAt)}</span>
              <ChevronRight className="size-4" />
            </Link>
          ) : (
            <span className="flex-1" />
          )}
        </nav>
      )}
    </main>
  );
}
