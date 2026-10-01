"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { WelcomeMessage } from "@/components/chat/messages";
import { Button } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getAvatarOverview, saveWelcomeMessage, WELCOME_MAX } from "@/lib/services/avatar";

/**
 * 구독 환영 메시지 — 유료 구독이 시작되는 순간 팬에게 한 번 전달되는 자동 메시지.
 * 팬 화면에는 항상 "Creator가 설정한 자동 환영 메시지"로 표시된다 (실시간으로 직접 보낸 메시지처럼 보이지 않게).
 * 비워 두면 보내지 않는다. 이미 받은 팬에게 다시 보내지 않는다.
 */
export default function WelcomeSettingsPage() {
  const creator = useStudioCreator();
  const { data, error, retry } = useMomentData(`avatar-welcome:${creator.id}`, () => getAvatarOverview(creator.id));
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;
  const value = text ?? data.welcomeMessage;

  async function save() {
    setState("saving");
    setMessage(null);
    try {
      await saveWelcomeMessage(value);
      setState("saved");
    } catch (e) {
      setState("error");
      setMessage(e instanceof Error ? e.message : "저장하지 못했어요.");
    }
  }

  return (
    <main className="animate-fade-in pb-10">
      <TopBar backHref="/studio/settings/avatar" title="구독 환영 메시지" center />
      <div className="px-5 pt-3">
        <p className="break-keep text-caption leading-relaxed text-muted">
          새 구독자에게 구독이 시작되는 순간 한 번 전달돼요. 팬에게는 “Creator가 설정한 자동 환영 메시지”로 표시돼요. 비워 두면 보내지 않아요.
        </p>
        <textarea
          value={value}
          rows={5}
          onChange={(e) => {
            setText(e.target.value.slice(0, WELCOME_MAX));
            setState("idle");
          }}
          aria-label="구독 환영 메시지"
          placeholder={"예: 안녕! 구독해 줘서 고마워 :)\n앞으로 여기서 내 일상이랑 이야기 많이 나눠 보자."}
          className="mt-4 w-full resize-none rounded-tile border border-line-strong bg-surface px-4 py-3 text-body outline-none placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/10"
        />
        <p className="mt-1 text-right text-micro text-faint tabular-nums">
          {value.length} / {WELCOME_MAX}
        </p>

        {value.trim() && (
          <div className="mt-4 rounded-card bg-canvas p-4">
            <p className="mb-3 text-meta font-medium text-muted">팬에게 이렇게 보여요</p>
            <WelcomeMessage creator={creator} text={value.trim()} createdAt={new Date().toISOString()} aiAvailable={creator.personaEnabled} />
          </div>
        )}

        {message && (
          <p role="alert" className="mt-3 text-caption text-danger">
            {message}
          </p>
        )}
        <Button block size="lg" className="mt-5" onClick={save} disabled={state === "saving" || text === null}>
          {state === "saving" && <Loader2 className="size-5 animate-spin" />}
          {state === "saved" ? "저장했어요" : "저장"}
        </Button>
        <p className="mt-3 break-keep text-meta leading-relaxed text-faint">결제가 열리면 유료 구독이 시작될 때 전달돼요. 무료 팔로우에는 보내지 않아요.</p>
      </div>
    </main>
  );
}
