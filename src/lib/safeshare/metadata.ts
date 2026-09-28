/**
 * SafeShare · 미디어 metadata 제거 — 크리에이터의 선택과 관계없이 항상 한다 (위치 · 기기 정보).
 *
 *   사진   canvas 재인코딩(lib/utils/image.ts)으로 EXIF가 사라진다. 여기서 한 번 더 JPEG 세그먼트를 걸러
 *          APP1(EXIF · XMP) ~ APP15 · COM이 남지 않게 한다 (방어 한 겹 더 · 테스트로 보장).
 *   영상   MP4 · MOV(QuickTime): moov · trak 안의 udta · meta 박스와 최상위 XMP uuid 박스를 같은 크기의 'free'로 바꾸고
 *   음성   내용을 0으로 채운다 → 파일 길이 · 다른 박스 위치가 그대로라 재생에 영향이 없다 (iPhone 영상의 위치 ©xyz · ISO6709).
 *          M4A도 같은 컨테이너. MP3: ID3v2 · ID3v1 태그를 잘라낸다.
 *          WebM · Ogg · WAV: 이 앱이 브라우저에서 녹음한 파일은 위치 정보를 담지 않는다. 다른 곳에서 가져온 파일은
 *          지금 검사하지 않는다 → "확인하지 못함"으로 정직하게 알린다 (제거했다고 표시하지 않는다).
 */

export type MetadataOutcome =
  /** 제거했다 (검증 가능) */
  | "removed"
  /** 처음부터 없었다 */
  | "none_found"
  /** 이 형식은 확인하지 못한다 — UI는 "제거됨"이라고 말하지 않는다 */
  | "unverified";

export interface MetadataReport {
  outcome: MetadataOutcome;
  /** 제거한 항목 종류 (값은 남기지 않는다) */
  removed: string[];
}

/* ---------------- JPEG ---------------- */

/** JPEG 세그먼트 중 APP0(JFIF) · APP14(Adobe 색공간)만 남기고 APP1~APP13 · APP15 · COM을 뺀다 */
export function stripJpegMetadata(bytes: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { bytes, removed: [] };
  const out: number[][] = [[0xff, 0xd8]];
  const removed = new Set<string>();
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    // SOS(스캔 데이터 시작): 이후는 이미지 데이터 — 그대로 붙인다
    if (marker === 0xda) {
      out.push(Array.from(bytes.subarray(i)));
      i = bytes.length;
      break;
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const seg = bytes.subarray(i, i + 2 + len);
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const keep = !(isApp && marker !== 0xe0 && marker !== 0xee) && marker !== 0xfe;
    if (keep) out.push(Array.from(seg));
    else removed.add(marker === 0xe1 ? (jpegSegmentIsExif(seg) ? "EXIF" : "XMP") : marker === 0xfe ? "COMMENT" : `APP${marker - 0xe0}`);
    i += 2 + len;
  }
  if (i < bytes.length) out.push(Array.from(bytes.subarray(i)));
  const merged = new Uint8Array(out.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of out) {
    merged.set(a, o);
    o += a.length;
  }
  return { bytes: merged, removed: [...removed] };
}

function jpegSegmentIsExif(seg: Uint8Array) {
  return seg[4] === 0x45 && seg[5] === 0x78 && seg[6] === 0x69 && seg[7] === 0x66; // "Exif"
}

/** EXIF(APP1 "Exif") 세그먼트가 있는지 · 그 안에 GPS IFD 태그(0x8825)가 있는지 */
export function jpegExifInfo(bytes: Uint8Array): { exif: boolean; gps: boolean } {
  let exif = false;
  let gps = false;
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff && bytes[i + 1] !== 0xda) {
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const seg = bytes.subarray(i, i + 2 + len);
    if (bytes[i + 1] === 0xe1 && jpegSegmentIsExif(seg)) {
      exif = true;
      for (let k = 10; k + 1 < seg.length; k++) {
        if ((seg[k] === 0x88 && seg[k + 1] === 0x25) || (seg[k] === 0x25 && seg[k + 1] === 0x88)) gps = true;
      }
    }
    i += 2 + len;
  }
  return { exif, gps };
}

/* ---------------- MP4 · MOV · M4A (ISO BMFF) ---------------- */

const CONTAINERS = new Set(["moov", "trak"]);
const METADATA_BOXES = new Set(["udta", "meta"]);
/** XMP를 담는 uuid 박스 (Adobe XMP UUID) */
const XMP_UUID = [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac];

function fourcc(b: Uint8Array, at: number) {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

export function isIsoBmff(bytes: Uint8Array) {
  return bytes.length >= 8 && ["ftyp", "moov", "mdat", "free", "wide", "skip"].includes(fourcc(bytes, 4));
}

/**
 * metadata 박스를 제자리에서 'free'로 바꾸고 내용을 0으로 채운다 (복사본을 돌려준다).
 * 크기 · 위치가 그대로라 chunk offset(stco · co64)을 고칠 필요가 없다.
 */
export function neutralizeIsoBmffMetadata(input: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  const bytes = input.slice();
  const removed = new Set<string>();
  const walk = (start: number, end: number, depth: number) => {
    let i = start;
    while (i + 8 <= end) {
      let size = ((bytes[i] << 24) >>> 0) + (bytes[i + 1] << 16) + (bytes[i + 2] << 8) + bytes[i + 3];
      const type = fourcc(bytes, i + 4);
      let header = 8;
      if (size === 1) {
        // 64비트 크기 (상위 32비트가 0이 아니면 여기서 다루지 않는 초대형 박스 — 멈춘다)
        const hi = ((bytes[i + 8] << 24) >>> 0) + (bytes[i + 9] << 16) + (bytes[i + 10] << 8) + bytes[i + 11];
        if (hi !== 0) return;
        size = ((bytes[i + 12] << 24) >>> 0) + (bytes[i + 13] << 16) + (bytes[i + 14] << 8) + bytes[i + 15];
        header = 16;
      } else if (size === 0) {
        size = end - i;
      }
      if (size < header || i + size > end) return; // 깨진 박스 — 더 건드리지 않는다
      const isXmpUuid = type === "uuid" && depth === 0 && XMP_UUID.every((v, k) => bytes[i + header + k] === v);
      if ((depth > 0 && METADATA_BOXES.has(type)) || isXmpUuid) {
        bytes.set([0x66, 0x72, 0x65, 0x65], i + 4); // 'free'
        bytes.fill(0, i + header, i + size);
        removed.add(isXmpUuid ? "XMP" : type === "udta" ? "USER_DATA" : "META");
      } else if (CONTAINERS.has(type)) {
        walk(i + header, i + size, depth + 1);
      }
      i += size;
    }
  };
  walk(0, bytes.length, 0);
  return { bytes, removed: [...removed] };
}

/* ---------------- MP3 ---------------- */

export function stripId3(bytes: Uint8Array): { bytes: Uint8Array; removed: string[] } {
  let start = 0;
  let end = bytes.length;
  const removed: string[] = [];
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    // ID3v2: 10바이트 헤더 + syncsafe 크기 (+ footer 10)
    const size = (bytes[6] << 21) | (bytes[7] << 14) | (bytes[8] << 7) | bytes[9];
    start = 10 + size + (bytes[5] & 0x10 ? 10 : 0);
    removed.push("ID3v2");
  }
  if (end - start >= 128 && bytes[end - 128] === 0x54 && bytes[end - 127] === 0x41 && bytes[end - 126] === 0x47) {
    end -= 128;
    removed.push("ID3v1");
  }
  return { bytes: removed.length ? bytes.slice(start, end) : bytes, removed };
}

/* ---------------- 공통 ---------------- */

/**
 * 올리기 직전 파일의 metadata 처리. 사진은 이미 canvas로 다시 만든 JPEG가 들어온다.
 * recordedInApp: 이 앱에서 브라우저로 녹음한 음성 (MediaRecorder WebM/Ogg — 위치 정보를 담지 않는다)
 */
export async function sanitizeMediaBlob(blob: Blob, kind: "image" | "video" | "audio", opts: { recordedInApp?: boolean } = {}): Promise<{ blob: Blob; report: MetadataReport }> {
  const type = blob.type.split(";")[0];
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const done = (out: Uint8Array, removed: string[]) => ({
    // 새 Blob — 원래 File의 이름은 따라가지 않는다
    blob: new Blob([out as BlobPart], { type }),
    report: { outcome: removed.length ? ("removed" as const) : ("none_found" as const), removed },
  });
  if (kind === "image" && type === "image/jpeg") {
    const r = stripJpegMetadata(bytes);
    return done(r.bytes, r.removed);
  }
  if ((kind === "video" || kind === "audio") && isIsoBmff(bytes)) {
    const r = neutralizeIsoBmffMetadata(bytes);
    return done(r.bytes, r.removed);
  }
  if (kind === "audio" && type === "audio/mpeg") {
    const r = stripId3(bytes);
    return done(r.bytes, r.removed);
  }
  if (kind === "audio" && opts.recordedInApp) return done(bytes, []);
  // WebM · Ogg · WAV 등을 다른 곳에서 가져온 경우: 지금은 확인하지 못한다 (파일은 그대로, 이름만 떼어낸다)
  return { blob: new Blob([bytes as BlobPart], { type }), report: { outcome: "unverified", removed: [] } };
}
