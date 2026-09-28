"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";
import { MEMORY_CATEGORY_LABEL } from "@/lib/fanMemory";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getCreators } from "@/lib/services/creators";
import { deleteFanMemories, getFanMemoryState, setFanMemoryEnabled } from "@/lib/services/fanMemory";
import type { FanMemoryItem } from "@/lib/types";
import { formatShortDate } from "@/lib/utils/format";

/** My > AI Memory — Creator AI가 기억하도록 허용한 "나에 관한" 정보. 팬 본인만 보고 지울 수 있다. */
export function FanMemoryView() {
  const { data, error, retry } = useMomentData("fan-memory", async () => {
    const [state, creators] = await Promise.all([getFanMemoryState(), getCreators()]);
    return { state, creators };
  });
  // 서버 값 위에 이 화면에서 바꾼 것만 덮어 둔다 (ON/OFF · 지운 항목)
  const [enabledOverride, setEnabledOverride] = useState<boolean | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const enabled = enabledOverride ?? data?.state.enabled ?? false;
  const items = useMemo(() => (data?.state.items ?? []).filter((m) => !removed.has(m.id)), [data, removed]);
  const groups = useMemo(() => {
    const map = new Map<string, FanMemoryItem[]>();
    for (const m of items) map.set(m.creatorId, [...(map.get(m.creatorId) ?? []), m]);
    return [...map.entries()];
  }, [items]);

  async function toggle(on: boolean) {
    setActionError(null);
    setEnabledOverride(on);
    setBusy("toggle");
    try {
      await setFanMemoryEnabled(on);
    } catch (e) {
      setEnabledOverride(!on);
      setActionError(e instanceof Error ? e.message : "설정을 저장하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(key: string, target: Parameters<typeof deleteFanMemories>[0], ids: string[]) {
    setActionError(null);
    setBusy(key);
    try {
      await deleteFanMemories(target);
      setRemoved((prev) => new Set([...prev, ...ids]));
      setConfirmAll(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "지우지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="animate-fade-in pb-10">
      <TopBar backHref="/my" title="AI Memory" center />

      {error && !data && <LoadError message={error} onRetry={retry} />}
      {!data && !error && <LoadingBlock />}

      {data && (
        <>
          <section className="mx-5 mt-4 overflow-hidden rounded-card border border-line bg-surface">
            <ToggleRow
              title="AI Memory"
              description="Creator AI가 대화에서 기억하도록 허용한 정보입니다."
              checked={enabled}
              disabled={busy === "toggle"}
              onChange={toggle}
            />
          </section>
          <p className="mt-2.5 break-keep px-6 text-meta leading-relaxed text-muted">
            {enabled
              ? "대화 중 내가 말한 호칭 · 관심사 · 일정 같은 것만 기억해요. 건강 · 주소 · 금융 같은 민감한 정보는 기억하지 않아요."
              : "꺼져 있어요. 새로 기억하지 않고, 저장된 기억도 대화에 쓰지 않아요. 저장된 기억은 직접 지울 때까지 남아 있어요. Memory를 꺼도 현재 대화의 최근 메시지는 대화를 이어가기 위해 쓰일 수 있어요."}
            {" "}크리에이터 본인은 이 내용을 볼 수 없고, 각 크리에이터 AI는 자기와 나눈 기억만 써요.
          </p>

          {actionError && (
            <p role="alert" className="mt-3 px-6 text-caption text-danger">
              {actionError}
            </p>
          )}

          {groups.length === 0 ? (
            <p className="mt-10 px-5 text-center text-sub text-muted">아직 기억한 내용이 없어요.</p>
          ) : (
            groups.map(([creatorId, list]) => {
              const creator = data.creators.find((c) => c.id === creatorId);
              const name = creator?.name ?? "크리에이터";
              return (
                <section key={creatorId} className="mt-7" aria-label={`${name} AI의 기억`}>
                  <div className="flex items-center gap-2.5 px-5">
                    <Avatar src={creator?.avatarUrl} name={name} size="sm" />
                    <p className="min-w-0 flex-1 truncate text-sub font-semibold">
                      {name} AI <span className="font-normal text-faint">· {list.length}</span>
                    </p>
                    <button
                      type="button"
                      onClick={() => remove(`creator:${creatorId}`, { creatorId }, list.map((m) => m.id))}
                      disabled={!!busy}
                      className="text-meta text-muted hover:text-danger disabled:opacity-50"
                    >
                      {busy === `creator:${creatorId}` ? "지우는 중…" : "모두 지우기"}
                    </button>
                  </div>
                  <ul className="mt-2 divide-y divide-line border-y border-line">
                    {list.map((m) => (
                      <li key={m.id} className="flex items-start gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1">
                          <span className="inline-block rounded-full bg-brand-tint px-2 py-0.5 text-micro font-medium text-brand">{MEMORY_CATEGORY_LABEL[m.category] ?? "기타"}</span>
                          <p className="mt-1.5 text-body leading-relaxed">{m.content}</p>
                          <p className="mt-0.5 text-meta text-faint">{formatShortDate(m.createdAt)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => remove(m.id, { id: m.id }, [m.id])}
                          disabled={!!busy}
                          aria-label={`"${m.content}" 지우기`}
                          className="grid size-9 shrink-0 place-items-center rounded-full text-faint hover:bg-canvas hover:text-danger disabled:opacity-50"
                        >
                          {busy === m.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}

          {items.length > 0 && (
            <div className="mt-8 px-5 text-center">
              {confirmAll ? (
                <div className="inline-flex items-center gap-3 text-caption">
                  <span className="text-muted">기억 {items.length}개를 모두 지울까요?</span>
                  <button
                    type="button"
                    onClick={() => remove("all", "all", items.map((m) => m.id))}
                    disabled={!!busy}
                    className="font-semibold text-danger disabled:opacity-50"
                  >
                    {busy === "all" ? "지우는 중…" : "지우기"}
                  </button>
                  <button type="button" onClick={() => setConfirmAll(false)} className="text-muted">
                    취소
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => setConfirmAll(true)} className="text-caption font-medium text-danger">
                  기억 전체 지우기
                </button>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
