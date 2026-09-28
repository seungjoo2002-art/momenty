/**
 * SafeShare 단위 테스트 (브라우저 · DB · LLM 없이) — npm run test:unit
 *
 *  A  GPS가 든 JPEG → metadata 제거 → EXIF · GPS 없음
 *  B  원래 파일 이름: Storage 경로 · 업로드 본문(Blob)에 남지 않음
 *  W  글자 검사 결과에 글자 원문이 남지 않음 (종류 · 위치만)
 *  +  MP4/MOV(iPhone 위치 ©xyz · ISO6709) · M4A · MP3 ID3 제거, 크기 · 재생 구조 보존
 *  +  위험 패턴(전화 · 주소 · 번호판 …)과 흔한 말 오탐, LOW 문구는 "안전"이 아님
 *  +  로그인 next open redirect 방지
 */
import { safeNext } from "../../src/lib/utils/safeNext";
import { detectTextRisks, riskLevelOf } from "../../src/lib/safeshare/detectors";
import { jpegExifInfo, neutralizeIsoBmffMetadata, sanitizeMediaBlob, stripId3, stripJpegMetadata } from "../../src/lib/safeshare/metadata";
import { findingsFromText, levelMessage, scanImage, type TextRecognizer } from "../../src/lib/safeshare/scanner";
import { newPath } from "../../src/lib/services/media";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) passed++;
  else failed++;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !d ? "" : `  → ${d}`}`);
};
const enc = new TextEncoder();
const cat = (...parts: (number[] | Uint8Array)[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const has = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(Buffer.from(text));

/* ---------- JPEG fixture: SOI · APP0(JFIF) · APP1(EXIF + GPS IFD 0x8825) · COM · DQT · SOS · 데이터 · EOI ---------- */
const seg = (marker: number, payload: Uint8Array | number[]) => cat([0xff, marker, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff], payload);
const exifPayload = cat(enc.encode("Exif\0\0"), enc.encode("II*\0"), [8, 0, 0, 0], [1, 0], [0x25, 0x88, 4, 0, 1, 0, 0, 0, 26, 0, 0, 0], [0, 0, 0, 0], enc.encode("GPS 37.5665N 126.9780E iPhone 15 Pro"));
const scanData = [0x12, 0x34, 0x56, 0x78, 0xff, 0x00, 0x9a];
const jpeg = cat([0xff, 0xd8], seg(0xe0, cat(enc.encode("JFIF\0"), [1, 1, 0, 0, 1, 0, 1, 0, 0])), seg(0xe1, exifPayload), seg(0xfe, enc.encode("taken at home")), seg(0xdb, new Array(65).fill(1)), seg(0xda, [3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0]), scanData, [0xff, 0xd9]);

console.log("A · 사진 metadata");
{
  const before = jpegExifInfo(jpeg);
  check("fixture: EXIF + GPS가 들어 있음", before.exif && before.gps && has(jpeg, "37.5665"));
  const { bytes, removed } = stripJpegMetadata(jpeg);
  const after = jpegExifInfo(bytes);
  check("A. 제거 후 EXIF · GPS 없음 · 좌표 · 기기 문자열 없음", !after.exif && !after.gps && !has(bytes, "37.5665") && !has(bytes, "iPhone"), { after, removed });
  check("주석(COM)도 제거", !has(bytes, "taken at home") && removed.includes("COMMENT"));
  check("JFIF · DQT · 스캔 데이터는 그대로 (이미지 손상 없음)", has(bytes, "JFIF") && Buffer.from(bytes).includes(Buffer.from(scanData)) && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes.at(-1) === 0xd9);
}

/* ---------- MP4/MOV fixture ---------- */
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const box = (type: string, payload: Uint8Array | number[]) => cat(u32(payload.length + 8), enc.encode(type), payload);
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];
const mvhd = box("mvhd", new Array(100).fill(7));
const mdatPayload = new Array(64).fill(0).map((_, i) => i);
const mov = cat(
  box("ftyp", cat(enc.encode("qt  "), [0, 0, 0, 0], enc.encode("qt  "))),
  box("uuid", cat(XMP_UUID, enc.encode("<x:xmpmeta><exif:GPSLatitude>37.5665</exif:GPSLatitude></x:xmpmeta>"))),
  box(
    "moov",
    cat(
      mvhd,
      box("udta", box("©xyz", cat([0, 18, 0x15, 0xc7], enc.encode("+37.5665+126.9780/")))),
      box("meta", cat([0, 0, 0, 0], box("keys", enc.encode("mdtacom.apple.quicktime.location.ISO6709")), box("ilst", enc.encode("+37.5665+126.9780+012.000/")))),
      box("trak", cat(box("tkhd", new Array(84).fill(2)), box("udta", box("name", enc.encode("My Home Video"))))),
    ),
  ),
  box("mdat", mdatPayload),
);

console.log("\n영상 · 음성 metadata (MP4 · MOV · M4A · MP3)");
{
  check("fixture: 위치(©xyz · ISO6709 · XMP GPS)가 들어 있음", has(mov, "+37.5665") && has(mov, "ISO6709") && has(mov, "xmpmeta"));
  const { bytes, removed } = neutralizeIsoBmffMetadata(mov);
  check("MOV: 위치 · 사용자 데이터 · XMP 문자열 모두 없음", !has(bytes, "37.5665") && !has(bytes, "ISO6709") && !has(bytes, "xmpmeta") && !has(bytes, "My Home Video"), removed);
  check("MOV: 파일 길이 그대로 (chunk offset이 어긋나지 않음)", bytes.length === mov.length);
  check("MOV: ftyp · mvhd · tkhd · mdat 바이트는 그대로", has(bytes, "ftyp") && Buffer.from(bytes).includes(Buffer.from(mvhd)) && Buffer.from(bytes).includes(Buffer.from(box("mdat", mdatPayload))));
  check("MOV: 지운 자리는 'free' 박스", has(bytes, "free") && removed.includes("USER_DATA") && removed.includes("META") && removed.includes("XMP"));
  check("원본 배열은 바꾸지 않음 (복사본)", has(mov, "+37.5665"));
  // 64비트 크기 mdat
  const big = cat(box("ftyp", enc.encode("isom\0\0\0\0isom")), box("moov", cat(mvhd, box("udta", enc.encode("LOC+37.1+127.1")))), cat(u32(1), enc.encode("mdat"), u32(0), u32(16 + 8), [1, 2, 3, 4, 5, 6, 7, 8]));
  const r2 = neutralizeIsoBmffMetadata(big);
  check("64비트 크기 박스가 있어도 처리", !has(r2.bytes, "LOC+37.1") && r2.bytes.length === big.length);

  const id3 = cat(enc.encode("ID3"), [3, 0, 0], [0, 0, 0, 20], enc.encode("TXXXlocation=Seongsu"), [0xff, 0xfb, 0x90, 0x44, 1, 2, 3, 4], cat(enc.encode("TAG"), enc.encode("title from home".padEnd(125, "\0"))));
  const r3 = stripId3(id3);
  check("MP3: ID3v2 · ID3v1 제거 · 오디오 프레임은 그대로", !has(r3.bytes, "location") && !has(r3.bytes, "TAG") && r3.bytes[0] === 0xff && r3.bytes[1] === 0xfb && r3.removed.length === 2, r3.removed);
}

console.log("\nB · 파일 이름 · sanitize 결과");
{
  const file = new File([jpeg as BlobPart], "IMG_2041_home_address.jpg", { type: "image/jpeg" });
  const out = await sanitizeMediaBlob(file, "image");
  check("B. 결과는 이름 없는 Blob (File 아님)", !(out.blob instanceof File) && out.report.outcome === "removed");
  check("A. sanitize 경로로도 GPS 없음", !jpegExifInfo(new Uint8Array(await out.blob.arrayBuffer())).gps);
  const p = newPath("c1", "image/jpeg");
  check("B. Storage 경로 = {폴더}/{uuid}.jpg (원래 이름 없음)", /^c1\/[0-9a-f-]{36}\.jpg$/.test(p) && !p.includes("IMG_2041"), p);
  const movOut = await sanitizeMediaBlob(new File([mov as BlobPart], "home.mov", { type: "video/quicktime" }), "video");
  check("영상 sanitize → removed", movOut.report.outcome === "removed" && !(movOut.blob instanceof File));
  const webm = await sanitizeMediaBlob(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2])], { type: "video/webm" }), "video");
  check("WebM(가져온 파일): 확인 못 함을 정직하게 (unverified — '제거됨'이라 하지 않음)", webm.report.outcome === "unverified");
  const rec = await sanitizeMediaBlob(new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: "audio/webm;codecs=opus" }), "audio", { recordedInApp: true });
  check("앱에서 녹음한 음성: 위치 정보 없음 (none_found)", rec.report.outcome === "none_found");
}

console.log("\n위험 패턴 (글자 → 종류)");
{
  const yes: [string, string][] = [
    ["010-1234-5678", "PHONE_NUMBER"], ["02-123-4567", "PHONE_NUMBER"], ["+82 10 1234 5678", "PHONE_NUMBER"],
    ["hello.me@gmail.com", "EMAIL"],
    ["서울 마포구 월드컵로 123", "POSSIBLE_ADDRESS"], ["성수이로 113", "POSSIBLE_ADDRESS"], ["테헤란로 152-3", "POSSIBLE_ADDRESS"], ["역삼동 123-45", "POSSIBLE_ADDRESS"],
    ["101동 1203호", "UNIT_NUMBER"],
    ["12가 3456", "CAR_PLATE"], ["123가4567", "CAR_PLATE"], ["서울12가3456", "CAR_PLATE"],
    ["900101-1234567", "ID_NUMBER"], ["1234-5678-9012-3456", "CARD_NUMBER"],
    ["운송장번호 123456789012", "PARCEL_LABEL"], ["받는분 김민지", "PARCEL_LABEL"],
    ["합계 12,000원", "RECEIPT"], ["승인번호 12345678", "RECEIPT"],
    ["좌석 12A 게이트 5", "TICKET"], ["예약번호 AB1234", "TICKET"],
    ["사원증 홍길동", "ID_BADGE"], ["STUDENT ID 2024", "ID_BADGE"],
  ];
  for (const [t, c] of yes) {
    const got = detectTextRisks(t);
    check(`탐지: ${t} → ${c}`, got.includes(c as never), got);
  }
  const no = ["오늘 5km 뛰었어", "새로 3개 샀어", "앞으로 3개월 동안", "차로 20분 걸려", "카페 라떼 4500원", "2026년 9월 30일", "10시 1234명", "택배 왔다!", "좋아하는 음식은 초밥"];
  for (const t of no) {
    const got = detectTextRisks(t);
    check(`오탐 없음: ${t}`, got.length === 0, got);
  }
}

console.log("\nW · 검사 결과 · 수준 · 문구");
{
  const secret = "마포구 월드컵로 123 101동 1203호 010-9876-5432";
  const findings = findingsFromText([{ text: secret, box: { x: 10, y: 20, width: 100, height: 20 } }]);
  const json = JSON.stringify(findings);
  check("W. 결과에 글자 원문 없음 (종류 · 위치만)", !json.includes("월드컵로") && !json.includes("9876") && findings.every((f) => Object.keys(f).sort().join() === "box,category"), json);
  check("HIGH (주소 · 동호수 · 전화)", riskLevelOf(findings) === "HIGH");
  const img = {} as HTMLCanvasElement;
  const none = await scanImage(img, {});
  check("글자 · 코드 검사기가 없으면 unavailable로 정직하게 · 수준은 LOW", none.capabilities.text === "unavailable" && none.capabilities.codes === "unavailable" && none.level === "LOW");
  check("LOW 문구: '안전'이라고 하지 않고, 글자는 확인하지 못했다고 알림", !/안전/.test(levelMessage(none)) && /확인하지 못해요/.test(levelMessage(none)), levelMessage(none));
  const fakeOcr: TextRecognizer = { id: "test", recognize: async () => [{ text: "평범한 풍경" }] };
  const clean = await scanImage(img, { text: fakeOcr });
  check("글자 검사를 했고 없으면: '뚜렷한 위험요소를 찾지 못했어요' (안전 보장 아님)", clean.level === "LOW" && clean.capabilities.text === "checked" && /뚜렷한 위험요소를 찾지 못했어요/.test(levelMessage(clean)) && !/안전합니다/.test(levelMessage(clean)));
  const broken: TextRecognizer = { id: "broken", recognize: async () => { throw new Error("x"); } };
  check("검사기가 실패하면 checked라고 하지 않음", (await scanImage(img, { text: broken })).capabilities.text === "unavailable");
  check("점수 필드 없음 (수준 3단계만)", !("score" in none) && ["LOW", "MEDIUM", "HIGH"].includes(none.level));
}

console.log("\n로그인 next — open redirect");
{
  const bad = ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "javascript:alert(1)", "/%0d%0aLocation:evil", "/\u0000x", "", "evil.com"];
  for (const b of bad.filter((x) => x !== "/%0d%0aLocation:evil")) check(`거부: ${JSON.stringify(b)}`, safeNext(b) === "", safeNext(b));
  check("인코딩된 CR/LF는 경로 문자로만 남음 (같은 origin)", safeNext("/%0d%0aLocation:evil").startsWith("/"));
  check("허용: /chat/c1?mode=human", safeNext("/chat/c1?mode=human") === "/chat/c1?mode=human");
  check("허용: /studio/fans#top", safeNext("/studio/fans#top") === "/studio/fans#top");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
