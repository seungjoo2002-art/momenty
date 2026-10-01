"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { WelcomeMessage } from "@/components/chat/messages";
import { Button } from "@/components/ui/Button";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { ToggleRow } from "@/components/ui/Toggle";
import { TopBar } from "@/components/ui/TopBar";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { getAvatarOverview, saveWelcomeMessage, setWelcomeMode, WELCOME_MAX, type WelcomeMode } from "@/lib/services/avatar";

/**
 * 구독 환영 메시지 — 유료 구독이 시작되는 순간 팬에게 한 번 전달되는 자동 메시지.
 * 팬 화면에는 항상 "Creator가 설정한 자동 환영 메시지"로 표시된다 (실시간으로 직접 보낸 메시지처럼 보이지 않게).
 * 비워 두면: AI Avatar가 켜져 있으면 공식 AI Avatar의 기본 환영 메시지, 꺼져 있으면 MOMENTY 구독 안내 (DB trigger가 정한다).
 * 끄면(welcome_mode 'off'): 크리에이터 문구 · AI 문구 모두 쓰지 않고 MOMENTY 구독 안내만. 이미 받은 팬에게 다시 보내지 않는다.
 */
export default function WelcomeSettingsPage() {
  const creator = useStudioCreator();
  const { data, error, retry } = useMomentData(`avatar-welcome:${creator.id}`, () => getAvatarOverview(creator.id));
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<WelcomeMode | null>(null);
  const [modeSaving, setModeSaving] = useState(false);

  if (error && !data) return <LoadError message={error} onRetry={retry} className="pt-32" />;
  if (!data) return <LoadingBlock />;
  const value = text ?? data.welcomeMessage;
  const currentMode = mode ?? data.welcomeMode;
  const aiOn = data.enabled;
  // 지금 설정이면 새 구독자가 받게 될 메시지 (DB trigger와 같은 우선순위)
  const outcome: "creator" | "default_ai" | "system" = currentMode === "off" ? "system" : value.trim() ? "creator" : aiOn ? "default_ai" : "system";
  const previewText = outcome === "creator" ? value.trim() : outcome === "default_ai" ? "구독해 줘서 고마워! 앞으로 여기서 자주 이야기하자 😊" : "구독이 시작되었어요.";

  async function changeMode(on: boolean) {
    const next: WelcomeMode = on ? "auto" : "off";
    setModeSaving(true);
    setMessage(null);
    try {
      setMode(await setWelcomeMode(next));
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setModeSaving(false);
    }
  }

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
          새 구독자에게 구독이 시작되는 순간 한 번 전달돼요. 팬에게는 “Creator가 설정한 자동 환영 메시지”로 표시돼요.
        </p>
      </div>
      <div className="mt-2 border-y border-line">
        <ToggleRow
          title="환영 메시지 보내기"
          description={currentMode === "off" ? "꺼 두면 새 구독자에게 MOMENTY 구독 안내만 전달돼요." : aiOn ? "설정하지 않으면 공식 AI Avatar가 기본 환영 메시지를 보내요." : "설정하지 않으면 MOMENTY 구독 안내만 전달돼요."}
          checked={currentMode === "auto"}
          disabled={modeSaving}
          onChange={changeMode}
        />
      </div>
      <div className="px-5 pt-1">
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

        <div className="mt-4 rounded-card bg-canvas p-4">
          <p className="mb-3 text-meta font-medium text-muted">팬에게 이렇게 보여요</p>
          <WelcomeMessage creator={creator} text={previewText} createdAt={new Date().toISOString()} source={outcome} aiAvailable={aiOn} />
          {currentMode === "auto" && outcome !== "creator" && <p className="mt-3 break-keep text-meta text-faint">직접 문구를 쓰면 이 메시지 대신 내 문구가 전달돼요.</p>}
        </div>

        {message && (
          <p role="alert" className="mt-3 text-caption text-danger">
            {message}
          </p>
        )}
        <Button block size="lg" className="mt-5" onClick={save} disabled={state === "saving" || text === null}>
          {state === "saving" && <Loader2 className="size-5 animate-spin" />}
          {state === "saved" ? "저장했어요" : "저장"}
        </Button>
        <p className="mt-3 break-keep text-meta leading-relaxed text-faint">유료 구독이 처음 시작될 때 한 번 전달돼요. 무료 팔로우 · 플랜 변경 · 갱신에는 보내지 않아요.</p>
      </div>
    </main>
  );
}
