"use client";

import { Brain, Trash2 } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { Chip, EmptyState } from "@/components/ui/primitives";
import { ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";
import type { Creator, FanMemoryItem } from "@/lib/types";
import { formatShortDate } from "@/lib/utils/format";

const RETENTION = ["30일", "90일", "1년", "구독 기간 동안"];

export function FanMemoryView({ memory, creators }: { memory: FanMemoryItem[]; creators: Creator[] }) {
  const [items, setItems] = useState(memory);
  const [creatorId, setCreatorId] = useState(creators[0]?.id);
  const [retention, setRetention] = useState(RETENTION[1]);

  const visible = items.filter((m) => m.creatorId === creatorId);
  const creator = creators.find((c) => c.id === creatorId);

  return (
    <main>
      <TopBar backHref="/my" title="Fan Memory" center />

      <section className="px-5 pt-5">
        <div className="flex gap-3 rounded-card border border-line bg-surface p-4">
          <div className="grid size-10 shrink-0 place-items-center rounded-tile bg-brand-soft text-brand">
            <Brain className="size-5" />
          </div>
          <div>
            <p className="text-body font-semibold">Creator AI가 기억하는 나</p>
            <p className="mt-1 text-caption leading-relaxed text-muted">
              대화를 이어가기 위해 AI가 기억하는 내용이에요. 언제든 확인하고 지울 수 있고, 크리에이터 본인에게는 요약만 보여요.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-5 mt-5 overflow-hidden rounded-card border border-line bg-surface [&>div]:border-b [&>div]:border-line [&>div:last-child]:border-none">
        <ToggleRow title="Fan Memory 사용" description="끄면 매 대화가 처음처럼 시작돼요." defaultOn />
        <ToggleRow title="대화 요약 저장" description="대화가 끝나면 한 줄 요약만 남겨요." defaultOn />
        <ToggleRow title="크리에이터에게 요약 공유" description="크리에이터가 팬 관리 화면에서 볼 수 있어요." defaultOn={false} />
      </section>

      <section className="mt-6 px-5">
        <p className="mb-2 text-caption font-semibold text-ink-2">보관 기간</p>
        <div className="flex flex-wrap gap-2">
          {RETENTION.map((r) => (
            <Chip key={r} active={retention === r} onClick={() => setRetention(r)}>
              {r}
            </Chip>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <div className="no-scrollbar flex gap-2 overflow-x-auto px-5">
          {creators.map((c) => (
            <Chip key={c.id} active={creatorId === c.id} onClick={() => setCreatorId(c.id)} className="pl-1.5">
              <Avatar src={c.avatarUrl} name={c.name} size="xs" className="scale-90" />
              {c.name}
            </Chip>
          ))}
        </div>

        <div className="mt-4 space-y-2.5 px-4">
          {visible.length === 0 && (
            <EmptyState title="기억된 내용이 없어요" description={`${creator?.name ?? ""} 님의 AI는 아직 나에 대해 기억하는 게 없어요.`} />
          )}
          {visible.map((m) => (
            <div key={m.id} className="flex items-start gap-3 rounded-tile border border-line bg-surface p-3.5">
              <div className="min-w-0 flex-1">
                <span className="rounded-full bg-canvas px-2 py-0.5 text-micro font-semibold text-muted">{m.category}</span>
                <p className="mt-2 text-body leading-relaxed">{m.content}</p>
                <p className="mt-1 text-meta text-faint">{formatShortDate(m.createdAt)} 저장</p>
              </div>
              <button
                onClick={() => setItems(items.filter((i) => i.id !== m.id))}
                className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-canvas hover:text-danger"
                aria-label="삭제"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>

        {visible.length > 0 && (
          <button
            onClick={() => setItems(items.filter((i) => i.creatorId !== creatorId))}
            className="mx-auto mt-5 block text-caption font-medium text-danger"
          >
            {creator?.name} AI의 기억 모두 지우기
          </button>
        )}
      </section>
    </main>
  );
}
