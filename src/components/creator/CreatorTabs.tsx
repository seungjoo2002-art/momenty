"use client";

import { useState } from "react";
import { cn } from "@/lib/utils/cn";

export type CreatorTab = "today" | "archive" | "intro";

const TABS: { key: CreatorTab; label: string }[] = [
  { key: "today", label: "오늘" },
  { key: "archive", label: "아카이브" },
  { key: "intro", label: "소개" },
];

/** 오늘 | 아카이브 | 소개 — 패널은 서버에서 렌더링되어 들어온다. tab · onTabChange를 주면 바깥(예: 소개 더보기)에서도 탭을 바꿀 수 있다 */
export function CreatorTabs({
  initial,
  panels,
  tab: controlled,
  onTabChange,
}: {
  initial: CreatorTab;
  panels: Record<CreatorTab, React.ReactNode>;
  tab?: CreatorTab;
  onTabChange?: (tab: CreatorTab) => void;
}) {
  const [inner, setInner] = useState<CreatorTab>(initial);
  const tab = controlled ?? inner;
  const setTab = (t: CreatorTab) => (onTabChange ? onTabChange(t) : setInner(t));

  return (
    <>
      <div role="tablist" className="sticky top-0 z-20 flex border-b border-line bg-canvas/95 px-5 backdrop-blur-md">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={cn(
                "relative h-11 flex-1 text-sub transition-colors duration-150",
                active ? "font-semibold text-ink" : "text-muted",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "absolute inset-x-6 -bottom-px h-[2px] rounded-full bg-brand transition-opacity duration-200",
                  active ? "opacity-100" : "opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>
      <div key={tab} role="tabpanel" className="animate-fade-in">
        {panels[tab]}
      </div>
    </>
  );
}
