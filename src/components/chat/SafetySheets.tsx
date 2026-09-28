"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { REPORT_REASONS, reportHumanMessage, type ReportReason } from "@/lib/services/safety";

/** 받은 Human 메시지 신고 — 사유 선택. 신고 내용은 신고한 사람만 볼 수 있다 (상대방에게 알리지 않음) */
export function ReportSheet({ messageId, onClose, onDone }: { messageId: string | null; onClose: () => void; onDone: (id: string) => void }) {
  const [busy, setBusy] = useState<ReportReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function report(reason: ReportReason) {
    if (!messageId) return;
    setBusy(reason);
    setError(null);
    try {
      await reportHumanMessage(messageId, reason);
      onDone(messageId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "신고하지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <BottomSheet open={!!messageId} onClose={onClose} title="메시지 신고">
      <p className="mb-3 break-keep text-caption text-muted">신고한 내용은 상대에게 알리지 않아요. 운영팀이 확인해요.</p>
      <div className="divide-y divide-line">
        {REPORT_REASONS.map((r) => (
          <button key={r.value} type="button" disabled={!!busy} onClick={() => report(r.value)} className="flex w-full items-center py-3 text-left text-sub disabled:opacity-50">
            {busy === r.value ? "신고하는 중…" : r.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}
    </BottomSheet>
  );
}

/** 차단 / 차단 해제 확인 */
export function BlockSheet({
  open,
  onClose,
  name,
  blocked,
  effect,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  blocked: boolean;
  /** 차단하면 무엇이 멈추는지 */
  effect: string;
  onConfirm: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <BottomSheet open={open} onClose={onClose} title={blocked ? `${name} 차단 해제` : `${name} 차단`}>
      <p className="break-keep text-caption leading-relaxed text-muted">{blocked ? "차단을 풀면 다시 직접 메시지를 주고받을 수 있어요." : effect}</p>
      {error && (
        <p role="alert" className="mt-2 text-caption text-danger">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <Button variant="soft" className="flex-1" onClick={onClose}>
          취소
        </Button>
        <Button className="flex-1" onClick={confirm} disabled={busy}>
          {busy ? "처리 중…" : blocked ? "차단 해제" : "차단하기"}
        </Button>
      </div>
    </BottomSheet>
  );
}
