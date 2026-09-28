/**
 * SafeShare · 글자 → 위험 종류 (결정적 패턴). OCR 등이 읽은 글자를 받아 "종류"와 위치만 돌려준다.
 * 글자 원문은 결과에 담지 않는다 — 어디에도 저장 · 기록되지 않게 (호출한 쪽도 바로 버린다).
 *
 * 여기서 탐지하는 것: 전화번호 · 이메일 · 도로명/지번 주소 · 동호수 · 차량번호 · 주민번호 · 카드번호 · 송장번호(키워드 동반) ·
 *                   영수증 · 티켓/예약 · 사원증/학생증 키워드.
 * 탐지하지 못하는 것(글자가 아닌 것): 간판 모양 · 랜드마크 · 창밖 풍경 · 얼굴 — 크리에이터가 직접 확인한다.
 */

export type RiskCategory =
  | "PHONE_NUMBER"
  | "EMAIL"
  | "POSSIBLE_ADDRESS"
  | "UNIT_NUMBER"
  | "CAR_PLATE"
  | "ID_NUMBER"
  | "CARD_NUMBER"
  | "PARCEL_LABEL"
  | "RECEIPT"
  | "TICKET"
  | "ID_BADGE"
  | "QR_CODE"
  | "BARCODE";

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Finding {
  category: RiskCategory;
  /** 이미지 안 위치 (있으면 — 가리기에 쓴다) */
  box?: Box;
}

export const RISK_LEVEL: Record<RiskCategory, Exclude<RiskLevel, "LOW">> = {
  PHONE_NUMBER: "HIGH",
  EMAIL: "HIGH",
  POSSIBLE_ADDRESS: "HIGH",
  UNIT_NUMBER: "HIGH",
  CAR_PLATE: "HIGH",
  ID_NUMBER: "HIGH",
  CARD_NUMBER: "HIGH",
  PARCEL_LABEL: "HIGH",
  RECEIPT: "MEDIUM",
  TICKET: "MEDIUM",
  ID_BADGE: "MEDIUM",
  QR_CODE: "MEDIUM",
  BARCODE: "MEDIUM",
};

export const RISK_LABEL: Record<RiskCategory, string> = {
  PHONE_NUMBER: "전화번호로 보이는 정보",
  EMAIL: "이메일 주소로 보이는 정보",
  POSSIBLE_ADDRESS: "주소로 보이는 정보",
  UNIT_NUMBER: "동 · 호수로 보이는 정보",
  CAR_PLATE: "차량번호로 보이는 정보",
  ID_NUMBER: "주민등록번호로 보이는 정보",
  CARD_NUMBER: "카드번호로 보이는 정보",
  PARCEL_LABEL: "택배 송장으로 보이는 정보",
  RECEIPT: "영수증으로 보이는 정보",
  TICKET: "티켓 · 예약 정보로 보이는 것",
  ID_BADGE: "사원증 · 학생증으로 보이는 것",
  QR_CODE: "QR 코드",
  BARCODE: "바코드",
};

const PATTERNS: [RiskCategory, RegExp][] = [
  ["ID_NUMBER", /\b\d{6}\s?-\s?[1-4]\d{6}\b/],
  ["CARD_NUMBER", /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/],
  ["PHONE_NUMBER", /(\+82[- ]?|\b0)(1[016789]|2|[3-6][1-5])[-. )]?\d{3,4}[-. ]?\d{4}\b/],
  ["EMAIL", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  // 도로명(두 글자 이상 이름 + 로/길 + 건물번호 — "새로 3개", "앞으로 3개월" 같은 말은 제외) · 지번(…동/리 + 번지)
  ["POSSIBLE_ADDRESS", /[가-힣0-9]{1,12}[가-힣](?<!으)(로|길)\s?\d{1,4}(-\d{1,4})?(?!\d|\s?(개|명|시|분|초|km|킬로|원|살|년|월|일|주|회|층|번째|등|위|점|배))|[가-힣]{1,10}(동|리)\s\d{1,5}-\d{1,5}|\d{1,4}번지/],
  ["UNIT_NUMBER", /\d{1,4}\s?동\s?\d{1,4}\s?호|\b\d{3,4}호\b/],
  // 차량번호: 12가3456 · 123가4567 · 서울12가3456 (번호판에 쓰이는 글자만 — "10시 1234" 같은 말은 제외)
  ["CAR_PLATE", /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)?\s?\d{2,3}\s?[가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주아바사자배하허호]\s?\d{4}(?!\d)/],
  ["PARCEL_LABEL", /(운송장|송장\s?번호|받는\s?분|보내는\s?분)/],
  ["RECEIPT", /(영수증|합계|승인번호|카드\s?승인|사업자\s?번호|부가세|결제\s?금액)/],
  ["TICKET", /(예약\s?번호|좌석|탑승|게이트|승차권|입장권|예매\s?번호|boarding|seat|booking|gate)/i],
  ["ID_BADGE", /(사원증|학생증|학번|사번|employee\s?id|student\s?id|staff)/i],
];

/** 한 줄 · 한 영역의 글자 → 위험 종류들 (글자는 돌려주지 않는다) */
export function detectTextRisks(text: string): RiskCategory[] {
  const t = text.normalize("NFKC");
  return PATTERNS.filter(([, re]) => re.test(t)).map(([c]) => c);
}

/** 발견 목록 → 전체 수준. 아무것도 없으면 LOW (= 안전하다는 뜻이 아니다) */
export function riskLevelOf(findings: Finding[]): RiskLevel {
  if (findings.some((f) => RISK_LEVEL[f.category] === "HIGH")) return "HIGH";
  if (findings.some((f) => RISK_LEVEL[f.category] === "MEDIUM")) return "MEDIUM";
  return "LOW";
}
