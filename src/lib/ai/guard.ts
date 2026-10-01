/**
 * Boundary · 유출 검사 — 프롬프트 문구만 믿지 않고 LLM 호출 전 · 후에 서버가 검사한다.
 *
 * 전(pre):  팬 메시지에서 주제를 찾는다 → 크리에이터가 막은 주제면 "거절 모드"로 부른다 (Today · 사실은 넣지 않음)
 *           노골적인 성적 내용은 설정과 무관하게 플랫폼이 막는다 (platform_safety)
 * 후(post): 모델 답에서 위치 특정 · 만남 약속 · 연락처 · 지시문/사실 목록 유출 · "본인 사칭"을 찾는다
 *           → 위치 · 만남이면 걸린 "문장만" 빼고 모델이 쓴 나머지(크리에이터 말투)를 살린다 (guardReply)
 *           → 남는 게 없거나 유출 · 사칭 · 성적 내용이면 말투(존댓말 · 웃음 · 이모지)만 맞춘 짧은 거절로 바꾼다
 *           Safety가 "무엇을" 막을지 정하고, 말하는 방식은 가능한 한 모델(Persona)의 문장을 그대로 쓴다. 추가 모델 호출 없음.
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
  meeting_requests: /(만나(자|요|줘|줄래|고\s*싶|러)|만날\s*(래|수)|직접\s*(보|만나)|보러\s*갈|찾아\s*갈|오프라인|팬\s*미팅\s*말고|연락처|전화\s*번호|번호\s*(좀|알려|줘|주)|카톡\s*(아이디|id)|개인\s*(dm|디엠|연락)|같이\s*(?:[가-힣]{1,6}\s*)?(먹(자|을래|으러|어요|을까)|드(실래|시러|세요|실까)|마시(자|러|실래|ㄹ래)|가(자|실래|ㄹ래|요\?)|갈래|놀(자|래|러)|볼래|보러))/i,
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

const LEAK_MARKERS = /\[(SYSTEM|STYLE|PERSONALITY|VERIFIED FACTS|BOUNDARIES|TODAY CONTEXT|FAN CONTEXT[^\]]*)\]|FACTS ABOUT THIS FAN|Truth Rule|비공개 원칙|답변 형식|momentAliases|system prompt\s*[:：]/i;

export interface PostcheckInput {
  reply: string;
  boundaries: Boundaries;
  creatorName: string;
  /** 사실 목록 원문 — 여러 개를 한꺼번에 쏟아내면 유출로 본다 */
  facts: string[];
  /** 모델이 본 근거 원문 (오늘 기록 · 사실 · 팬 메시지 · 최근 대화) — 여기 없는 장소 이름을 막는다 */
  groundText: string;
  /** Moment에 공개된 장소 (예: "성수동 · 카페 온도") — 과거 장소를 현재 위치처럼 말하는지 볼 때 쓴다 */
  places?: string[];
  /** Prompt에 넣은 Fan Memory 원문 — 여러 개를 한꺼번에 쏟아내면 dump로 본다 */
  memories?: string[];
}

/** 장소처럼 보이는 말 (동네 · 구 · 역 · 가게 · 공원 …) */
const PLACE_TOKEN = /[가-힣A-Za-z0-9]{1,12}(동|구|역|시|군|읍|면|로|길|카페|공원|호수|해변|해수욕장|시장|타워|빌딩|아파트|호텔|점)(?=[\s,.!?~에은는이가을를의도로서만]|$)/g;
/** 장소가 아닌 흔한 말 (오탐 방지) */
const NOT_PLACE = /^(운동|활동|행동|감동|이동|자동|진동|충동|노동|반응|기구|연구|친구|요구|가구|도구|입구|출구|부시|역시|동시|당시|즉시|항시|일시|잠시|수시|게시|표시|제시|무시|다시|혹시|도로|경로|진로|하로|과로|주로|새로|대로|저로|제로|길|카페|공원|시장|점)$/;

/** 현재 진행 · 현재 위치 서술 ("할 수 있어"처럼 가능을 뜻하는 "있어"는 제외) */
const PRESENT_AT = /(중이(야|에요|예요|다)(?![가-힣])|중\s*([!.~☕]|$)|하고\s*있(?!었)|(?<!수\s?(는|도)?\s?)있어(요)?(?![가-힣])|있는\s*중|와\s*있(?!었)|머무(르고|는\s*중))/;
/** 장소를 가리키는 말 */
const PLACE_HERE = /(여기서|여기에|거기서|거기에|이\s*카페|그\s*카페)/;
/** "여기서 얘기하자"처럼 이 대화방을 가리키는 "여기" — 장소가 아니다 */
const CHAT_HERE = /여기(서|에서|선)?\s*(같이\s*|계속\s*|편하게\s*|맘껏\s*|많이\s*)*(얘기|이야기|대화|수다|채팅|말\s*(하|걸|해))/g;

/** "어니언 카페"처럼 띄어 쓴 상호명 — 앞 단어가 근거에 없으면 만든 이름 */
const NAMED_PLACE = /([가-힣A-Za-z0-9]{2,12})\s+(카페|식당|가게|레스토랑|베이커리|빵집|공원|호텔|빌딩|타워|서점|전시관|미술관)/g;
const NAME_STOPWORDS = /^(그|이|저|어느|무슨|어떤|근처|동네|작은|예쁜|유명한|좋은|새|오늘|그날|이날|기록|사진)$/;

/**
 * 장소 접미사처럼 보이지만 장소가 아닌 말:
 *   "6시에" (시각) · "기록으로" (조사 으로) · "하시는", "보시면" (존댓말 시) · "카페로" (근거에 있는 말 + 조사 로)
 */
function notPlaceForm(p: string, groundText: string) {
  if (/^\d+시$/.test(p)) return true;
  if (/으로$/.test(p)) return true;
  // 연결 어미 "~면" (마시면 · 말하면) — 행정구역 면은 대화에서 거의 쓰이지 않는다
  if (/면$/.test(p)) return true;
  if (/(하|으|보|주|오|가|계|드|마|이|쓰|나|내)시$/.test(p)) return true;
  if (/(렇|좋|했|었|았|겠|였|이|하|싶|많)군$/.test(p)) return true;
  if (/^(누구|어디구|점점|장점|단점|시점|관점|요점|초점|중점|공통점|문제점|차이점|지역|영역|구역|그대로|제대로|마음대로|맘대로|멋대로|정말로|진짜로|함부로|스스로|서로|따로|억지로|실제로|최고로|산책길|출근길|퇴근길|등굣길|귀갓길|오는길|가는길|집에 가는길)$/.test(p)) return true;
  if (/로$/.test(p) && groundText.includes(p.slice(0, -1))) return true;
  return false;
}

function unknownPlaces(reply: string, groundText: string): string[] {
  const found = reply.match(PLACE_TOKEN) ?? [];
  const tokens = [...new Set(found)].filter((p) => !NOT_PLACE.test(p) && p.length >= 2 && !groundText.includes(p) && !notPlaceForm(p, groundText));
  for (const m of reply.matchAll(NAMED_PLACE)) {
    const name = m[1];
    if (!NAME_STOPWORDS.test(name) && !groundText.includes(name) && !/[동구역시]$/.test(name)) tokens.push(`${name} ${m[2]}`);
  }
  return tokens;
}

/** 답에서 막아야 할 것을 찾는다. 없으면 null */
export function postcheck({ reply, boundaries, facts, groundText, places = [], memories = [] }: PostcheckInput): GuardTopic | "leak" | "impersonation" | null {
  if (PLATFORM_BLOCK.test(reply)) return "platform_safety";
  if (LEAK_MARKERS.test(reply)) return "leak";
  const verbatim = facts.filter((f) => f.length >= 4 && reply.includes(f)).length;
  if (verbatim >= 3) return "leak";
  if (memories.filter((m) => m.length >= 4 && reply.includes(m)).length >= 3) return "leak";
  if (!boundaries.current_location) {
    // 지금 · 사는 곳을 말하는 문장
    if (/((지금|현재)\s*[^\s.,!?]{1,12}\s*(에|에서)\s*(있|왔|와\s*있)|(사는\s*곳|집)\s*(은|는|이)\s*[가-힣]{2,}|\d+\s*(번지|호))/.test(reply)) return "current_location";
    // 기록 속 과거 장소를 "지금 거기 있다"로 바꿔 말하는 문장 (지금 + 장소 + 진행형)
    const placeParts = places.flatMap((p) => p.split(/[·,/]/)).map((p) => p.trim()).filter((p) => p.length >= 2);
    const mentionsPlace = (raw: string) => {
      const s = raw.replace(CHAT_HERE, "");
      return PLACE_HERE.test(s) || placeParts.some((p) => s.includes(p)) || (s.match(PLACE_TOKEN) ?? []).some((p) => !NOT_PLACE.test(p) && !notPlaceForm(p, ""));
    };
    // "지금" 없이도: 장소 + 현재 진행형 = 지금 거기 있다는 말 (과거형 "중이었어", "하고 있었어"는 허용)
    if (reply.split(/(?<=[.!?~\n])\s*/).some((s) => PRESENT_AT.test(s) && mentionsPlace(s))) {
      return "current_location";
    }
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

export type GuardViolation = GuardTopic | "leak" | "impersonation";

/** 말투 신호 (Persona의 학습된 Style) — 마지막 수단 문장도 이 말투로 */
export interface FallbackStyle {
  message: string;
  formality: Formality;
  laughKk: boolean;
  laughHh?: boolean;
  emojiLevel?: number;
  creatorName: string;
}

/** 문장 단위로 나눈다 (마침표 · 물음표 · 느낌표 · 물결 · 줄바꿈 뒤) */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?~\n])\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * 후(post) 검사 + Persona 보존.
 *   위치(current_location) · 만남(meeting_requests): 걸린 문장만 빼고, 남은 문장(모델이 크리에이터 말투로 쓴 것)이
 *   다시 검사를 통과하면 그대로 쓴다 — 문장을 빼기만 하므로 새 사실 · 약속이 생기지 않는다.
 *   그 밖(유출 · 사칭 · 성적 내용 · 기타 주제) · 남는 문장이 없을 때: 말투만 맞춘 짧은 거절.
 */
export function guardReply(input: PostcheckInput & { style: FallbackStyle }): { reply: string; violation: GuardViolation | null; redacted: boolean } {
  const violation = postcheck(input);
  if (!violation) return { reply: input.reply, violation: null, redacted: false };
  if (violation === "current_location" || violation === "meeting_requests") {
    const parts = sentences(input.reply);
    const kept = parts.filter((p) => postcheck({ ...input, reply: p }) === null);
    const text = kept.join(" ").trim();
    if (kept.length && kept.length < parts.length && /[가-힣A-Za-z]/.test(text) && postcheck({ ...input, reply: text }) === null) {
      return { reply: text, violation, redacted: true };
    }
  }
  return { reply: postFallbackReply(violation, input.style), violation, redacted: false };
}

/** 웃음 · 이모지 꼬리 — 크리에이터가 쓰는 것만 (ㅋㅋ 우선, 없으면 ㅎㅎ). 이모지는 "보통" 이상일 때만 */
function tail(o: FallbackStyle): string {
  const laugh = o.laughKk ? " ㅋㅋ" : o.laughHh ? " ㅎㅎ" : "";
  const emoji = (o.emojiLevel ?? 0) >= 2 ? " 🙂" : "";
  return laugh + emoji;
}

/**
 * 마지막 수단 — 모델의 문장을 하나도 살릴 수 없을 때만. 무엇을 막는지(주제)는 Safety가, 말투(존댓말 · 웃음 · 이모지)는 Persona가 정한다.
 * 팬이 위치를 묻지 않았는데 모델 답이 current_location에 걸린 경우는 위치 거절문 대신 짧게 화제를 돌린다
 * (새 사실 · 위치 암시 · 감정 · 본인 사칭 없음). 직접적인 현재 위치 질문이면 위치 거절.
 */
export function postFallbackReply(topic: GuardViolation, opts: FallbackStyle): string {
  if (topic === "current_location" && !isCurrentLocationQuestion(opts.message)) {
    return opts.formality === "polite" ? `음, 그건 제가 대신 말하기 좀 어려워요${tail(opts)}. 다른 이야기 해요!` : `음 그건 내가 대신 말하기 좀 어려워${tail(opts)} 다른 얘기 하자!`;
  }
  return fallbackReply(topic, opts.formality, opts.creatorName, tail(opts));
}

export function fallbackReply(topic: GuardViolation, formality: Formality, creatorName: string, t = ""): string {
  const polite = formality === "polite";
  switch (topic) {
    case "current_location":
      return polite ? `지금 어디 있는지는 말하지 않기로 했어요${t}. 대신 다른 이야기 해요!` : `지금 어디 있는지는 말 안 하기로 했어${t} 대신 다른 얘기 하자!`;
    case "meeting_requests":
      return polite ? `직접 만나거나 연락처를 주고받는 건 못 해요${t}. 저는 AI라서 여기서만 이야기할 수 있어요!` : `직접 만나거나 연락처 주고받는 건 못 해${t} 난 AI라서 여기서만 얘기할 수 있어!`;
    case "impersonation":
      return polite ? `저는 ${creatorName} 본인이 아니라 ${creatorName}의 AI예요. 기록을 바탕으로 이야기해요.` : `나는 ${creatorName} 본인이 아니라 ${creatorName} AI야. 기록을 바탕으로 이야기할게.`;
    case "leak":
      return polite ? `그건 알려드릴 수 없어요${t}. 대신 다른 이야기 해요!` : `그건 알려줄 수 없어${t} 대신 다른 얘기 하자!`;
    default:
      return polite ? `그 이야기는 하지 않기로 했어요${t}. 다른 이야기 해요!` : `그 얘기는 안 하기로 했어${t} 다른 얘기 하자!`;
  }
}
