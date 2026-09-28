"use client";

import { ArrowUp, Loader2, Lock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { SubscriptionBadge } from "@/components/badges";
import { FanToCreatorMessage, OwnCreatorMessage, SystemNotice } from "@/components/chat/messages";
import { BlockSheet, ReportSheet } from "@/components/chat/SafetySheets";
import { Avatar } from "@/components/ui/Avatar";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { SectionHeader } from "@/components/ui/primitives";
import { TopBar } from "@/components/ui/TopBar";
import { MEMORY_CATEGORY_LABEL, type MemoryCategory } from "@/lib/fanMemory";
import { reactionSummary, signalReasons } from "@/lib/fanSignals";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getManagedFan, saveCreatorNote } from "@/lib/services/fanManager";
import { getHumanConversationId, getHumanMessages, HumanChatError, markHumanRead, sendHumanToFan, subscribeHumanMessages, type HumanMessage } from "@/lib/services/humanChat";
import { blockUser, getMyReportedMessageIds, unblockUser } from "@/lib/services/safety";
import { formatShortDate } from "@/lib/utils/format";

/**
 * Creator-safe Fan Profile.
 * 보이는 것: 공개 프로필 · 구독 정보 · 이 채널 Moment 반응 요약 · 직접 대화 · 팬이 명시적으로 공유한 정보 · 내 메모.
 * 보이지 않는 것: 팬의 Creator AI 대화 · AI Memory · 추정(성격 · 감정 · 취약성 등) — 데이터 자체를 받지 않는다.
 */
export function FanDetail({ fanId }: { fanId: string }) {
  const creator = useStudioCreator();
  const [nowMs] = useState(() => Date.now());
  const { data, error, retry } = useMomentData(`fan-detail:${creator.id}:${fanId}`, async () => {
    const fan = await getManagedFan(fanId);
    const [messages, reported] = await Promise.all([fan?.conversationId ? getHumanMessages(fan.conversationId) : Promise.resolve([]), getMyReportedMessageIds()]);
    return { fan, messages, reported };
  });

  const [live, setLive] = useState<HumanMessage[]>([]);
  const [convId, setConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [blocked, setBlocked] = useState<boolean | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [reportedNow, setReportedNow] = useState<Set<string>>(new Set());
  const bottom = useRef<HTMLDivElement>(null);

  const fan = data?.fan;
  const conversationId = convId ?? fan?.conversationId ?? null;
  const loaded = data?.messages ?? [];
  const messages = [...loaded, ...live.filter((m) => !loaded.some((x) => x.id === m.id))].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const isBlocked = blocked ?? fan?.blocked ?? false;
  const canSend = !!fan && (fan.tier === "subscriber" || fan.tier === "premium") && !isBlocked;
  const noteValue = note ?? fan?.note?.content ?? "";

  // 새 직접 메시지 (RLS: 이 대화 참여자에게만 온다)
  useEffect(() => {
    if (!data) return;
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
  }, [data, conversationId, fanId, creator.id]);

  useEffect(() => {
    if (conversationId) void markHumanRead(conversationId);
  }, [conversationId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

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

  async function saveNote() {
    setNoteState("saving");
    try {
      await saveCreatorNote(creator.id, fanId, noteValue);
      setNoteState("saved");
    } catch {
      setNoteState("error");
    }
  }

  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;
  if (!fan) {
    return (
      <main>
        <TopBar backHref="/studio/fans" title="팬 보기" center />
        <p className="px-8 pt-24 text-center text-sub text-muted">이 채널과 연결된 팬이 아니에요.</p>
      </main>
    );
  }

  // 반응 요약은 아래 한 줄로 따로 보여주므로 같은 문장(RECENT_REACTIONS)은 빼고
  const reasons = signalReasons({ ...fan, signals: fan.signals.filter((s) => s !== "RECENT_REACTIONS") }, nowMs);
  const reported = new Set([...data.reported, ...reportedNow]);

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
              {formatShortDate(fan.subscribedAt)}부터 · 구독 {fan.subscribedDays}일
            </p>
          )}
          {isBlocked && <p className="mt-0.5 text-meta text-danger">차단한 팬이에요</p>}
        </div>
      </section>

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
        <p className="mt-0.5 text-meta text-muted">나만 볼 수 있어요. 팬과 Creator AI는 읽지 않아요.</p>
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

      <section className="mt-6">
        <SectionHeader title="직접 대화" />
        <div className="space-y-4 bg-canvas px-4 py-3">
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
            {isBlocked ? "차단한 팬에게는 보낼 수 없어요." : "지금 구독 중인 팬에게만 보낼 수 있어요. 지난 대화는 계속 볼 수 있어요."}
          </p>
        )}
        {sendError && (
          <p role="alert" className="px-5 pt-1 text-caption text-danger">
            {sendError}
          </p>
        )}
        <p className="mt-2 px-5 text-meta text-faint">내가 직접 쓴 메시지만 보내져요. 팬에게는 ✓ {creator.name}로 표시돼요.</p>
      </section>

      <div className="mt-8 flex justify-center">
        <button type="button" onClick={() => setBlockOpen(true)} className="text-caption text-muted hover:text-danger">
          {isBlocked ? "차단 해제" : "이 팬 차단"}
        </button>
      </div>
      <p className="mx-8 mt-4 break-keep text-center text-meta leading-relaxed text-faint">팬의 Creator AI 대화와 AI Memory는 팬만 볼 수 있어요.</p>

      <ReportSheet messageId={reportId} onClose={() => setReportId(null)} onDone={(id) => setReportedNow((s) => new Set([...s, id]))} />
      <BlockSheet
        open={blockOpen}
        onClose={() => setBlockOpen(false)}
        name={fan.nickname}
        blocked={isBlocked}
        effect="차단하면 이 팬과 직접 메시지를 주고받을 수 없고, 이 팬은 내 Creator AI와도 대화할 수 없어요. 지난 대화는 남아 있어요."
        onConfirm={async () => {
          if (isBlocked) await unblockUser(fanId);
          else await blockUser(fanId);
          setBlocked(!isBlocked);
        }}
      />
    </main>
  );
}
