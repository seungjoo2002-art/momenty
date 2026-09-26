import { ChevronRight, Eye, Heart, Repeat } from "lucide-react";
import Link from "next/link";
import { AIBadge } from "@/components/badges";
import { MOMENT_TYPE_META } from "@/components/moment/meta";
import { Avatar } from "@/components/ui/Avatar";
import { SectionHeader } from "@/components/ui/primitives";
import { getCurrentCreator, getStudioFans, getStudioToday } from "@/lib/services/studio";
import type { MomentType } from "@/lib/types";
import { formatCount } from "@/lib/utils/format";
import { PostedToast, StudioTimeline, TodayAvatar } from "./StudioToday";

const TYPES: MomentType[] = ["photo", "video", "voice", "text"];

export default async function CreatorDashboardPage(props: PageProps<"/studio">) {
  const { posted } = await props.searchParams;
  const creator = await getCurrentCreator();
  const [fans, today] = await Promise.all([getStudioFans(), getStudioToday()]);
  const waiting = fans.filter((f) => f.pendingMessage);
  const recentSubscribers = [...fans].filter((f) => f.tier !== "follow" || f.subscribedToday).sort((a, b) => b.since.localeCompare(a.since));

  return (
    <main className="animate-fade-in">
      <header className="flex h-12 items-center justify-between px-5">
        <span className="text-caption font-bold tracking-[0.28em]">
          MOMENTY <span className="tracking-normal text-brand">Studio</span>
        </span>
        <Link href="/today" className="pressable inline-flex h-8 items-center gap-1.5 rounded-full px-2.5 text-meta text-muted hover:bg-brand-tint">
          <Repeat className="size-3.5" />팬 모드
        </Link>
      </header>

      {posted && <PostedToast />}

      {/* 프로필 + 오늘 통계 */}
      <section className="flex items-center gap-3 px-5 pt-3">
        <TodayAvatar creator={creator} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-name font-semibold">{creator.name}</p>
          <p className="truncate text-meta text-muted">@{creator.handle}</p>
        </div>
        <Link href={`/creators/${creator.id}/today`} className="pressable shrink-0 text-meta text-muted underline-offset-4 hover:underline">
          팬 화면 보기
        </Link>
      </section>
      <div className="mt-4 grid grid-cols-2 gap-2 px-5">
        <div className="rounded-tile border border-line bg-surface px-3.5 py-3">
          <p className="flex items-center gap-1 text-meta text-muted">
            <Eye className="size-3.5" />
            오늘 조회수
          </p>
          <p className="mt-0.5 text-section font-semibold tabular-nums">{formatCount(today.views)}</p>
        </div>
        <div className="rounded-tile border border-line bg-surface px-3.5 py-3">
          <p className="flex items-center gap-1 text-meta text-muted">
            <Heart className="size-3.5" />
            오늘 반응
          </p>
          <p className="mt-0.5 text-section font-semibold tabular-nums">{formatCount(today.reactions)}</p>
        </div>
      </div>

      {/* 가장 중요한 행동: 지금의 순간을 기록하기 */}
      <section className="px-5 pt-4">
        <div className="rounded-[24px] border border-brand/10 bg-gradient-to-br from-brand-soft via-brand-tint to-surface p-5">
          <h1 className="text-section font-semibold">지금, 어떤 순간인가요?</h1>
          <p className="mt-0.5 text-caption text-muted">오늘의 순간을 기록해보세요. 정해진 시간은 없어요.</p>
          <div className="mt-4 grid grid-cols-4 gap-2">
            {TYPES.map((t) => {
              const Icon = MOMENT_TYPE_META[t].icon;
              return (
                <Link
                  key={t}
                  href={`/studio/record?type=${t}`}
                  className="pressable flex h-[68px] flex-col items-center justify-center gap-1.5 rounded-tile bg-surface text-meta font-medium text-ink-2 shadow-card"
                >
                  <Icon className="size-5 text-brand" strokeWidth={1.8} />
                  {MOMENT_TYPE_META[t].label}
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      {/* 오늘의 Fan Brief */}
      <section className="pt-7">
        <SectionHeader title="오늘의 Fan Brief" href="/studio/fans" actionLabel="Fans" />
        <div className="mx-5 rounded-card border border-line bg-surface p-4">
          <div className="flex items-center gap-1.5">
            <AIBadge label="AI 요약" />
          </div>
          <p className="mt-2 text-sub text-ink">{today.fanBrief}</p>
          {waiting.length > 0 && (
            <Link href="/studio/fans" className="mt-3 flex items-center justify-between border-t border-line pt-3 text-caption">
              <span className="text-ink-2">
                직접 답장을 기다리는 팬 <b className="font-semibold text-brand">{waiting.length}명</b>
              </span>
              <ChevronRight className="size-4 text-faint" />
            </Link>
          )}
        </div>
      </section>

      {/* 최근 구독자 */}
      <section className="pt-7">
        <SectionHeader title="최근 구독자" />
        <div className="no-scrollbar flex gap-3.5 overflow-x-auto px-5">
          {recentSubscribers.map((f) => (
            <Link key={f.id} href={`/studio/fans/${f.id}`} className="pressable flex w-14 shrink-0 flex-col items-center">
              <Avatar src={f.avatarUrl} name={f.nickname} size="lg" ring={f.subscribedToday ? "today" : "none"} />
              <span className="mt-1.5 w-full truncate text-center text-micro text-ink-2">{f.nickname}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 오늘의 Timeline — compact */}
      <StudioTimeline creatorId={creator.id} />
    </main>
  );
}
