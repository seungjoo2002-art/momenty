"use client";

import { Check, Loader2, RotateCcw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadState";
import { Chip } from "@/components/ui/primitives";
import { Toggle, ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { BOUNDARY_META, BOUNDARY_TOPICS, FACT_CATEGORY_LABEL, LIMITS, type BoundaryTopic, type CreatorFact, type FactCategory } from "@/lib/persona";
import { addFact, deleteFact, getPersonaSettings, reverifyFact, setBoundary, updateFact, type PersonaSettings as Settings } from "@/lib/services/persona";
import type { Creator } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatShortDate } from "@/lib/utils/format";

/**
 * Studio → 설정 → AI Avatar → 대화 경계 · 확인된 사실.
 * v0.8.5: AI 문답 ON/OFF · 말투 · 성향은 AI Avatar 화면으로 옮겼다. 말투는 학습 답변으로만 바뀐다 (여기서 직접 고치지 않는다).
 * 기본정보(좋아하는 음식 · 취미 …)는 AI Avatar › 기본정보에서 고친다 — 여기 목록에는 나오지 않는다.
 * Boundary · 사실은 바로 저장된다.
 */
export function PersonaSettings({ creator }: { creator: Creator }) {
  const { data, error, retry } = useMomentData(`persona:${creator.id}`, () => getPersonaSettings(creator.id));
  if (!data) {
    return (
      <main className="pb-10">
        <TopBar backHref="/studio/settings/avatar" title="대화 경계 · 확인된 사실" center />
        {error && <LoadError message={error} onRetry={retry} />}
      </main>
    );
  }
  return <SettingsBody key={creator.id} creator={creator} initial={data} facts={data.facts} reload={retry} />;
}

function SettingsBody({ creator, initial, facts, reload }: { creator: Creator; initial: Settings; facts: CreatorFact[]; reload: () => void }) {
  const [boundaries, setBoundaries] = useState(initial.boundaries);
  const [notice, setNotice] = useState<string | null>(null);

  async function toggleBoundary(topic: BoundaryTopic, allowed: boolean) {
    setBoundaries((b) => ({ ...b, [topic]: allowed }));
    try {
      await setBoundary(creator.id, topic, allowed);
    } catch (e) {
      setBoundaries((b) => ({ ...b, [topic]: !allowed }));
      setNotice(e instanceof Error ? e.message : "저장하지 못했어요.");
    }
  }

  return (
    <main className="pb-10">
      <TopBar backHref="/studio/settings/avatar" title="대화 경계 · 확인된 사실" center />

      <p className="mx-5 mt-3 rounded-tile bg-canvas px-4 py-3 break-keep text-meta leading-relaxed text-muted">
        AI 문답 ON/OFF · 말투 · 성향 · 기본정보는{" "}
        <Link href="/studio/settings/avatar" className="font-semibold text-brand">
          AI Avatar
        </Link>
        에서 관리해요. AI Avatar는 아래에서 확인한 사실과, 팬이 볼 수 있고 ‘AI 참고 허용’한 Moment만 사실로 말해요.
      </p>
      <div className="mx-5 mt-3 overflow-hidden rounded-card border border-line bg-surface">
        <ToggleRow title="AI 응답에 AI 표시" description="모든 AI 답변에는 항상 표시돼요. 끌 수 없어요." defaultOn locked />
      </div>

      {/* Boundaries */}
      <section id="boundaries" className="scroll-mt-14 pt-8">
        <h2 className="px-5 text-body font-semibold">대화 경계</h2>
        <p className="mt-1 px-5 text-caption text-muted">꺼 둔 주제는 AI가 자연스럽게 거절해요. 바로 저장돼요.</p>
        {notice && (
          <p role="alert" className="mt-2 px-5 text-caption text-danger">
            {notice}
          </p>
        )}
        <div className="mx-5 mt-3 overflow-hidden rounded-card border border-line bg-surface [&>div]:border-b [&>div]:border-line [&>div:last-child]:border-none">
          {BOUNDARY_TOPICS.map((t) => (
            <ToggleRow key={t} title={BOUNDARY_META[t].label} description={BOUNDARY_META[t].description} checked={boundaries[t]} onChange={(on) => toggleBoundary(t, on)} />
          ))}
        </div>
      </section>

      {/* Verified Facts */}
      {/* 저장 후 다시 불러온 목록으로 새로 그린다 */}
      <FactsSection key={facts.map((f) => `${f.id}:${f.active ? 1 : 0}:${f.content}:${f.lastVerifiedAt}`).join("|")} creatorId={creator.id} facts={facts} reload={reload} />
    </main>
  );
}

function FactsSection({ creatorId, facts: initialFacts, reload }: { creatorId: string; facts: CreatorFact[]; reload: () => void }) {
  const [facts, setFacts] = useState(initialFacts);
  const [category, setCategory] = useState<FactCategory>("food");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; content: string } | null>(null);
  const activeCount = facts.filter((f) => f.active).length;

  async function run(key: string, action: () => Promise<void>, optimistic?: (list: CreatorFact[]) => CreatorFact[]) {
    setBusy(key);
    setError(null);
    const before = facts;
    if (optimistic) setFacts(optimistic(facts));
    try {
      await action();
      reload();
    } catch (e) {
      setFacts(before);
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="px-5 pt-8">
      <h2 className="text-body font-semibold">확인된 사실</h2>
      <p className="mt-1 text-caption text-muted">
        AI가 “사실”로 말할 수 있는 건 여기 적은 내용과 오늘의 Moment뿐이에요. 공개해도 괜찮은 것만 적어 주세요. (활성 {activeCount}/{LIMITS.facts})
      </p>

      <form
        className="mt-3 rounded-card border border-line bg-surface p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const c = content;
          run("add", async () => {
            await addFact(creatorId, category, c);
            setContent("");
          });
        }}
      >
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(FACT_CATEGORY_LABEL) as FactCategory[]).map((k) => (
            <Chip key={k} active={category === k} onClick={() => setCategory(k)} className="h-7 px-3 text-meta">
              {FACT_CATEGORY_LABEL[k]}
            </Chip>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={content}
            maxLength={LIMITS.factLength}
            onChange={(e) => setContent(e.target.value)}
            placeholder="예: 좋아하는 음식은 초밥"
            className="h-11 min-w-0 flex-1 rounded-tile border border-line-strong bg-surface px-4 text-sub outline-none focus:border-brand"
          />
          <Button type="submit" disabled={!content.trim() || busy === "add"} className="shrink-0">
            {busy === "add" ? <Loader2 className="size-4 animate-spin" /> : "추가"}
          </Button>
        </div>
      </form>
      {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}

      {facts.length === 0 ? (
        <p className="mt-4 text-caption text-muted">아직 적은 사실이 없어요. 없으면 AI는 개인적인 질문에 “기록에 없어서 말하기 어렵다”고 답해요.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {facts.map((f) => (
            <li key={f.id} className={cn("px-3.5 py-3", !f.active && "bg-canvas")}>
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 shrink-0 rounded-full bg-brand-tint px-2 py-0.5 text-micro font-medium text-brand-deep">{FACT_CATEGORY_LABEL[f.category]}</span>
                <div className="min-w-0 flex-1">
                  {editing?.id === f.id ? (
                    <form
                      className="flex gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const next = editing.content;
                        run(f.id, () => updateFact(f.id, { content: next }), (list) => list.map((x) => (x.id === f.id ? { ...x, content: next.trim() } : x)));
                        setEditing(null);
                      }}
                    >
                      <input
                        autoFocus
                        value={editing.content}
                        maxLength={LIMITS.factLength}
                        onChange={(e) => setEditing({ id: f.id, content: e.target.value })}
                        className="h-9 min-w-0 flex-1 rounded-[10px] border border-line-strong px-3 text-sub outline-none focus:border-brand"
                      />
                      <button type="submit" aria-label="저장" className="grid size-9 place-items-center rounded-full text-brand">
                        <Check className="size-4" />
                      </button>
                    </form>
                  ) : (
                    <button type="button" onClick={() => setEditing({ id: f.id, content: f.content })} className={cn("text-left text-sub", f.active ? "text-ink" : "text-muted line-through")}>
                      {f.content}
                    </button>
                  )}
                  <p className="mt-0.5 text-micro text-faint">확인 {formatShortDate(f.lastVerifiedAt.slice(0, 10))}</p>
                </div>
                <Toggle
                  checked={f.active}
                  label={`${f.content} 사용`}
                  disabled={busy === f.id}
                  onChange={(on) => run(f.id, () => updateFact(f.id, { active: on }), (list) => list.map((x) => (x.id === f.id ? { ...x, active: on } : x)))}
                />
              </div>
              <div className="mt-1.5 flex justify-end gap-1">
                <button type="button" onClick={() => run(f.id, () => reverifyFact(f.id))} className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-meta text-muted hover:text-ink">
                  <RotateCcw className="size-3" />
                  지금도 사실이에요
                </button>
                <button
                  type="button"
                  onClick={() => run(f.id, () => deleteFact(f.id), (list) => list.filter((x) => x.id !== f.id))}
                  className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-meta text-muted hover:text-danger"
                >
                  <Trash2 className="size-3" />
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
