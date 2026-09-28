/**
 * SafeShare OCR — Tesseract.js (브라우저 안 WASM). 사진은 기기 밖으로 나가지 않는다.
 *
 * · 크리에이터가 SafeShare 검사를 실제로 쓸 때만 불러온다 (dynamic import — 앱 첫 화면 번들에 없다).
 * · worker · WASM 코어 · 한국어/영어 언어 데이터는 모두 이 앱의 /ocr/ 에서 (scripts/copy-ocr-assets.mjs) — 외부 CDN 없음.
 * · OCR용 이미지는 긴 변 1280px로 줄인다 (모바일 메모리 · 속도). 찾은 위치는 원래 크기로 되돌려 준다.
 * · 읽은 글자는 여기서 반환만 한다 — 호출한 scanner가 즉시 위험 종류로 바꾸고 버린다. console · 저장 · 전송 없음.
 * · 첫 실행은 언어 데이터를 내려받느라 느릴 수 있다 → 시간 제한. 넘으면 실패로 처리(= "확인하지 못함", 안전하다고 하지 않음).
 */
import type { Box } from "./detectors";
import type { ScanImage, TextRecognizer, TextRegion } from "./scanner";

const OCR_MAX_SIDE = 1280;
const TIMEOUT_MS = 60_000;

function downscale(src: HTMLCanvasElement, scale: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(src.width * scale));
  c.height = Math.max(1, Math.round(src.height * scale));
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function tesseractRecognizer(timeoutMs = TIMEOUT_MS): TextRecognizer {
  return {
    id: "tesseract-kor-eng",
    async recognize(image: ScanImage): Promise<TextRegion[]> {
      const { createWorker } = await import("tesseract.js");
      const origin = window.location.origin;
      const scale = Math.min(1, OCR_MAX_SIDE / Math.max(image.width, image.height));
      const input = scale < 1 ? downscale(image, scale) : image;
      const toBox = (b: BBox): Box => ({ x: b.x0 / scale, y: b.y0 / scale, width: (b.x1 - b.x0) / scale, height: (b.y1 - b.y0) / scale });

      let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const job = (async () => {
        worker = await createWorker(["kor", "eng"], 1, {
          workerPath: `${origin}/ocr/worker.min.js`,
          corePath: `${origin}/ocr/core`,
          langPath: `${origin}/ocr/lang`,
          gzip: true,
        });
        const { data } = await worker.recognize(input, {}, { blocks: true, text: false });
        const regions: TextRegion[] = [];
        for (const block of data.blocks ?? []) {
          // 블록 전체 (두 줄에 걸친 주소 등) + 줄 단위 (정확한 위치)
          regions.push({ text: block.text, box: toBox(block.bbox) });
          for (const p of block.paragraphs) for (const l of p.lines) regions.push({ text: l.text, box: toBox(l.bbox) });
        }
        return regions;
      })();
      try {
        return await Promise.race([
          job,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("ocr_timeout")), timeoutMs);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        // 메모리 정리 (모바일) — 다음 사진은 캐시된 언어 데이터로 다시 빠르게 만든다
        await (worker as { terminate(): Promise<unknown> } | null)?.terminate().catch(() => {});
      }
    },
  };
}
