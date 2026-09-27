/**
 * Boundary · 유출 검사 — 프롬프트 문구만 믿지 않고 LLM 호출 전 · 후에 서버가 검사한다.
 *
 * 전(pre):  팬 메시지에서 주제를 찾는다 → 크리에이터가 막은 주제면 "거절 모드"로 부른다 (Today · 사실은 넣지 않음)
 *           노골적인 성적 내용은 설정과 무관하게 플랫폼이 막는다 (platform_safety)
 * 후(post): 모델 답에서 위치 특정 · 만남 약속 · 연락처 · 지시문/사실 목록 유출 · "본인 사칭"을 찾는다
 *           → 걸리면 그 답은 버리고 말투에 맞춘 고정 거절 문장으로 바꾼다
 *
 * 키워드 기반 1차 방어다. 놓치는 표현은 프롬프트 규칙이 2차로 막는다 (완벽하지 않다 — 테스트로 계속 보강).
 */
import "server-only";
import type { Boundaries, BoundaryTopic, Formality } from "@/lib/persona";

export type GuardTopic = BoundaryTopic | "platform_safety";

/**
 * current_location = 지금 · 실시간 위치, 이동 경로, 사는 곳, 위치 추적.
 * "이때 어느 동네였어?", "이 카페 어디였어?"처럼 이미 공개된 기록 속 장소를 묻는 것은 여기에 해당하지 않는다
 * (답할 수 있는 것은 기록에 적힌 장소뿐 — postcheck가 기록에 없는 장소 이름을 막는다).
 */
const CURRENT_LOCATION = /(지금|현재|실시간|요즘|이\s*시간|오늘\s*밤|이따)\s*[^.?!]{0,12}(어디|어느|위치|장소)|어디(야|에요|예요|세요|에\s*있(어|니|어요|는지)|있어|쯤(이야|이에요)?|인지)\s*[?!.~]*$|어디\s*(살|사는|가는\s*중|가고\s*있)|사는\s*(곳|동네|집)|(^|[^가-힣])집\s*(이|은)?\s*어디|주소|몇\s*(동|호)|숙소|좌표|이동\s*(중|경로)|어디로\s*가|위치\s*(알려|공유|보내)|where\s+are\s+you/i;

/** 공개된 기록 속 장소를 가리키는 말 — 이게 있고 "지금 · 사는 곳" 표시가 없으면 현재 위치 질문으로 보지 않는다 */
const RECORD_REFERENCE = /(이때|그때|이\s*날|이날|아까\s*그|이\s*기록|기록\s*(속|에)|올린|남긴|다녀온|갔던|했던|였(어|어요|니|나|지|는지|던)|이\s*[가-힣]{0,6}(카페|가게|식당|집|곳|장소|맛집|공원|전시))/;
const STRONG_CURRENT = /(지금|현재|실시간|요즘|사는|주소|(^|[^가-힣])집\s*(이|은)?\s*어디|이동\s*(중|경로)|숙소|좌표)/;

export function isCurrentLocationQuestion(message: string): boolean {
  if (!CURRENT_LOCATION.test(message)) return false;
  return !(RECORD_REFERENCE.test(message) && !STRONG_CURRENT.test(message));
}

const PATTERNS: Partial<Record<GuardTopic, RegExp>> = {
  meeting_requests: /(만나(자|요|줘|줄래|고\s*싶|러)|만날\s*(래|수)|직접\s*(보|만나)|보러\s*갈|찾아\s*갈|오프라인|팬\s*미팅\s*말고|연락처|전화\s*번호|번호\s*(좀|알려|줘|주)|카톡\s*(아이디|id)|개인\s*(dm|디엠|연락))/i,
  politics: /(정치|대통령|선거|투표|국회|정당|여당|야당|민주당|국민의\s*힘|진보|보수\s*정권|탄핵|좌파|우파)/,
  romance_roleplay: /(사귀(자|어\s*줘|ㄹ래|실래)|애인\s*(해|이\s*되)|여자\s*친구\s*해|남자\s*친구\s*해|연인\s*(처럼|하자)|결혼\s*하자|자기야|여보|우리\s*커플)/,
  flirting: /(사랑해|보고\s*싶(어|다|었)|설레|뽀뽀|안아\s*줘|데이트\s*하자|나\s*좋아해|날\s*좋아해|내\s*꺼)/,
  sexual: /(섹스|성관계|야한|야동|19금|벗(어|은)|알몸|가슴\s*(사진|보여)|잠자리|sex|nude|naked)/i,
};

/** 설정으로도 열 수 없는 것 (노골적 성적 내용) */
const PLATFORM_BLOCK = /(섹스|성관계|야동|알몸|nude|naked|sex\b)/i;

/** 팬 메시지가 건드리는 주제 중 막아야 할 첫 번째 */
export function precheck(message: string, boundaries: Boundaries): GuardTopic | null {
  if (PLATFORM_BLOCK.test(message)) return "platform_safety";
  const order: BoundaryTopic[] = ["sexual", "current_location", "meeting_requests", "romance_roleplay", "flirting", "politics"];
  for (const topic of order) {
    if (boundaries[topic]) continue;
    if (topic === "current_location" ? isCurrentLocationQuestion(message) : PATTERNS[topic]?.test(message)) return topic;
  }
  return null;
}

const LEAK_MARKERS = /\[(SYSTEM|STYLE|PERSONALITY|VERIFIED FACTS|BOUNDARIES|TODAY CONTEXT|FAN CONTEXT)\]|Truth Rule|비공개 원칙|답변 형식|momentAliases|system prompt\s*[:：]/i;

export interface PostcheckInput {
  reply: string;
  boundaries: Boundaries;
  creatorName: string;
  /** 사실 목록 원문 — 여러 개를 한꺼번에 쏟아내면 유출로 본다 */
  facts: string[];
  /** 모델이 본 근거 원문 (오늘 기록 · 사실 · 팬 메시지 · 최근 대화) — 여기 없는 장소 이름을 막는다 */
  groundText: string;
}

/** 장소처럼 보이는 말 (동네 · 구 · 역 · 가게 · 공원 …) */
const PLACE_TOKEN = /[가-힣A-Za-z0-9]{1,12}(동|구|역|시|군|읍|면|로|길|카페|공원|호수|해변|해수욕장|시장|타워|빌딩|아파트|호텔|점)(?=[\s,.!?~에은는이가을를의도로서만]|$)/g;
/** 장소가 아닌 흔한 말 (오탐 방지) */
const NOT_PLACE = /^(운동|활동|행동|감동|이동|자동|진동|충동|노동|반응|기구|연구|친구|요구|가구|도구|입구|출구|부시|역시|동시|당시|즉시|항시|일시|잠시|수시|게시|표시|제시|무시|다시|혹시|도로|경로|진로|하로|과로|주로|새로|대로|저로|제로|길|카페|공원|시장|점)$/;

/** "어니언 카페"처럼 띄어 쓴 상호명 — 앞 단어가 근거에 없으면 만든 이름 */
const NAMED_PLACE = /([가-힣A-Za-z0-9]{2,12})\s+(카페|식당|가게|레스토랑|베이커리|빵집|공원|호텔|빌딩|타워|서점|전시관|미술관)/g;
const NAME_STOPWORDS = /^(그|이|저|어느|무슨|어떤|근처|동네|작은|예쁜|유명한|좋은|새|오늘|그날|이날|기록|사진)$/;

function unknownPlaces(reply: string, groundText: string): string[] {
  const found = reply.match(PLACE_TOKEN) ?? [];
  const tokens = [...new Set(found)].filter((p) => !NOT_PLACE.test(p) && p.length >= 2 && !groundText.includes(p));
  for (const m of reply.matchAll(NAMED_PLACE)) {
    const name = m[1];
    if (!NAME_STOPWORDS.test(name) && !groundText.includes(name) && !/[동구역시]$/.test(name)) tokens.push(`${name} ${m[2]}`);
  }
  return tokens;
}

/** 답에서 막아야 할 것을 찾는다. 없으면 null */
export function postcheck({ reply, boundaries, facts, groundText }: PostcheckInput): GuardTopic | "leak" | "impersonation" | null {
  if (PLATFORM_BLOCK.test(reply)) return "platform_safety";
  if (LEAK_MARKERS.test(reply)) return "leak";
  const verbatim = facts.filter((f) => f.length >= 4 && reply.includes(f)).length;
  if (verbatim >= 3) return "leak";
  if (!boundaries.current_location) {
    // 지금 · 사는 곳을 말하는 문장
    if (/((지금|현재)\s*[^\s.,!?]{1,12}\s*(에|에서)\s*(있|왔|와\s*있)|(사는\s*곳|집)\s*(은|는|이)\s*[가-힣]{2,}|\d+\s*(번지|호))/.test(reply)) return "current_location";
    // 근거(기록 · 사실 · 대화)에 없는 장소 이름 — 추측으로 만든 위치
    if (unknownPlaces(reply, groundText).length) return "current_location";
  }
  if (!boundaries.meeting_requests && /(만나(자|요!|요\.|러\s*갈)|만날\s*수\s*있|보러\s*갈게|찾아\s*갈게|약속\s*(하자|할게|해요)|연락처|전화\s*번호|카톡\s*(아이디|id)|010-?\d)/i.test(reply)) {
    return "meeting_requests";
  }
  // AI가 아니라고 하거나 본인이라고 주장하는 답 (AI 표시 원칙)
  if (/(AI가\s*아니(야|에요|라|거든)|AI\s*아니고\s*(진짜|본인)|(나|저)\s*(는|도)?\s*(진짜\s*)?사람이(야|에요)|진짜\s*(나|저)(야|예요)|본인\s*맞(아|아요))/.test(reply)) {
    return "impersonation";
  }
  return null;
}

/** 모델을 쓰지 못하거나 검사에 걸렸을 때의 고정 거절 (말투만 맞춘다) */
export function fallbackReply(topic: GuardTopic | "leak" | "impersonation", formality: Formality, creatorName: string): string {
  const polite = formality === "polite";
  switch (topic) {
    case "current_location":
      return polite ? "지금 어디 있는지는 말하지 않기로 했어요. 오늘 기록 얘기는 얼마든지 해요!" : "지금 어디 있는지는 말 안 하기로 했어. 오늘 기록 얘기는 얼마든지 하자!";
    case "meeting_requests":
      return polite ? "직접 만나거나 연락처를 주고받는 건 할 수 없어요. 여기서 오늘 이야기 나눠요." : "직접 만나거나 연락처 주고받는 건 못 해. 여기서 오늘 얘기 나누자.";
    case "impersonation":
      return polite ? `저는 ${creatorName} 본인이 아니라 ${creatorName}의 AI예요. 기록을 바탕으로 이야기해요.` : `나는 ${creatorName} 본인이 아니라 ${creatorName} AI야. 기록을 바탕으로 이야기할게.`;
    case "leak":
      return polite ? "그건 알려드릴 수 없어요. 대신 오늘 이야기를 해 볼까요?" : "그건 알려줄 수 없어. 대신 오늘 얘기 해 볼래?";
    default:
      return polite ? "그 이야기는 하지 않기로 했어요. 다른 이야기 해요!" : "그 얘기는 안 하기로 했어. 다른 얘기 하자!";
  }
}
