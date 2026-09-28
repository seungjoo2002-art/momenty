/**
 * Fan Memory (v0.6) — "지금 대화하는 팬에 관한 관계 맥락". 크리에이터에 관한 사실(Verified Facts)과 섞지 않는다.
 *
 *   읽기: ai_fan_memory_context(서버 키, creatorId, 검색어) — DB가 권한(구독 팬 본인) · Memory ON · fan×creator 범위를 정하고
 *         관련 있는 것 · 최근 것만 최대 8개를 준다. 검색어는 순서만 바꾼다 (범위 · 개수에는 영향 없음).
 *   쓰기: record_fan_memories(서버 키, creatorId, 항목, 근거 팬 메시지 id) — Memory OFF면 DB가 저장하지 않는다.
 *         민감정보는 여기서 한 번, DB(함수 · 테이블 제약)에서 한 번 더 막는다.
 *
 * service role은 쓰지 않는다 — 팬의 쿠키 세션(sb) + AI_SERVER_KEY.
 */
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEMORY_CATEGORIES, type MemoryCategory } from "@/lib/fanMemory";

export interface FanMemoryItem {
  category: MemoryCategory;
  content: string;
}

export interface FanMemoryContext {
  enabled: boolean;
  items: FanMemoryItem[];
}

/** Prompt에 넣는 Memory 상한 (DB도 8개로 자른다) */
export const MEMORY_CONTEXT_LIMIT = 6;
/** 한 번의 답에서 새로 기억할 수 있는 개수 (DB도 3개로 자른다) */
export const MEMORY_SAVE_LIMIT = 3;
const MEMORY_MAX_CHARS = 200;

/** 끝에 붙는 조사 · 어미 (긴 것부터) — "오사카였나" → "오사카", "여행은" → "여행" */
const PARTICLES = /(이었나|이었어|이었지|였었지|했었지|했잖아|에서|에게|한테|으로|이랑|까지|부터|였나|였어|였지|였니|인가|인지|이야|이지|했지|했어|은|는|이|가|을|를|에|로|와|과|랑|도|만|야|요|지|나|니)$/;

/** 팬 메시지 → 검색어 (관련 Memory를 앞으로 가져오는 데만 쓴다) */
export function memoryTerms(message: string): string[] {
  const words = message
    .toLowerCase()
    .replace(/[^0-9a-z가-힣\s]/g, " ")
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w.replace(PARTICLES, "") : w))
    .filter((w) => w.length >= 2 && w.length <= 20);
  return [...new Set(words)].slice(0, 12);
}

/**
 * 민감정보 — DB의 public.fan_memory_sensitive()와 같은 기준 (DB가 최종 판단, 여기는 미리 거르는 1차).
 * 오탐이면 기억하지 않을 뿐이다 (안전한 쪽).
 */
const SENSITIVE: RegExp[] = [
  /(병원|질병|질환|진단|투병|수술|입원|통원|처방|복용|약을?\s*먹|당뇨|고혈압|천식|아토피|알레르기|암\s*(진단|환자|수술|투병|치료)|장애|임신|유산|난임|디스크|건강\s*검진|검사\s*결과)/i,
  /(우울|공황|불안\s*장애|정신과|정신\s*건강|심리\s*상담|상담\s*치료|자살|자해|트라우마|adhd|조울|강박|섭식|거식|폭식|수면제|항우울)/i,
  /(성관계|섹스|성생활|성적\s*(취향|지향)|성\s*정체성|동성애|양성애|게이(?!머|밍|트)|레즈|트랜스젠더|\bsex\b)/i,
  /(주소|번지|우편\s*번호|\d+\s*동\s*\d+\s*호|[가-힣]+(로|길)\s*\d+|아파트\s*\d|전화\s*번호|휴대폰\s*번호|핸드폰\s*번호|010[-\s.]?\d|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
  /(계좌|카드\s*번호|신용\s*카드|체크\s*카드|비밀\s*번호|비번|패스워드|password|인증\s*번호|otp|공인\s*인증|대출|빚|채무|연봉|월급|급여|신용\s*(등급|점수)|재산)/i,
  /(주민\s*(등록)?\s*번호|여권\s*번호|면허\s*번호|외국인\s*등록|사업자\s*번호|\d{6}\s*-\s*\d{7}|\d{6,})/i,
  /(정치|정당|민주당|국민의\s*힘|진보|보수|좌파|우파|대통령|선거|투표|지지하는\s*(당|후보))/i,
  /(종교|교회|성당|(^|[^가-힣])절에|사찰|기독교|천주교|개신교|불교|이슬람|무슬림|신앙|예배|미사|기도\s*모임)/i,
  /(범죄|전과|체포|구속|수감|교도소|마약|징역|벌금형|폭행|경찰\s*조사|소송|고소(를|했|당|장))/i,
  /(이혼|가정\s*폭력|학대|성폭력|성추행|스토킹)/i,
];

export function isSensitiveMemory(text: string): boolean {
  return SENSITIVE.some((r) => r.test(text));
}

/**
 * 모델이 제안한 Memory 후보 → 저장할 것만.
 * 형식 · 길이 · 민감정보 · 중복 · 개수 · "크리에이터에 관한 말"(이름이 들어간 것)을 거른다.
 */
export function filterMemoryCandidates(raw: unknown, creatorName: string): FanMemoryItem[] {
  if (!Array.isArray(raw)) return [];
  const out: FanMemoryItem[] = [];
  const seen = new Set<string>();
  for (const x of raw) {
    if (!x || typeof x !== "object") continue;
    const { category, content } = x as { category?: unknown; content?: unknown };
    if (typeof category !== "string" || !(MEMORY_CATEGORIES as readonly string[]).includes(category)) continue;
    if (typeof content !== "string") continue;
    const body = content.replace(/\s+/g, " ").trim();
    if (!body || body.length > MEMORY_MAX_CHARS) continue;
    if (isSensitiveMemory(body)) continue;
    // Fan Memory는 팬에 관한 것 — 크리에이터 이름이 들어간 문장은 크리에이터 사실일 수 있어 저장하지 않는다
    if (creatorName && body.includes(creatorName)) continue;
    const key = body.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ category: category as MemoryCategory, content: body });
    if (out.length >= MEMORY_SAVE_LIMIT) break;
  }
  return out;
}

/** 이 팬 × 이 크리에이터 AI의 Memory 중 Prompt에 넣을 것 (OFF면 enabled=false · 빈 목록) */
export async function loadFanMemory(sb: SupabaseClient, serverKey: string, creatorId: string, message: string): Promise<FanMemoryContext> {
  const { data, error } = await sb.rpc("ai_fan_memory_context", {
    p_server_key: serverKey,
    p_creator_id: creatorId,
    p_terms: memoryTerms(message),
    p_limit: MEMORY_CONTEXT_LIMIT,
  });
  if (error) throw error;
  const d = (data ?? {}) as { enabled?: boolean; items?: FanMemoryItem[] };
  return { enabled: d.enabled === true, items: d.enabled ? (d.items ?? []).slice(0, MEMORY_CONTEXT_LIMIT) : [] };
}

/** 대화에서 나온 Memory 저장 — 저장 수만 돌려준다 (실패해도 답은 이미 저장되어 있다) */
export async function saveFanMemories(sb: SupabaseClient, serverKey: string, creatorId: string, items: FanMemoryItem[], sourceMessageId: string | null): Promise<number> {
  if (!items.length) return 0;
  const { data, error } = await sb.rpc("record_fan_memories", {
    p_server_key: serverKey,
    p_creator_id: creatorId,
    p_items: items,
    p_source_message_id: sourceMessageId,
  });
  if (error) throw error;
  return Number((data as { saved?: number } | null)?.saved ?? 0);
}
