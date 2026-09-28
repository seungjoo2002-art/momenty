/**
 * SafeShare 사진 편집 — 브라우저 canvas에서만. 원본은 어디에도 올리지 않고, 편집한 결과(JPEG)만 올린다.
 *
 * 가리기는 되돌릴 수 없는 모자이크: 영역을 아주 작게 줄였다가 계단 모양으로 다시 키운다.
 * 블록 크기는 영역 높이의 절반 이상 — 글자 한 줄이 몇 칸으로 뭉개져 읽을 수 없다.
 */
import type { Box } from "./detectors";

export function loadCanvas(blob: Blob): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve(c);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("이미지를 읽을 수 없어요"));
    };
    img.src = url;
  });
}

/** 영역을 조금 넓혀서(글자 가장자리까지) 이미지 안으로 자른다 */
export function padBox(b: Box, w: number, h: number, pad = 0.15): Box {
  const px = Math.max(4, b.width * pad);
  const py = Math.max(4, b.height * pad * 2);
  const x = Math.max(0, Math.floor(b.x - px));
  const y = Math.max(0, Math.floor(b.y - py));
  return { x, y, width: Math.min(w - x, Math.ceil(b.width + px * 2)), height: Math.min(h - y, Math.ceil(b.height + py * 2)) };
}

/** 영역들을 모자이크한 새 canvas (원본 canvas는 그대로) */
export function pixelateRegions(src: HTMLCanvasElement, boxes: Box[]): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d")!;
  ctx.drawImage(src, 0, 0);
  const tmp = document.createElement("canvas");
  const tctx = tmp.getContext("2d")!;
  for (const raw of boxes) {
    const b = padBox(raw, src.width, src.height);
    if (b.width < 1 || b.height < 1) continue;
    const block = Math.max(12, Math.round(Math.min(b.width, b.height) / 2));
    tmp.width = Math.max(1, Math.ceil(b.width / block));
    tmp.height = Math.max(1, Math.ceil(b.height / block));
    tctx.imageSmoothingEnabled = true;
    tctx.drawImage(out, b.x, b.y, b.width, b.height, 0, 0, tmp.width, tmp.height);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tmp, 0, 0, tmp.width, tmp.height, b.x, b.y, b.width, b.height);
  }
  return out;
}

export function canvasToJpeg(c: HTMLCanvasElement, quality = 0.88): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error("이미지를 만들 수 없어요"))), "image/jpeg", quality));
}
