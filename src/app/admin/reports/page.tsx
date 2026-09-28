"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { LoadError, LoadingBlock } from "@/components/ui/LoadState";
import { PageHeader, Segmented } from "@/components/ui/primitives";
import { useMomentData } from "@/lib/hooks/useMomentData";
import { listReports, updateReport, type AdminReport, type ReportStatus } from "@/lib/services/admin";
import { REPORT_REASONS } from "@/lib/services/safety";
import { formatShortDate, formatClock } from "@/lib/utils/format";

const STATUS_LABEL: Record<ReportStatus, string> = { open: "접수", reviewing: "검토 중", resolved: "처리됨", dismissed: "기각" };
const reasonLabel = (r: string) => REPORT_REASONS.find((x) => x.value === r)?.label ?? r;

/** 신고 처리 (운영) — layout이 서버에서 admin만 들여보낸다 */
export default function AdminReportsPage() {
  const [status, setStatus] = useState<ReportStatus | "all">("open");
  const { data, error, retry } = useMomentData(`admin-reports:${status}`, () => listReports(status));
  return (
    <main className="animate-fade-in pb-12">
      <PageHeader title="신고 처리" caption="운영 전용 · 신고자 정보는 여기에서만 보여요" />
      <div className="px-5">
        <Segmented<ReportStatus | "all">
          value={status}
          onChange={setStatus}
          options={[
            { value: "open", label: "접수" },
            { value: "reviewing", label: "검토 중" },
            { value: "resolved", label: "처리됨" },
            { value: "dismissed", label: "기각" },
            { value: "all", label: "전체" },
          ]}
        />
      </div>
      {error && !data && <LoadError message={error} onRetry={retry} />}
      {!data && !error && <LoadingBlock />}
      {data && data.length === 0 && <p className="px-5 pt-10 text-center text-sub text-muted">이 상태의 신고가 없어요.</p>}
      <ul className="mt-4 divide-y divide-line border-y border-line">
        {data?.map((r) => (
          <ReportItem key={r.id} report={r} onChanged={retry} />
        ))}
      </ul>
    </main>
  );
}

function ReportItem({ report, onChanged }: { report: AdminReport; onChanged: () => void }) {
  const [note, setNote] = useState(report.resolutionNote);
  const [busy, setBusy] = useState<ReportStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function set(next: ReportStatus) {
    setBusy(next);
    setErr(null);
    try {
      await updateReport(report.id, next, note);
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "바꾸지 못했어요.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="px-5 py-4" aria-label={`신고 ${reasonLabel(report.reason)}`}>
      <div className="flex items-center gap-2 text-meta">
        <span className="rounded-full bg-brand-tint px-2 py-0.5 font-medium text-brand-deep">{STATUS_LABEL[report.status]}</span>
        <span className="font-medium text-ink">{reasonLabel(report.reason)}</span>
        <span className="ml-auto text-faint">
          {formatShortDate(report.createdAt)} {formatClock(report.createdAt)}
        </span>
      </div>
      <blockquote className="mt-2 rounded-tile bg-surface px-3 py-2 text-sub text-ink ring-1 ring-line ring-inset">{report.messageSnapshot || "(메시지 원문 없음)"}</blockquote>
      {report.detail && <p className="mt-1.5 text-caption text-ink-2">신고 내용: {report.detail}</p>}
      <p className="mt-1.5 text-meta text-muted">
        신고한 사람 {report.reporter?.nickname ?? "(탈퇴한 사용자)"} · 신고된 사람 {report.reportedUser?.nickname ?? "(탈퇴한 사용자)"}
      </p>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        rows={1}
        aria-label="처리 메모"
        placeholder="처리 메모 (운영자만 봐요)"
        className="mt-2 w-full resize-none rounded-tile border border-line-strong bg-surface px-3 py-2 text-caption outline-none focus:border-brand"
      />
      <div className="mt-2 flex flex-wrap gap-3 text-meta">
        {(["reviewing", "resolved", "dismissed", "open"] as ReportStatus[])
          .filter((s) => s !== report.status)
          .map((s) => (
            <button key={s} type="button" disabled={!!busy} onClick={() => set(s)} className="font-semibold text-brand disabled:opacity-50">
              {busy === s ? <Loader2 className="inline size-3.5 animate-spin" /> : null} {STATUS_LABEL[s]}으로
            </button>
          ))}
      </div>
      {err && <p className="mt-1 text-caption text-danger">{err}</p>}
    </li>
  );
}
