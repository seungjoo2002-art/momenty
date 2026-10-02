"use client";

import { ArrowUp, Bot, Loader2, Lock, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { AIBadge, SubscriptionBadge } from "@/components/badges";
import { FanToCreatorMessage, OwnAvatarMessage, OwnCreatorMessage, SystemNotice } from "@/components/chat/messages";
import { BlockSheet, ReportSheet } from "@/components/chat/SafetySheets";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { SectionHeader } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { planLabel } from "@/lib/constants";
import { MEMORY_CATEGORY_LABEL, type MemoryCategory } from "@/lib/fanMemory";
import { reactionSummary, signalReasons } from "@/lib/fanSignals";
import { buildFanSummary, summaryInputFrom, type AiFanSummary } from "@/lib/fanSummary";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { createAiFanSummary, getFanAiConversation, getManagedFan, saveCreatorNote, type FanAiConversation, type FanAiMessage, type ManagedFanDetail } from "@/lib/services/fanManager";
import { getHumanConversationId, getHumanMessages, HumanChatError, markHumanRead, sendHumanToFan, subscribeHumanMessages, type HumanMessage } from "@/lib/services/humanChat";
import { blockUser, getMyReportedMessageIds, unblockUser } from "@/lib/services/safety";
import { cn } from "@/lib/utils/cn";
import { formatClock, formatDate, formatShortDate } from "@/lib/utils/format";

type Tab = "info" | "chat";

/**
 * Creator-safe Fan Profile.
 * 정보: 구독 정보 → 있었던 일(규칙 기반 사실 · LLM 없음) → 팬이 공유한 정보 → 내 메모 → AI 팬 요약(버튼을 눌렀을 때만 LLM) → 이 팬 차단하기
 * 대화: 한 타임라인 — 팬 메시지 · 내 직접 메시지(human_messages) · AI Avatar 답(ai_messages)을 화면에서만 시간순으로 합친다.
 *       저장소 · 출처는 합치지 않는다. AI 대화는 팬이 열람 안내를 확인한 "뒤"의 것만 (creator_fan_ai_messages).
 *       입력창에서 보내는 것은 항상 크리에이터 본인의 직접 메시지 (받는 쪽 선택 · AI 대신 보내기 없음).
 * 보이지 않는 것: AI Memory 원문 · 안내 확인 전 AI 대화 · 추정(성격 · 감정 · 취약성 등) — 데이터 자체를 받지 않는다.
 */
export function FanDetail({ fanId }: { fanId: string }) {
  const creator = useStudioCreator();
  const [nowMs] = useState(() => Date.now());
  const [tab, setTab] = useState<Tab>("info");
  const [blockedOverride, setBlockedOverride] = useState<boolean | null>(null);
  const { data, error, retry } = useMomentData(`fan-detail:${creator.id}:${fanId}`, async () => {
    const fan = await getManagedFan(fanId);
    const [messages, reported, ai] = await Promise.all([
      fan?.conversationId ? getHumanMessages(fan.conversationId) : Promise.resolve([]),
      getMyReportedMessageIds(),
      fan ? getFanAiConversation(fanId) : Promise.resolve<FanAiConversation>({ consented: false, agreedAt: null, messages: [] }),
    ]);
    return { fan, messages, reported, ai };
  });

  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;
  const fan = data.fan;
  if (!fan) {
    return (
      <main>
        <TopBar backHref="/studio/fans" title="팬 보기" center />
        <p className="px-8 pt-24 text-center text-sub text-muted">이 채널과 연결된 팬이 아니에요.</p>
      </main>
    );
  }

  const blocked = blockedOverride ?? fan.blocked;
  // 규칙 기반 사실 (LLM 없음) — 이미 받은 데이터만. 반응 줄은 "있었던 일"에 따로 있으므로 뺀다
  const conversationFacts = buildFanSummary(
    summaryInputFrom(
      fan,
      data.messages.map((m) => ({ sender: m.sender, content: m.content, createdAt: m.createdAt })),
      data.ai,
    ),
  ).highlights.filter((l) => !l.startsWith("최근 30일 Moment 반응"));
  const lastActivity = [fan.lastReactionAt, fan.lastFanMessageAt].filter((x): x is string => !!x).sort().pop();

  return (
    <main className="animate-fade-in pb-6">
      <TopBar backHref="/studio/fans" title="팬 보기" center />

      <section className="flex items-center gap-3.5 px-5 pt-4">
        <Avatar src={fan.avatarUrl || undefined} name={fan.nickname} size="xl" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-section font-semibold">{fan.nickname}</p>
            {fan.tier && <SubscriptionBadge tier={fan.tier} />}
          </div>
          {fan.subscribedAt && (
            <p className="mt-0.5 text-caption text-muted">
              {formatShortDate(fan.subscribedAt)}부터 · {fan.subscribedDays}일째
            </p>
          )}
          {lastActivity && <p className="text-meta text-faint">최근 활동 {formatShortDate(lastActivity)}</p>}
        </div>
      </section>

      <div role="tablist" className="sticky top-0 z-20 mt-4 flex border-b border-line bg-canvas/95 px-5 backdrop-blur-md">
        {(
          [
            ["info", "정보"],
            ["chat", "대화"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn("relative h-11 flex-1 text-sub", tab === k ? "font-semibold text-ink" : "text-muted")}
          >
            {label}
            <span className={cn("absolute inset-x-6 -bottom-px h-[2px] rounded-full bg-brand", tab === k ? "opacity-100" : "opacity-0")} />
          </button>
        ))}
      </div>

      {/* 탭을 오가도 입력 중인 메모 · 메시지가 사라지지 않도록 모두 그려 두고 숨긴다 */}
      <div hidden={tab !== "info"}>
        <InfoTab fan={fan} nowMs={nowMs} blocked={blocked} onBlockedChange={setBlockedOverride} conversationFacts={conversationFacts} />
      </div>
      <div hidden={tab !== "chat"}>
        <ChatTab fan={fan} fanId={fanId} blocked={blocked} loaded={data.messages} reportedIds={data.reported} ai={data.ai} active={tab === "chat"} />
      </div>
    </main>
  );
}

function InfoTab({
  fan,
  nowMs,
  blocked: isBlocked,
  onBlockedChange,
  conversationFacts,
}: {
  fan: ManagedFanDetail;
  nowMs: number;
  blocked: boolean;
  onBlockedChange: (b: boolean) => void;
  /** 대화 사실 (규칙 기반) — 직접 대화 · 안내 확인 이후 AI Avatar 대화 개수 · 마지막 날짜 */
  conversationFacts: string[];
}) {
  const creator = useStudioCreator();
  const [note, setNote] = useState<string | null>(null);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [blockOpen, setBlockOpen] = useState(false);
  const noteValue = note ?? fan.note?.content ?? "";
  // 반응 요약은 아래 한 줄로 따로 보여주므로 같은 문장(RECENT_REACTIONS)은 빼고
  const reasons = signalReasons({ ...fan, signals: fan.signals.filter((s) => s !== "RECENT_REACTIONS") }, nowMs);

  async function saveNote() {
    setNoteState("saving");
    try {
      await saveCreatorNote(creator.id, fan.fanId, noteValue);
      setNoteState("saved");
    } catch {
      setNoteState("error");
    }
  }

  return (
    <>
      <SectionHeader title="구독 정보" className="mt-5 mb-2" />
      <dl className="mx-5 grid grid-cols-2 gap-2.5">
        <div className="rounded-tile bg-surface px-4 py-3 ring-1 ring-line ring-inset">
          <dt className="text-meta text-muted">구독 플랜</dt>
          <dd className="mt-0.5 text-sub font-semibold">{fan.tier ? planLabel(fan.tier) : "없음"}</dd>
        </div>
        <div className="rounded-tile bg-surface px-4 py-3 ring-1 ring-line ring-inset">
          <dt className="text-meta text-muted">구독 시작</dt>
          <dd className="mt-0.5 text-sub font-semibold">{fan.subscribedAt ? formatShortDate(fan.subscribedAt) : "—"}</dd>
        </div>
      </dl>
      {isBlocked && <p className="mx-5 mt-2 text-meta text-danger">차단한 팬이에요</p>}

      <section className="mt-6">
        <SectionHeader title="있었던 일" caption="실제 기록 그대로예요 · AI가 만든 내용이 아니에요" />
        <ul className="space-y-1 px-5 text-caption leading-relaxed text-ink-2">
          {reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
          <li>· {reactionSummary(fan, nowMs)}</li>
          {conversationFacts.map((l) => (
            <li key={l}>· {l}</li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <SectionHeader title="팬이 공유한 정보" />
        {fan.shares.length === 0 ? (
          <p className="break-keep px-5 text-caption text-muted">팬이 직접 공유한 정보가 없어요. 팬이 AI Memory에서 직접 공유한 항목만 여기에 보여요.</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {fan.shares.map((s) => (
              <li key={s.id} className="px-5 py-2.5">
                <span className="rounded-full bg-brand-tint px-2 py-0.5 text-micro font-medium text-brand">{MEMORY_CATEGORY_LABEL[s.category as MemoryCategory] ?? "기타"}</span>
                <p className="mt-1 text-sub">{s.content}</p>
                {s.eventDate && <p className="text-meta text-faint">날짜 {s.eventDate.slice(5).replace("-", "월 ")}일</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 px-5">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sub font-semibold">내 메모</h2>
          <Lock className="size-3.5 text-faint" />
        </div>
        <p className="mt-0.5 text-meta text-muted">나만 볼 수 있어요. 팬과 AI Avatar는 읽지 않아요.</p>
        <textarea
          value={noteValue}
          onChange={(e) => {
            setNote(e.target.value.slice(0, 1000));
            setNoteState("idle");
          }}
          rows={2}
          aria-label="내 메모"
          placeholder="예: 지난 라이브에서 기타 이야기함"
          className="mt-2 w-full resize-none rounded-tile border border-line-strong bg-surface px-3 py-2 text-sub outline-none focus:border-brand"
        />
        <div className="mt-1 flex items-center justify-end gap-2 text-meta">
          {noteState === "saved" && <span className="text-muted">저장했어요</span>}
          {noteState === "error" && <span className="text-danger">저장하지 못했어요</span>}
          <button type="button" onClick={saveNote} disabled={noteState === "saving" || note === null} className="font-semibold text-brand disabled:opacity-40">
            {noteState === "saving" ? "저장 중…" : "메모 저장"}
          </button>
        </div>
      </section>

      <AiSummarySection fanId={fan.fanId} />

      <div className="mt-8 flex justify-center border-t border-line pt-4">
        {/* 위험 동작 — 큰 버튼 대신 하단 텍스트 action, 색으로 구분 (확인 시트를 거친다) */}
        <button type="button" onClick={() => setBlockOpen(true)} className={cn("h-10 px-4 text-caption", isBlocked ? "text-muted" : "font-medium text-danger")}>
          {isBlocked ? "차단 해제" : "이 팬 차단하기"}
        </button>
      </div>
      <p className="mx-8 mt-4 break-keep text-center text-meta leading-relaxed text-faint">AI Memory는 팬만 볼 수 있어요.</p>

      <BlockSheet
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        name={fan.nickname}
        blocked={isBlocked}
        effect="차단하면 이 팬과 직접 메시지를 주고받을 수 없고, 이 팬은 내 AI Avatar와도 대화할 수 없어요. 지난 대화는 남아 있어요."
        onConfirm={async () => {
          if (isBlocked) await unblockUser(fan.fanId);
          else await blockUser(fan.fanId);
          onBlockedChange(!isBlocked);
        }}
      />
    </>
  );
}

type TimelineItem = { kind: "human"; at: string; m: HumanMessage } | { kind: "ai"; at: string; m: FanAiMessage };

function ChatTab({
  fan,
  fanId,
  blocked,
  loaded,
  reportedIds,
  ai,
  active,
}: {
  fan: ManagedFanDetail;
  fanId: string;
  blocked: boolean;
  loaded: HumanMessage[];
  reportedIds: Iterable<string>;
  ai: FanAiConversation;
  /** 대화 탭이 보이는 중 — 들어오면 맨 아래(최근)로 */
  active: boolean;
}) {
  const creator = useStudioCreator();
  const [live, setLive] = useState<HumanMessage[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportedNow, setReportedNow] = useState<Set<string>>(new Set());
  const bottom = useRef<HTMLDivElement>(null);

  const conversationId = convId ?? fan.conversationId ?? null;
  const messages = [...loaded, ...live.filter((m) => !loaded.some((x) => x.id === m.id))];
  // 화면에서만 합친다 — 직접 메시지(human_messages)와 AI Avatar 대화(ai_messages · 안내 확인 이후)는 출처를 그대로 들고 다닌다
  const timeline: TimelineItem[] = [
    ...messages.map((m) => ({ kind: "human" as const, at: m.createdAt, m })),
    ...ai.messages.map((m) => ({ kind: "ai" as const, at: m.createdAt, m })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const canSend = (fan.tier === "subscriber" || fan.tier === "premium") && !blocked;
  const reported = new Set([...reportedIds, ...reportedNow]);

  // 새 직접 메시지 (RLS: 이 대화 참여자에게만 온다)
  useEffect(() => {
    const add = (list: HumanMessage[]) => setLive((prev) => [...prev, ...list.filter((m) => !prev.some((x) => x.id === m.id))]);
    return subscribeHumanMessages(
      `studio-${fanId}`,
      conversationId,
      (m) => {
        if (conversationId && m.conversationId !== conversationId) return;
        if (!conversationId && m.senderId !== fanId) return;
        setConvId(m.conversationId);
        add([m]);
        void markHumanRead(m.conversationId);
      },
      // 연결되기 전에 도착한 메시지 메우기
      async () => {
        const id = conversationId ?? (await getHumanConversationId(creator.id, fanId));
        if (!id) return;
        const list = await getHumanMessages(id);
        setConvId(id);
        add(list);
      },
    );
  }, [conversationId, fanId, creator.id]);

  useEffect(() => {
    if (conversationId) void markHumanRead(conversationId);
  }, [conversationId]);

  useEffect(() => {
    if (active) bottom.current?.scrollIntoView({ block: "end" });
  }, [timeline.length, active]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const r = await sendHumanToFan(fanId, text);
      setConvId(r.conversationId);
      setLive((prev) => (prev.some((x) => x.id === r.messageId) ? prev : [...prev, { id: r.messageId, conversationId: r.conversationId, sender: "creator", senderId: creator.profileId, content: text, createdAt: new Date().toISOString() }]));
      setInput("");
    } catch (ex) {
      setSendError(ex instanceof HumanChatError ? ex.message : "보내지 못했어요.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="pt-3">
      <p className="mx-5 flex items-start gap-1.5 rounded-tile bg-ai-soft/60 px-3.5 py-2.5 break-keep text-meta leading-relaxed text-ai">
        <Bot className="mt-px size-3.5 shrink-0" />
        {ai.consented
          ? `팬이 열람 안내를 확인한 ${ai.agreedAt ? `${formatShortDate(ai.agreedAt)} ` : ""}이후의 AI Avatar 대화도 함께 보여요. 🤖 표시는 AI가 보낸 답이에요.`
          : "이 팬은 AI 대화 열람 안내를 확인하지 않아 AI Avatar 대화는 보이지 않아요."}
      </p>

      <div className="mt-3 space-y-4 bg-canvas px-4 py-3">
        {timeline.length === 0 && <SystemNotice text="아직 주고받은 메시지가 없어요." />}
        {timeline.map((t) =>
          t.kind === "human" ? (
            t.m.sender === "creator" ? (
              <OwnCreatorMessage key={`h-${t.m.id}`} name={creator.name} text={t.m.content} createdAt={t.m.createdAt} />
            ) : (
              <FanToCreatorMessage
                key={`h-${t.m.id}`}
                name={fan.nickname}
                avatarUrl={fan.avatarUrl}
                text={t.m.content}
                createdAt={t.m.createdAt}
                reported={reported.has(t.m.id)}
                onReport={() => setReportId(t.m.id)}
              />
            )
          ) : t.m.sender === "fan" ? (
            <FanToCreatorMessage key={`a-${t.m.id}`} name={fan.nickname} avatarUrl={fan.avatarUrl} text={t.m.content} createdAt={t.m.createdAt} note="AI Avatar와 나눈 대화" />
          ) : (
            <OwnAvatarMessage key={`a-${t.m.id}`} name={creator.name} text={t.m.content} createdAt={t.m.createdAt} />
          ),
        )}
        <div ref={bottom} />
      </div>

      {canSend ? (
        <form onSubmit={send} className="flex items-end gap-2 border-t border-line bg-surface px-3 pt-2 pb-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 1000))}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1}
            aria-label="직접 메시지"
            placeholder={`${creator.name} 본인으로 보내기`}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[22px] border border-line-strong bg-canvas px-4 py-2.5 text-sub outline-none focus:border-brand"
          />
          <button type="submit" disabled={!input.trim() || sending} aria-label="직접 보내기" className="grid size-11 shrink-0 place-items-center rounded-full bg-brand text-white disabled:opacity-40">
            {sending ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
          </button>
        </form>
      ) : (
        <p className="break-keep px-5 pt-2 text-center text-meta text-muted">
          {blocked ? "차단한 팬에게는 보낼 수 없어요." : "지금 구독 중인 팬에게만 보낼 수 있어요. 지난 대화는 계속 볼 수 있어요."}
        </p>
      )}
      {sendError && (
        <p role="alert" className="px-5 pt-1 text-caption text-danger">
          {sendError}
        </p>
      )}
      <p className="mt-2 px-5 break-keep text-meta text-faint">여기서 보내는 메시지는 항상 내가 직접 보내는 메시지예요. 팬에게는 ✓ {creator.name} 본인으로 표시돼요. AI Memory는 이 화면에 나오지 않아요.</p>

      <ReportSheet messageId={reportId} onClose={() => setReportId(null)} onDone={(id) => setReportedNow((s) => new Set([...s, id]))} />
    </section>
  );
}

/**
 * AI 팬 요약 — 버튼을 눌렀을 때만 서버가 LLM으로 정리한다 (저장하지 않음 · 화면을 떠나면 사라짐).
 * 실패해도 위의 사실 정보는 그대로 · 이전에 정리한 내용도 그대로 둔다.
 */
function AiSummarySection({ fanId }: { fanId: string }) {
  const [summary, setSummary] = useState<AiFanSummary | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setState("loading");
    setError(null);
    try {
      setSummary(await createAiFanSummary(fanId));
      setState("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "요약을 만들지 못했어요.");
      setState("error");
    }
  }

  const loading = state === "loading";
  return (
    <section className="mt-8 px-5" aria-label="AI 팬 요약">
      <div className="flex items-center gap-1.5">
        <h2 className="text-sub font-semibold">AI 팬 요약</h2>
        <AIBadge />
      </div>
      <p className="mt-0.5 break-keep text-meta text-muted">구독 · 반응 · 직접 대화 · 안내 확인 이후의 AI Avatar 대화 · 팬이 공유한 정보만 AI가 정리해요. 추측이나 평가는 하지 않아요.</p>

      {summary ? (
        <>
          <p data-testid="ai-fan-summary" className="mt-2 rounded-tile bg-ai-soft/60 px-4 py-3 break-keep text-caption leading-relaxed text-ink-2">
            {summary.sentences.join(" ")}
          </p>
          <div className="mt-1 flex items-center justify-between gap-2 text-meta">
            <span className="text-faint">
              마지막 정리: {formatDate(summary.generatedAt, false)} {formatClock(summary.generatedAt)}
            </span>
            <button type="button" onClick={run} disabled={loading} className="flex h-8 items-center gap-1 font-semibold text-brand disabled:opacity-40">
              {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
              {loading ? "정리 중…" : "다시 정리하기"}
            </button>
          </div>
        </>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-tile border border-dashed border-line-strong px-4 py-3">
          <span className="text-caption text-muted">{loading ? "정리하고 있어요…" : "아직 정리된 내용이 없어요."}</span>
          <button type="button" onClick={run} disabled={loading} className="flex h-8 shrink-0 items-center gap-1 text-caption font-semibold text-brand disabled:opacity-40">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            {loading ? "정리 중…" : "팬 요약 만들기"}
          </button>
        </div>
      )}
      {state === "error" && error && (
        <p role="alert" className="mt-1.5 text-caption text-danger">
          {error}
        </p>
      )}
      <p className="mt-1.5 break-keep text-micro text-faint">AI가 정리한 내용이라 틀릴 수 있어요. 정리한 내용은 저장되지 않아요.</p>
    </section>
  );
}
