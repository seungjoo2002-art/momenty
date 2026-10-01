"use client";

import { ArrowUp, Bot, Loader2, Lock, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { AIBadge, SubscriptionBadge } from "@/components/badges";
import { FanToCreatorMessage, OwnCreatorMessage, SystemNotice } from "@/components/chat/messages";
import { BlockSheet, ReportSheet } from "@/components/chat/SafetySheets";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { SectionHeader, Segmented } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { planLabel } from "@/lib/constants";
import { MEMORY_CATEGORY_LABEL, type MemoryCategory } from "@/lib/fanMemory";
import { reactionSummary, signalReasons } from "@/lib/fanSignals";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getFanAiConversation, getFanSummary, getManagedFan, saveCreatorNote, type FanAiConversation, type FanSummary, type ManagedFanDetail } from "@/lib/services/fanManager";
import { getHumanConversationId, getHumanMessages, HumanChatError, markHumanRead, sendHumanToFan, subscribeHumanMessages, type HumanMessage } from "@/lib/services/humanChat";
import { blockUser, getMyReportedMessageIds, unblockUser } from "@/lib/services/safety";
import { cn } from "@/lib/utils/cn";
import { formatClock, formatShortDate } from "@/lib/utils/format";

type Tab = "info" | "chat" | "summary";

/**
 * Creator-safe Fan Profile.
 * 정보: 구독 플랜 · 시작일 · 최근 활동 · Moment 반응 · 팬이 명시적으로 공유한 정보 · 내 메모
 * 대화: ✓ 직접 대화(Human Chat) | 🤖 AI Avatar 대화 — 섞지 않고 따로. AI 대화는 팬이 열람 안내를 확인한 "뒤"의 것만.
 * 요약: 허용된 데이터를 규칙으로 정리한 사실 요약 (LLM 없음 · 추정 · 평가 없음). AI 요약은 준비 중 (비활성).
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
            ["summary", "요약"],
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
        <InfoTab fan={fan} nowMs={nowMs} blocked={blocked} onBlockedChange={setBlockedOverride} />
      </div>
      <div hidden={tab !== "chat"}>
        <ChatTab fan={fan} fanId={fanId} blocked={blocked} loaded={data.messages} reportedIds={data.reported} ai={data.ai} />
      </div>
      <div hidden={tab !== "summary"}>{tab === "summary" && <SummaryTab fanId={fanId} />}</div>
    </main>
  );
}

function InfoTab({ fan, nowMs, blocked: isBlocked, onBlockedChange }: { fan: ManagedFanDetail; nowMs: number; blocked: boolean; onBlockedChange: (b: boolean) => void }) {
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
      <dl className="mx-5 mt-5 grid grid-cols-2 gap-2.5">
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
        <SectionHeader title="있었던 일" />
        <ul className="space-y-1 px-5 text-caption leading-relaxed text-ink-2">
          {reasons.map((r) => (
            <li key={r}>· {r}</li>
          ))}
          <li>· {reactionSummary(fan, nowMs)}</li>
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

      <div className="mt-8 flex justify-center">
        <button type="button" onClick={() => setBlockOpen(true)} className="text-caption text-muted hover:text-danger">
          {isBlocked ? "차단 해제" : "이 팬 차단"}
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

function ChatTab({ fan, fanId, blocked, loaded, reportedIds, ai }: { fan: ManagedFanDetail; fanId: string; blocked: boolean; loaded: HumanMessage[]; reportedIds: Iterable<string>; ai: FanAiConversation }) {
  const creator = useStudioCreator();
  const [mode, setMode] = useState<"human" | "ai">("human");
  const [live, setLive] = useState<HumanMessage[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportedNow, setReportedNow] = useState<Set<string>>(new Set());
  const bottom = useRef<HTMLDivElement>(null);

  const conversationId = convId ?? fan.conversationId ?? null;
  const messages = [...loaded, ...live.filter((m) => !loaded.some((x) => x.id === m.id))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
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
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length, mode]);

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
    <section className="pt-4">
      <Segmented<"human" | "ai">
        className="mx-5"
        value={mode}
        onChange={setMode}
        options={[
          { value: "human", label: `✓ 직접 대화 ${messages.length ? messages.length : ""}`.trim() },
          { value: "ai", label: `🤖 AI Avatar 대화 ${ai.messages.length ? ai.messages.length : ""}`.trim() },
        ]}
      />

      {mode === "human" ? (
        <>
          <div className="mt-3 space-y-4 bg-canvas px-4 py-3">
            {messages.length === 0 && <SystemNotice text="아직 직접 주고받은 메시지가 없어요." />}
            {messages.map((m) =>
              m.sender === "creator" ? (
                <OwnCreatorMessage key={m.id} text={m.content} createdAt={m.createdAt} />
              ) : (
                <FanToCreatorMessage key={m.id} name={fan.nickname} avatarUrl={fan.avatarUrl} text={m.content} createdAt={m.createdAt} reported={reported.has(m.id)} onReport={() => setReportId(m.id)} />
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
                placeholder={`✓ ${creator.name}(으)로 직접 보내기`}
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
          <p className="mt-2 px-5 text-meta text-faint">내가 직접 쓴 메시지만 보내져요. 팬에게는 ✓ {creator.name}로 표시돼요.</p>
        </>
      ) : (
        <div className="mt-3">
          <p className="mx-5 flex items-start gap-1.5 rounded-tile bg-ai-soft/60 px-3.5 py-2.5 break-keep text-meta leading-relaxed text-ai">
            <Bot className="mt-px size-3.5 shrink-0" />
            {ai.consented
              ? `팬이 열람 안내를 확인한 ${ai.agreedAt ? formatShortDate(ai.agreedAt) : ""} 이후의 AI Avatar 대화만 보여요. 읽기만 할 수 있어요.`
              : "이 팬은 아직 AI 대화 열람 안내를 확인하지 않았어요. 그래서 AI Avatar 대화는 보이지 않아요."}
          </p>
          <div className="mt-3 space-y-3 bg-canvas px-4 py-3">
            {ai.consented && ai.messages.length === 0 && <SystemNotice text="안내 확인 이후 AI Avatar 대화가 아직 없어요." />}
            {ai.messages.map((m) =>
              m.sender === "fan" ? (
                <div key={m.id} className="flex gap-2 pr-12">
                  <Avatar src={fan.avatarUrl || undefined} name={fan.nickname} size="sm" />
                  <div className="min-w-0">
                    <p className="mb-1 text-meta text-ink-2">{fan.nickname} → 🤖 AI Avatar</p>
                    <div className="rounded-[18px] rounded-tl-[6px] bg-surface px-3.5 py-2.5 text-sub ring-1 ring-line ring-inset">{m.content}</div>
                    <time className="mt-1 block text-micro text-faint">{formatClock(m.createdAt)}</time>
                  </div>
                </div>
              ) : (
                <div key={m.id} className="flex flex-col items-end pl-14">
                  <p className="mb-1 flex items-center gap-1 text-meta text-ai">
                    🤖 {creator.name} AI Avatar <AIBadge />
                  </p>
                  <div className="rounded-[18px] rounded-tr-[6px] border border-ai-line bg-ai-soft px-3.5 py-2.5 text-sub text-ink">{m.content}</div>
                  <time className="mt-1 text-micro text-faint">{formatClock(m.createdAt)} · AI가 보낸 답</time>
                </div>
              ),
            )}
          </div>
          <p className="mt-2 px-5 break-keep text-meta text-faint">AI Avatar의 답은 내가 직접 보낸 메시지가 아니에요. AI Memory는 이 화면에 나오지 않아요.</p>
        </div>
      )}

      <ReportSheet messageId={reportId} onClose={() => setReportId(null)} onDone={(id) => setReportedNow((s) => new Set([...s, id]))} />
    </section>
  );
}

function SummaryTab({ fanId }: { fanId: string }) {
  const { data, error, retry } = useMomentData(`fan-summary:${fanId}`, () => getFanSummary(fanId));
  if (error && !data) return <LoadError message={error} onRetry={retry} className="py-10" />;
  if (!data) return <LoadingBlock />;
  return <SummaryView summary={data} onRefresh={retry} />;
}

function SummaryView({ summary, onRefresh }: { summary: FanSummary; onRefresh: () => void }) {
  const block = (title: string, lines: string[], empty: string) => (
    <section className="mt-5 px-5">
      <h2 className="text-meta font-semibold text-muted">{title}</h2>
      {lines.length ? (
        <ul className="mt-1.5 space-y-1 rounded-card border border-line bg-surface px-4 py-3">
          {lines.map((l) => (
            <li key={l} className="text-caption leading-relaxed break-words text-ink-2">
              · {l}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1.5 text-caption text-muted">{empty}</p>
      )}
    </section>
  );
  return (
    <div className="pb-4">
      <p className="mx-5 mt-4 rounded-tile bg-canvas px-4 py-3 break-keep text-caption leading-relaxed text-ink-2">실제 기록을 바탕으로 정리한 내용입니다. AI가 만든 요약이 아니에요.</p>
      {block("팬 정보", summary.fan, "—")}
      {block("주요 특징", summary.highlights, "아직 나눈 이야기가 없어요.")}
      {block("기억하면 좋은 내용", summary.remember, "팬이 직접 공유한 정보가 없어요.")}
      {block("현재 대화", summary.current, "최근 대화가 없어요.")}
      <p className="mx-5 mt-5 break-keep text-meta leading-relaxed text-faint">
        {summary.generated ? "일부 문장은 AI가 요약했어요. " : ""}
        참고한 것: {summary.sources.join(" · ")}. 건강 · 감정 · 성향 · 경제 상태 같은 추측이나 팬 평가는 하지 않아요.
      </p>
      {/* LLM 요약은 아직 없다 — 눌러도 결과를 만들지 않는 비활성 표시 */}
      <div aria-disabled="true" className="mx-5 mt-4 flex items-center justify-between rounded-tile border border-dashed border-line-strong px-4 py-3 text-caption text-muted">
        <span>AI 요약 · 준비 중</span>
        <span className="text-meta text-faint">아직 사용할 수 없어요</span>
      </div>
      <button type="button" onClick={onRefresh} className="mx-auto mt-3 flex h-9 items-center gap-1.5 text-caption text-muted">
        <RefreshCw className="size-3.5" />
        다시 정리하기
      </button>
    </div>
  );
}
