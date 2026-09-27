"use client";

import { Check, Loader2, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import { AIBadge } from "@/components/badges";
import { Avatar } from "@/components/ui/Avatar";
import { Button } from "@/components/ui/Button";
import { LoadError } from "@/components/ui/LoadState";
import { Chip, Segmented } from "@/components/ui/primitives";
import { Toggle, ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import {
  BOUNDARY_META,
  BOUNDARY_TOPICS,
  EMOJI_LABEL,
  FACT_CATEGORY_LABEL,
  FORMALITY_LABEL,
  LENGTH_LABEL,
  LIMITS,
  TRAIT_LABEL,
  type BoundaryTopic,
  type CreatorFact,
  type FactCategory,
  type Formality,
  type PersonaPersonality,
  type PersonaStyle,
  type ReplyLength,
  type Trait,
} from "@/lib/persona";
import {
  addFact,
  deleteFact,
  getPersonaSettings,
  reverifyFact,
  savePersona,
  setBoundary,
  setPersonaEnabled,
  updateFact,
  type PersonaSettings as Settings,
} from "@/lib/services/persona";
import type { Creator } from "@/lib/types";
import { cn } from "@/lib/utils/cn";
import { formatShortDate, shortName } from "@/lib/utils/format";

/**
 * Studio → 설정 → Persona. 처음 설정은 5~10분 안에 — 대부분 고르기만 하면 되고, 예시 문장은 몇 개면 충분하다.
 * 말투 · 성향은 "저장하기"로 한 번에, ON/OFF · Boundary · 사실은 바로 저장된다.
 */
export function PersonaSettings({ creator }: { creator: Creator }) {
  const { data, error, retry } = useMomentData(`persona:${creator.id}`, () => getPersonaSettings(creator.id));
  if (!data) {
    return (
      <main className="pb-10">
        <TopBar backHref="/studio/settings" title="Creator AI" center />
        {error && <LoadError message={error} onRetry={retry} />}
      </main>
    );
  }
  return <SettingsBody key={creator.id} creator={creator} initial={data} facts={data.facts} reload={retry} />;
}

function SettingsBody({ creator, initial, facts, reload }: { creator: Creator; initial: Settings; facts: CreatorFact[]; reload: () => void }) {
  const [enabled, setEnabled] = useState(initial.enabled);
  const [style, setStyle] = useState<PersonaStyle>(initial.style);
  const [personality, setPersonality] = useState<PersonaPersonality>(initial.personality);
  const [boundaries, setBoundaries] = useState(initial.boundaries);
  const [configured, setConfigured] = useState(initial.configured);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const edit = (patch: Partial<PersonaStyle>) => {
    setStyle((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  async function toggleEnabled(next: boolean) {
    setEnabled(next);
    try {
      await setPersonaEnabled(creator.id, next);
    } catch (e) {
      setEnabled(!next);
      setNotice({ ok: false, text: e instanceof Error ? e.message : "저장하지 못했어요." });
    }
  }

  async function toggleBoundary(topic: BoundaryTopic, allowed: boolean) {
    setBoundaries((b) => ({ ...b, [topic]: allowed }));
    try {
      await setBoundary(creator.id, topic, allowed);
    } catch (e) {
      setBoundaries((b) => ({ ...b, [topic]: !allowed }));
      setNotice({ ok: false, text: e instanceof Error ? e.message : "저장하지 못했어요." });
    }
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    try {
      await savePersona(creator.id, style, personality);
      setConfigured(true);
      setDirty(false);
      setNotice({ ok: true, text: "저장했어요. 다음 대화부터 반영돼요." });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : "저장하지 못했어요." });
    } finally {
      setSaving(false);
    }
  }

  const toggleTrait = (t: Trait) => {
    setPersonality((p) => ({ traits: p.traits.includes(t) ? p.traits.filter((x) => x !== t) : p.traits.length < LIMITS.traits ? [...p.traits, t] : p.traits }));
    setDirty(true);
  };

  return (
    <main className="pb-10">
      <TopBar backHref="/studio/settings" title="Creator AI" center />

      <section className="mx-5 mt-4 overflow-hidden rounded-card border border-line bg-surface [&>div]:border-b [&>div]:border-line [&>div:last-child]:border-none">
        <ToggleRow
          title="Creator AI 사용"
          description={
            configured
              ? "끄면 팬은 Moment만 보고, AI 대화는 열리지 않아요."
              : "아래 말투를 한 번 저장해야 팬이 대화를 시작할 수 있어요."
          }
          checked={enabled}
          onChange={toggleEnabled}
        />
        <ToggleRow title="AI 응답에 AI 표시" description="모든 AI 답변에는 항상 표시돼요. 끌 수 없어요." defaultOn locked />
      </section>
      <p className="px-6 pt-2.5 text-meta leading-relaxed text-muted">
        Creator AI는 아래에서 확인한 사실과, 팬이 볼 수 있고 ‘AI 참고 허용’한 오늘의 Moment만 근거로 답해요. 근거가 없는 일은 지어내지 않아요.
      </p>

      {/* 말투 */}
      <section className="px-5 pt-8">
        <h2 className="text-body font-semibold">말투</h2>
        <Field label="존댓말 · 반말">
          <Segmented<Formality> value={style.formality} onChange={(v) => edit({ formality: v })} options={(["polite", "casual"] as const).map((v) => ({ value: v, label: FORMALITY_LABEL[v] }))} />
        </Field>
        <Field label="답변 길이">
          <Segmented<ReplyLength>
            value={style.replyLength}
            onChange={(v) => edit({ replyLength: v })}
            options={(["short", "medium", "long"] as const).map((v) => ({ value: v, label: LENGTH_LABEL[v] }))}
          />
        </Field>
        <Field label="웃음 · 이모지">
          <div className="flex flex-wrap gap-2">
            <Chip active={style.laughKk} onClick={() => edit({ laughKk: !style.laughKk })}>
              ㅋㅋ 사용
            </Chip>
            <Chip active={style.laughHh} onClick={() => edit({ laughHh: !style.laughHh })}>
              ㅎㅎ 사용
            </Chip>
          </div>
          <Segmented<string>
            className="mt-2"
            value={String(style.emojiLevel)}
            onChange={(v) => edit({ emojiLevel: Number(v) as PersonaStyle["emojiLevel"] })}
            options={EMOJI_LABEL.map((label, i) => ({ value: String(i), label: `이모지 ${label}` }))}
          />
        </Field>
        <Field label="분위기 (선택)" hint="예: 편안하고 담백한">
          <input
            value={style.mood}
            maxLength={LIMITS.mood}
            onChange={(e) => edit({ mood: e.target.value })}
            placeholder="한마디로 어떤 느낌인가요?"
            className="h-11 w-full rounded-tile border border-line-strong bg-surface px-4 text-sub outline-none focus:border-brand"
          />
        </Field>
        <Field label="자주 쓰는 표현" hint={`${LIMITS.phrases}개까지 · 하나에 ${LIMITS.phraseLength}자`}>
          <ListEditor
            items={style.phrases}
            max={LIMITS.phrases}
            maxLength={LIMITS.phraseLength}
            placeholder="예: 오늘도 무사히"
            onChange={(phrases) => edit({ phrases })}
            chip
          />
        </Field>
      </section>

      {/* 성향 */}
      <section className="px-5 pt-8">
        <h2 className="text-body font-semibold">성향</h2>
        <p className="mt-1 text-caption text-muted">어울리는 것을 {LIMITS.traits}개까지 골라 주세요.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(Object.keys(TRAIT_LABEL) as Trait[]).map((t) => (
            <Chip key={t} active={personality.traits.includes(t)} onClick={() => toggleTrait(t)}>
              {TRAIT_LABEL[t]}
            </Chip>
          ))}
        </div>
      </section>

      {/* 예시 메시지 */}
      <section className="px-5 pt-8">
        <h2 className="text-body font-semibold">내 말투 예시</h2>
        <p className="mt-1 text-caption text-muted">
          평소에 팬에게 쓰는 문장 몇 개면 충분해요. AI는 문장을 그대로 따라 하지 않고 말투의 특징만 참고해요.
        </p>
        <div className="mt-3">
          <ListEditor items={style.examples} max={LIMITS.examples} maxLength={LIMITS.exampleLength} placeholder="예: 오늘 좀 많이 걸었어 ㅋㅋ 다리 아파" onChange={(examples) => edit({ examples })} />
        </div>
        <StylePreview creator={creator} style={style} />
      </section>

      <div className="sticky bottom-0 z-10 mt-6 bg-canvas/95 px-5 pt-3 pb-[max(env(safe-area-inset-bottom),12px)] backdrop-blur-md">
        {notice && (
          <p role={notice.ok ? "status" : "alert"} className={cn("mb-2 text-center text-caption", notice.ok ? "text-safe" : "text-danger")}>
            {notice.text}
          </p>
        )}
        <Button block size="lg" onClick={save} disabled={saving || (!dirty && configured)}>
          {saving && <Loader2 className="size-5 animate-spin" />}
          {configured ? (dirty ? "말투 · 성향 저장하기" : "저장됨") : "저장하고 Creator AI 준비하기"}
        </Button>
      </div>

      {/* Boundaries */}
      <section id="boundaries" className="scroll-mt-14 pt-8">
        <h2 className="px-5 text-body font-semibold">대화 경계</h2>
        <p className="mt-1 px-5 text-caption text-muted">꺼 둔 주제는 AI가 자연스럽게 거절해요. 바로 저장돼요.</p>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-caption font-medium text-ink-2">{label}</span>
        {hint && <span className="text-meta text-faint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/** 짧은 문장 목록 편집 (자주 쓰는 표현 · 예시 메시지) */
function ListEditor({
  items,
  max,
  maxLength,
  placeholder,
  onChange,
  chip,
}: {
  items: string[];
  max: number;
  maxLength: number;
  placeholder: string;
  onChange: (items: string[]) => void;
  chip?: boolean;
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const v = input.trim();
    if (!v || items.length >= max || items.includes(v)) return;
    onChange([...items, v]);
    setInput("");
  };
  return (
    <div>
      {items.length > 0 && (
        <div className={cn(chip ? "flex flex-wrap gap-2" : "space-y-2", "mb-2")}>
          {items.map((it) => (
            <span
              key={it}
              className={cn(
                "inline-flex items-center gap-1 bg-brand-tint text-caption text-ink",
                chip ? "h-9 rounded-full pr-1.5 pl-3.5" : "w-full rounded-tile py-2 pr-1.5 pl-3.5",
              )}
            >
              <span className="min-w-0 flex-1 break-words">{it}</span>
              <button type="button" onClick={() => onChange(items.filter((x) => x !== it))} aria-label={`${it} 삭제`} className="grid size-7 shrink-0 place-items-center rounded-full text-muted hover:text-ink">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      {items.length < max && (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <input
            value={input}
            maxLength={maxLength}
            onChange={(e) => setInput(e.target.value)}
            placeholder={placeholder}
            className="h-11 min-w-0 flex-1 rounded-tile border border-line-strong bg-surface px-4 text-sub outline-none focus:border-brand"
          />
          <button type="submit" disabled={!input.trim()} className="grid size-11 shrink-0 place-items-center rounded-tile bg-brand-soft text-brand disabled:opacity-40" aria-label="추가">
            <Plus className="size-5" />
          </button>
        </form>
      )}
    </div>
  );
}

/** 설정이 말투에 어떻게 반영되는지 보여주는 고정 예시 문장 (AI가 만든 문장이 아니다) */
function StylePreview({ creator, style }: { creator: Creator; style: PersonaStyle }) {
  const polite = style.formality === "polite";
  const laugh = style.laughKk ? " ㅋㅋ" : style.laughHh ? " ㅎㅎ" : "";
  const emoji = ["", " 🙂", " ☺️✨", " 😆💜✨"][style.emojiLevel];
  const base = polite ? `오늘 기록에 남긴 산책 사진 봐 주셨어요?${laugh}` : `오늘 올린 산책 사진 봤어?${laugh}`;
  const more =
    style.replyLength === "short" ? "" : polite ? " 그때 바람이 좋아서 오래 걸었어요." : " 그때 바람 좋아서 오래 걸었어.";
  const longer = style.replyLength === "long" ? (polite ? " 다음에도 좋은 순간이 생기면 남겨 둘게요." : " 다음에도 좋은 순간 생기면 남겨 둘게.") : "";
  return (
    <div className="mt-4 rounded-card bg-canvas p-4">
      <p className="mb-3 text-meta font-medium text-muted">말투 미리보기 · 설정으로 만든 예시 문장</p>
      <div className="flex gap-2.5">
        <Avatar src={creator.avatarUrl || undefined} name={creator.name} size="sm" ring="ai" />
        <div>
          <div className="mb-1 flex items-center gap-1">
            <span className="text-meta text-ink-2">{shortName(creator.name)} AI</span>
            <AIBadge />
          </div>
          <div className="rounded-[20px] rounded-tl-md border border-ai-line bg-surface px-4 py-3 text-sub leading-relaxed">
            {base}
            {more}
            {longer}
            {emoji}
          </div>
        </div>
      </div>
    </div>
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
