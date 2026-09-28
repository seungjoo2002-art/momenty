/**
 * SafeShare Scanner — 사진을 올리기 전에 브라우저 안에서만 확인한다 (외부 서버 · AI로 보내지 않는다).
 *
 *   사진 선택 → 줄이기(EXIF 제거) → scanImage() → 크리에이터 확인(가리기 · 다시 선택 · 그대로 사용) → 편집본만 업로드
 *
 * 검사 능력은 환경마다 다르다. 할 수 없는 검사는 "했다"고 말하지 않는다 (capabilities로 그대로 알린다):
 *   metadata  항상 (removed)
 *   codes     QR · 바코드 — 브라우저 BarcodeDetector가 있을 때만
 *   text      글자(OCR) — TextRecognizer가 주어졌을 때만. 기본값은 없음(unavailable).
 *             OCR 엔진은 이 인터페이스로 꽂는다 (예: 브라우저 TextDetector, 필요할 때 불러오는 WASM OCR).
 * 결과(scan result)는 저장하지 않는다. 글자 원문은 detectors가 종류로 바꾼 즉시 버린다.
 */
import { detectTextRisks, riskLevelOf, type Box, type Finding, type RiskLevel } from "./detectors";

export type Capability = "checked" | "unavailable";

export interface SafeShareResult {
  level: RiskLevel;
  findings: Finding[];
  capabilities: { metadata: "removed"; codes: Capability; text: Capability };
  /** 결과 형식 버전 (저장이 필요해지면 종류 · 버전만) */
  version: 1;
}

/** 검사할 사진 — canvas (Tesseract · BarcodeDetector 모두 받는다) */
export type ScanImage = HTMLCanvasElement;

export interface TextRegion {
  text: string;
  box?: Box;
}
export interface TextRecognizer {
  readonly id: string;
  recognize(image: ScanImage): Promise<TextRegion[]>;
}
export interface CodeDetector {
  readonly id: string;
  detect(image: ScanImage): Promise<{ format: string; box?: Box }[]>;
}

/** 글자 영역 → 발견 (글자는 여기서 버린다) */
export function findingsFromText(regions: TextRegion[]): Finding[] {
  return regions.flatMap((r) => detectTextRisks(r.text).map((category) => ({ category, ...(r.box ? { box: r.box } : {}) })));
}

export async function scanImage(image: ScanImage, deps: { text?: TextRecognizer | null; codes?: CodeDetector | null }): Promise<SafeShareResult> {
  const findings: Finding[] = [];
  let codes: Capability = "unavailable";
  let text: Capability = "unavailable";
  if (deps.codes) {
    try {
      const found = await deps.codes.detect(image);
      for (const c of found) findings.push({ category: c.format === "qr_code" ? "QR_CODE" : "BARCODE", ...(c.box ? { box: c.box } : {}) });
      codes = "checked";
    } catch {
      codes = "unavailable";
    }
  }
  if (deps.text) {
    try {
      findings.push(...findingsFromText(await deps.text.recognize(image)));
      text = "checked";
    } catch {
      text = "unavailable";
    }
  }
  return { level: riskLevelOf(findings), findings, capabilities: { metadata: "removed", codes, text }, version: 1 };
}

/* ---------- 브라우저가 기본으로 제공하는 검사기 (있을 때만) ---------- */

interface NativeBarcodeDetector {
  detect(image: ScanImage): Promise<{ format: string; boundingBox: DOMRectReadOnly }[]>;
}
interface NativeTextDetector {
  detect(image: ScanImage): Promise<{ rawValue: string; boundingBox: DOMRectReadOnly }[]>;
}
const toBox = (r: DOMRectReadOnly): Box => ({ x: r.x, y: r.y, width: r.width, height: r.height });

/** Chrome(Android · macOS · ChromeOS 등)의 BarcodeDetector. 없으면 null */
export function browserCodeDetector(): CodeDetector | null {
  const Ctor = (globalThis as { BarcodeDetector?: new (o?: { formats?: string[] }) => NativeBarcodeDetector }).BarcodeDetector;
  if (!Ctor) return null;
  const detector = new Ctor();
  return { id: "native-barcode", detect: async (img) => (await detector.detect(img)).map((d) => ({ format: d.format, box: toBox(d.boundingBox) })) };
}

/** 브라우저 TextDetector(실험 기능 — 대부분 꺼져 있다). 없으면 null */
export function browserTextRecognizer(): TextRecognizer | null {
  const Ctor = (globalThis as { TextDetector?: new () => NativeTextDetector }).TextDetector;
  if (!Ctor) return null;
  const detector = new Ctor();
  return { id: "native-text", recognize: async (img) => (await detector.detect(img)).map((d) => ({ text: d.rawValue, box: toBox(d.boundingBox) })) };
}

/** 화면 문구 — LOW는 "안전합니다"가 아니다 */
export function levelMessage(r: SafeShareResult): string {
  if (r.level === "HIGH") return "공유하기 전에 한 번 확인해 주세요.";
  if (r.level === "MEDIUM") return "위치나 개인정보를 짐작할 수 있는 것이 있을 수 있어요.";
  const limited = r.capabilities.text === "unavailable";
  return limited
    ? "위치 정보(EXIF)는 지웠어요. 사진 속 글자는 이 기기에서 자동으로 확인하지 못해요 — 주소 · 번호판 · 명찰이 보이지 않는지 한 번 봐 주세요."
    : "자동 검사에서 뚜렷한 위험요소를 찾지 못했어요. 자동 검사가 놓칠 수 있으니 한 번 더 봐 주세요.";
}
