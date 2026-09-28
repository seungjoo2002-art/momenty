"use client";

import { useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getMyBlocks, unblockUser } from "@/lib/services/safety";
import { formatShortDate } from "@/lib/utils/format";

/**
 * 차단한 계정 — 내가 차단한 사람만 보인다 (나를 차단한 사람 목록은 없다).
 * 차단 해제 후에도 지난 직접 대화 기록은 그대로다.
 */
export default function BlockedAccountsPage() {
  const { data, error, retry } = useMomentData("my-blocks", getMyBlocks);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const list = (data ?? []).filter((b) => !removed.has(b.userId));

  async function unblock(id: string) {
    setBusy(id);
    setErr(null);
    try {
      await unblockUser(id);
      setRemoved((s) => new Set([...s, id]));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "차단을 풀지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="animate-fade-in pb-10">
      <TopBar backHref="/my" title="차단한 계정" center />
      <p className="break-keep px-5 pt-2 text-caption leading-relaxed text-muted">
        차단하면 서로 직접 메시지를 보낼 수 없고, 크리에이터를 차단하면 그 크리에이터의 Creator AI 대화도 멈춰요. 상대에게 차단했다는 알림은 가지 않아요.
      </p>
      {error && !data && <LoadError message={error} onRetry={retry} />}
      {!data && !error && <LoadingBlock />}
      {data && list.length === 0 && <p className="px-5 pt-10 text-center text-sub text-muted">차단한 계정이 없어요.</p>}
      {err && (
        <p role="alert" className="px-5 pt-3 text-caption text-danger">
          {err}
        </p>
      )}
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {list.map((b) => (
          <li key={b.userId} className="flex items-center gap-3 px-5 py-3">
            <Avatar src={b.avatarUrl || undefined} name={b.name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sub font-semibold">{b.name}</p>
              <p className="text-meta text-faint">
                {b.creatorId ? "크리에이터 · " : ""}
                {formatShortDate(b.blockedAt)} 차단
              </p>
            </div>
            <button type="button" onClick={() => unblock(b.userId)} disabled={busy === b.userId} className="shrink-0 text-caption font-medium text-brand disabled:opacity-50" aria-label={`${b.name} 차단 해제`}>
              {busy === b.userId ? "푸는 중…" : "차단 해제"}
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
