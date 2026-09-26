"use client";

import { BarChart3, Compass, FolderClock, House, MessageCircle, Plus, Settings, Sun, User, Users } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

type NavItem = { href: string; label: string; icon: typeof Sun; match: RegExp; fab?: boolean };

const FAN_NAV: NavItem[] = [
  { href: "/today", label: "Today", icon: Sun, match: /^\/(today|creators\/[^/]+\/today)/ },
  { href: "/discover", label: "Discover", icon: Compass, match: /^\/(discover|creators\/[^/]+$)/ },
  { href: "/chat", label: "Chat", icon: MessageCircle, match: /^\/chat/ },
  { href: "/archive", label: "Archive", icon: FolderClock, match: /^\/archive/ },
  { href: "/my", label: "My", icon: User, match: /^\/my/ },
];

const CREATOR_NAV: NavItem[] = [
  { href: "/studio", label: "Today", icon: House, match: /^\/studio(\/records)?$/ },
  { href: "/studio/fans", label: "Fans", icon: Users, match: /^\/studio\/fans/ },
  { href: "/studio/record", label: "기록", icon: Plus, match: /^\/studio\/record(\/|$)/, fab: true },
  { href: "/studio/analytics", label: "통계", icon: BarChart3, match: /^\/studio\/analytics/ },
  { href: "/studio/settings", label: "설정", icon: Settings, match: /^\/studio\/settings/ },
];

/** 하단 탭을 숨기는 화면 (몰입형 상세/입력 화면) */
const HIDDEN: RegExp[] = [/^\/chat\/.+/, /^\/moments\//, /^\/subscribe\//, /^\/studio\/record(\/|$)/];

export function BottomNavigation({ mode }: { mode: "fan" | "creator" }) {
  const pathname = usePathname();
  if (HIDDEN.some((r) => r.test(pathname))) return null;

  const items = mode === "fan" ? FAN_NAV : CREATOR_NAV;

  return (
    <>
      {/* 콘텐츠가 탭에 가리지 않도록 여백 */}
      <div className="h-[calc(76px+env(safe-area-inset-bottom))]" aria-hidden />

      <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto w-full max-w-[430px] border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] shadow-nav backdrop-blur-lg">
        <ul className="grid h-[58px] grid-cols-5">
          {items.map(({ href, label, icon: Icon, match, fab }) => {
            const active = match.test(pathname);
            if (fab) {
              return (
                <li key={href} className="flex items-center justify-center">
                  <Link
                    href={href}
                    aria-label="Moment 기록하기"
                    className="pressable grid size-12 -translate-y-1.5 place-items-center rounded-full bg-brand text-white shadow-float"
                  >
                    <Plus className="size-6" strokeWidth={2.4} />
                  </Link>
                </li>
              );
            }
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-[3px] text-micro transition-colors duration-150",
                    active ? "font-semibold text-brand" : "font-medium text-faint hover:text-muted",
                  )}
                >
                  <Icon className="size-[22px]" strokeWidth={active ? 2.1 : 1.7} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
