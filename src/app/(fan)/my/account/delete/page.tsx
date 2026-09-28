"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { useAccount } from "@/components/auth/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { TopBar } from "@/components/ui/TopBar";
import { DELETE_CONFIRM_PHRASE, deleteMyAccount } from "@/lib/services/account";

/** 계정 삭제 — 무엇이 지워지고 무엇이 남는지 먼저 보여주고, 확인 문구 + 비밀번호로 한 번 더 확인한다 */
export default function DeleteAccountPage() {
  const account = useAccount();
  const [step, setStep] = useState<"info" | "confirm">("info");
  const [phrase, setPhrase] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount(password, phrase.trim());
      // 세션이 사라졌으니 화면 상태까지 새로 (뒤로 가기로 돌아오지 않게)
      window.location.replace("/login?deleted=1");
    } catch (ex) {
      setError(ex instanceof Error ? ex.message : "지금은 삭제하지 못했어요.");
      setBusy(false);
    }
  }

  return (
    <main className="animate-fade-in pb-10">
      <TopBar backHref="/my" title="계정 삭제" center />
      <div className="px-5 pt-3 break-keep">
        <p className="text-sub font-semibold">계정을 삭제하면 되돌릴 수 없어요.</p>
        <p className="mt-3 text-caption font-medium text-ink-2">바로 지워지는 것</p>
        <ul className="mt-1 space-y-0.5 text-caption leading-relaxed text-muted">
          <li>· 프로필 · 구독 · 반응 · 보관함</li>
          <li>· Creator AI 대화 · AI Memory · 크리에이터에게 공유한 정보</li>
          <li>· 직접 메시지 대화 · 차단 목록</li>
          {account?.creator && <li>· 내 채널 · 모든 Moment와 올린 사진 · 영상 · 음성 파일 · Creator AI 설정 · 팬 메모</li>}
        </ul>
        <p className="mt-3 text-caption font-medium text-ink-2">남는 것</p>
        <p className="mt-1 text-caption leading-relaxed text-muted">
          내가 한 신고는 운영 검토를 위해 신고자 정보 없이 남아요. 다른 사람이 나를 신고한 기록도 계정과의 연결 없이 운영 검토용으로 남아요.
        </p>

        {step === "info" ? (
          <Button variant="secondary" className="mt-6" block onClick={() => setStep("confirm")}>
            계속하기
          </Button>
        ) : (
          <form onSubmit={submit} className="mt-6 space-y-3">
            <Field label={`확인을 위해 "${DELETE_CONFIRM_PHRASE}"라고 입력해 주세요`} value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" />
            <Field label="비밀번호" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            {error && (
              <p role="alert" className="text-caption text-danger">
                {error}
              </p>
            )}
            <Button type="submit" block className="bg-danger hover:bg-danger/90" disabled={busy || phrase.trim() !== DELETE_CONFIRM_PHRASE || !password}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              계정 영구 삭제
            </Button>
          </form>
        )}
      </div>
    </main>
  );
}
