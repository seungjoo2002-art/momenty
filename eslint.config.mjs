import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Mock 단계에서는 외부 placeholder 이미지를 <img>로 렌더링한다.
      // Supabase Storage 연결 시 next/image + remotePatterns로 교체.
      "@next/next/no-img-element": "off",
    },
  },
  // public/ocr: Tesseract.js 배포 파일 (scripts/copy-ocr-assets.mjs가 복사하는 외부 빌드 결과물)
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "public/ocr/**"]),
]);

export default eslintConfig;
