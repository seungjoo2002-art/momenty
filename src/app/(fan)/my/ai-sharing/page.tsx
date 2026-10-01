"use client";

import { Bot, Loader2 } from "lucide-react";
import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { EmptyState } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { AI_VIEW_NOTICE, getMyAiViewConsents, withdrawAiNotice } from "@/lib/services/aiChat";
import { getCreators } from "@/lib/services/creators";
import { formatShortDate } from "@/lib/utils/format";

/**
 * My › AI Avatar 대화 열람 — 크리에이터별로 확인한 안내를 보고 취소한다.
 * 취소하면 그 크리에이터는 내 AI Avatar 대화를 더 이상 볼 수 없고(확인 전 대화는 원래부터 볼 수 없다),
 * AI Avatar와 다시 대화하려면 안내를 다시 확인해야 한다. AI Memory는 어느 경우에도 크리에이터에게 공개되지 않는다.
 */
export default function AiSharingPage() {
  const { data, error, retry } = useMomentData("ai-sharing", async () => {
    const [consents, creators] = await Promise.all([getMyAiViewConsents(), getCreators()]);
    return consents.map((c) => ({ ...c, creator: creators.find((x) => x.id === c.creatorId) }));
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [err, setErr] = useState<string | null>(null);

  async function withdraw(creatorId: string) {
    setBusy(creatorId);
    setErr(null);
    try {
      await withdrawAiNotice(creatorId);
      setRemoved((s) => new Set([...s, creatorId]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "취소하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  const list = (data ?? []).filter((c) => !removed.has(c.creatorId));

  return (
    <main className="animate-fade-in pb-10">
      <TopBar backHref="/my" title="AI Avatar 대화 열람" center />
      <p className="mx-5 mt-3 flex items-start gap-2 rounded-tile bg-ai-soft/60 px-4 py-3 break-keep text-caption leading-relaxed text-ink-2">
        <Bot className="mt-0.5 size-4 shrink-0 text-ai" />
        {AI_VIEW_NOTICE}
      </p>
      {err && (
        <p role="alert" className="mx-5 mt-3 text-caption text-danger">
          {err}
        </p>
      )}
      {!data ? (
        error ? <LoadError message={error} onRetry={retry} /> : <LoadingBlock />
      ) : list.length === 0 ? (
        <EmptyState icon={<Bot className="size-5" />} title="확인한 안내가 없어요" description="AI Avatar와 대화를 시작할 때 크리에이터별로 안내를 확인해요." />
      ) : (
        <ul className="mt-5 divide-y divide-line border-y border-line">
          {list.map((c) => (
            <li key={c.creatorId} className="flex items-center gap-3 px-5 py-3">
              <Avatar src={c.creator?.avatarUrl} name={c.creator?.name ?? "크리에이터"} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sub font-semibold">{c.creator?.name ?? "크리에이터"}</p>
                <p className="text-meta text-muted">{formatShortDate(c.agreedAt)} 확인 · 이후 대화를 크리에이터가 볼 수 있어요</p>
              </div>
              <button
                type="button"
                onClick={() => withdraw(c.creatorId)}
                disabled={busy === c.creatorId}
                className="inline-flex h-9 shrink-0 items-center gap-1 rounded-full border border-line-strong px-3 text-meta font-medium whitespace-nowrap text-ink-2 disabled:opacity-50"
              >
                {busy === c.creatorId && <Loader2 className="size-3.5 animate-spin" />}
                확인 취소
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mx-6 mt-4 break-keep text-meta leading-relaxed text-faint">취소하면 그 크리에이터는 내 AI Avatar 대화를 볼 수 없고, AI Avatar와 다시 대화하려면 안내를 다시 확인해야 해요.</p>
    </main>
  );
}
