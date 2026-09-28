/**
 * SafeShare OCR(Tesseract.js) 파일을 public/ocr 로 복사한다 — 외부 CDN 없이 같은 origin에서만 불러오기 위해.
 * predev · prebuild에서 실행된다 (배포 빌드에서도 같은 파일이 생긴다). public/ocr 는 git에 넣지 않는다.
 *
 *   public/ocr/worker.min.js        tesseract.js worker
 *   public/ocr/core/*-lstm.wasm.js  LSTM 전용 코어 3종 (기기 지원에 따라 하나만 내려받는다: relaxed-simd · simd · 기본)
 *   public/ocr/lang/{kor,eng}.traineddata.gz   best_int 언어 데이터
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// fileURLToPath: 경로에 한글 등이 있어도 올바르게 (URL pathname은 %인코딩된다)
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "public", "ocr");
const pkg = (name) => dirname(require.resolve(`${name}/package.json`));

const files = [
  [join(pkg("tesseract.js"), "dist", "worker.min.js"), join(out, "worker.min.js")],
  ...["tesseract-core-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-relaxedsimd-lstm.wasm.js"].map((f) => [join(pkg("tesseract.js-core"), f), join(out, "core", f)]),
  [join(pkg("@tesseract.js-data/kor"), "4.0.0_best_int", "kor.traineddata.gz"), join(out, "lang", "kor.traineddata.gz")],
  [join(pkg("@tesseract.js-data/eng"), "4.0.0_best_int", "eng.traineddata.gz"), join(out, "lang", "eng.traineddata.gz")],
];
for (const [from, to] of files) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}
console.log(`[ocr] ${files.length}개 파일 → public/ocr`);
