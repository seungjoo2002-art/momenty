"use client";

import { Loader2, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { RISK_LABEL, type Box, type RiskCategory } from "@/lib/safeshare/detectors";
import { canvasToJpeg, loadCanvas, padBox, pixelateRegions } from "@/lib/safeshare/imageEdit";
import { browserCodeDetector, levelMessage, scanImage, type SafeShareResult } from "@/lib/safeshare/scanner";
import type { DraftMedia } from "@/lib/services/drafts";
import { resizeImage } from "@/lib/utils/image";

export type SafeShareGate = "checking" | "needs_review" | "ok";

/**
 * SafeShare — 공유하기 전에 한 번 확인. 검열이 아니라 알림이고, 공개 여부는 크리에이터가 정한다.
 *
 *   사진  줄이기(EXIF 제거) → 기기 안 OCR(한국어 · 영어) + QR/바코드(지원 기기) → 위험 종류만 남기고 글자는 버린다
 *         LOW       한 줄 안내 (과한 확인 창 없음 · "안전합니다"라고 하지 않음)
 *         MEDIUM/HIGH  찾은 곳 표시 · [가리기] · [사진 다시 선택] · [그래도 사용] — 고르기 전에는 공개 버튼이 잠긴다
 *         검사 실패 · 시간 초과 · 미지원  "확인하지 못했어요" + 직접 확인 안내 (안전하다고 하지 않음)
 *   영상 · 음성  위치 metadata 처리 결과만 정직하게 안내
 * 검사 결과는 저장하지 않는다. 가리면 편집한 사진만 올라간다 (원본은 이 기기에만).
 */
export function SafeShareReview({ media, onMedia, onGate }: { media: DraftMedia; onMedia: (m: DraftMedia) => void; onGate: (g: SafeShareGate) => void }) {
  if (media.type === "photo") return <PhotoReview media={media} onMedia={onMedia} onGate={onGate} />;
  return <MediaNote media={media} onGate={onGate} />;
}

function PhotoReview({ media, onMedia, onGate }: { media: DraftMedia; onMedia: (m: DraftMedia) => void; onGate: (g: SafeShareGate) => void }) {
  const router = useRouter();
  const [state, setState] = useState<{ result: SafeShareResult; base: HTMLCanvasElement } | "checking" | "error">("checking");
  const [decision, setDecision] = useState<"blurred" | "accepted" | null>(media.safeShareEdited ? "blurred" : null);
  const [blurring, setBlurring] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current || media.safeShareEdited) return;
    started.current = true;
    onGate("checking");
    void (async () => {
      try {
        // 올릴 때와 같은 처리(1600px JPEG · EXIF 없음)로 만든 사진을 검사한다
        const resized = await resizeImage(media.file, 1600, 0.9);
        const base = await loadCanvas(resized);
        const { tesseractRecognizer } = await import("@/lib/safeshare/ocr");
        const result = await scanImage(base, { text: tesseractRecognizer(), codes: browserCodeDetector() });
        setState({ result, base });
        onGate(result.level === "LOW" ? "ok" : "needs_review");
      } catch {
        setState("error");
        onGate("ok");
      }
    })();
  }, [media, onGate]);

  if (media.safeShareEdited && decision === "blurred") {
    return (
      <Row>
        <span className="font-medium text-brand-deep">SafeShare</span> · 찾은 곳을 가린 사진으로 올려요. 원본은 이 기기에만 있어요.
      </Row>
    );
  }
  if (state === "checking") {
    return (
      <Row>
        <Loader2 className="size-3.5 shrink-0 animate-spin text-brand" />
        <span>
          <span className="font-medium text-brand-deep">SafeShare</span> · 공유하기 전에 사진을 확인하고 있어요 (기기 안에서만)
        </span>
      </Row>
    );
  }
  if (state === "error") {
    return (
      <Row>
        <span className="font-medium text-brand-deep">SafeShare</span> · 위치 정보(EXIF)는 지웠어요. 사진 속 글자는 이번에 확인하지 못했어요 — 주소 · 번호판 · 명찰이
        보이지 않는지 한 번 봐 주세요.
      </Row>
    );
  }

  const { result, base } = state;
  if (result.level === "LOW" || decision === "accepted") {
    return (
      <Row>
        <span className="font-medium text-brand-deep">SafeShare</span> · {decision === "accepted" ? "확인하고 그대로 올려요." : levelMessage(result)}
      </Row>
    );
  }

  const boxes = result.findings.flatMap((f) => (f.box ? [f.box] : []));
  const labels = [...new Set(result.findings.map((f) => f.category))] as RiskCategory[];

  async function blur() {
    setBlurring(true);
    try {
      const edited = pixelateRegions(base, boxes);
      const blob = await canvasToJpeg(edited);
      onMedia({ ...media, file: blob, previewUrl: URL.createObjectURL(blob), safeShareEdited: true });
      setDecision("blurred");
      onGate("ok");
    } finally {
      setBlurring(false);
    }
  }

  return (
    <section className="rounded-card border border-brand/20 bg-brand-tint p-4" aria-label="SafeShare 확인">
      <div className="flex items-center gap-1.5">
        <ShieldCheck className="size-4 text-brand" />
        <p className="text-sub font-semibold">SafeShare</p>
      </div>
      <p className="mt-1 text-caption text-ink-2">{levelMessage(result)}</p>
      <ul className="mt-2 space-y-0.5">
        {labels.map((c) => (
          <li key={c} className="text-caption text-ink">
            · {RISK_LABEL[c]}
          </li>
        ))}
      </ul>
      {boxes.length > 0 && <MarkedImage base={base} boxes={boxes} />}
      <p className="mt-2 break-keep text-meta text-muted">자동 검사는 틀리거나 놓칠 수 있어요. 올릴지는 직접 정해 주세요.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {boxes.length > 0 && (
          <Button size="sm" onClick={blur} disabled={blurring}>
            {blurring && <Loader2 className="size-4 animate-spin" />}
            가리기
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => router.push("/studio/record")}>
          사진 다시 선택
        </Button>
        <Button
          size="sm"
          variant="soft"
          onClick={() => {
            setDecision("accepted");
            onGate("ok");
          }}
        >
          그래도 사용
        </Button>
      </div>
    </section>
  );
}

/** 찾은 곳을 사진 위에 테두리로 (가리기 전 확인용) */
function MarkedImage({ base, boxes }: { base: HTMLCanvasElement; boxes: Box[] }) {
  const [url] = useState(() => base.toDataURL("image/jpeg", 0.7));
  return (
    <div className="relative mt-3 overflow-hidden rounded-tile">
      <img src={url} alt="SafeShare가 찾은 곳" className="block w-full" />
      {boxes.map((raw, i) => {
        const b = padBox(raw, base.width, base.height);
        return (
          <span
            key={i}
            aria-hidden
            className="absolute rounded-sm ring-2 ring-brand"
            style={{ left: `${(b.x / base.width) * 100}%`, top: `${(b.y / base.height) * 100}%`, width: `${(b.width / base.width) * 100}%`, height: `${(b.height / base.height) * 100}%` }}
          />
        );
      })}
    </div>
  );
}

/** 영상 · 음성: 위치 metadata 처리 결과만 정직하게 */
function MediaNote({ media, onGate }: { media: DraftMedia; onGate: (g: SafeShareGate) => void }) {
  useEffect(() => onGate("ok"), [onGate]);
  const type = media.file.type.split(";")[0];
  const text =
    media.type === "voice" && media.recordedInApp
      ? "앱에서 녹음한 음성이라 위치 정보가 들어 있지 않아요."
      : ["video/mp4", "video/quicktime", "audio/mp4", "audio/x-m4a", "audio/mpeg"].includes(type)
        ? `${media.type === "video" ? "영상" : "음성"} 파일 속 위치 · 기기 정보는 지우고 올려요. 화면에 보이는 주소나 번호판은 직접 확인해 주세요.`
        : `이 형식은 파일 속 위치 정보가 있는지 확인하지 못해요. 다른 곳에서 가져온 ${media.type === "video" ? "영상" : "음성"}이면 한 번 확인해 주세요.`;
  return (
    <Row>
      <span className="font-medium text-brand-deep">SafeShare</span> · {text}
    </Row>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <p className="flex items-start gap-1.5 break-keep text-caption leading-relaxed text-muted">{children}</p>;
}
