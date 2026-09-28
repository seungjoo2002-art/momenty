/**
 * Fan Manager 문장 · 표시 단위 테스트 (DB · LLM 없이) — npm run test:unit
 *
 * · 신호 → 관찰된 사실 문장 (예: "최근 Moment 5개 중 4개에 반응했어요.")
 * · Fan Manager 화면 · 서비스 소스에 추론형 · 점수형 표현이 없는지 (정적 검사)
 */
import { readFileSync } from "node:fs";
import { fanFacts, reactionSummary, signalReasons } from "../../src/lib/fanSignals";
import type { ManagedFan } from "../../src/lib/services/fanManager";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) passed++;
  else failed++;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !d ? "" : `  → ${d}`}`);
};

const NOW = Date.parse("2026-09-29T12:00:00+09:00");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const base: ManagedFan = {
  fanId: "f", nickname: "민지", avatarUrl: null, tier: "subscriber", subscribedAt: daysAgo(31), subscribedDays: 31,
  recentMoments: 5, recentReacted: 4, reactions30d: 6, lastReactionAt: daysAgo(1), conversationId: null,
  lastFanMessageAt: null, lastCreatorMessageAt: null, sharedCount: 0, importantDate: null, hasNote: false, blocked: false, signals: [],
};

console.log("신호 → 사실 문장");
check("RECENT_REACTIONS", signalReasons({ ...base, signals: ["RECENT_REACTIONS"] }, NOW)[0] === "최근 Moment 5개 중 4개에 반응했어요.");
check("NO_HUMAN_REPLY", signalReasons({ ...base, signals: ["NO_HUMAN_REPLY"] }, NOW)[0] === "구독 후 아직 직접 대화한 적이 없어요.");
check("LONG_TIME_SINCE_HUMAN (18일)", signalReasons({ ...base, lastCreatorMessageAt: daysAgo(18), signals: ["LONG_TIME_SINCE_HUMAN"] }, NOW)[0] === "마지막 직접 대화가 18일 전이에요.");
check("NEW_SUBSCRIBER (0일 · 3일)",
  signalReasons({ ...base, subscribedDays: 0, signals: ["NEW_SUBSCRIBER"] }, NOW)[0] === "오늘 구독을 시작했어요." &&
    signalReasons({ ...base, subscribedDays: 3, signals: ["NEW_SUBSCRIBER"] }, NOW)[0] === "구독한 지 3일 됐어요.");
check("UNREPLIED_FAN_MESSAGE (3시간 전)", signalReasons({ ...base, lastFanMessageAt: new Date(NOW - 3 * 3_600_000).toISOString(), signals: ["UNREPLIED_FAN_MESSAGE"] }, NOW)[0] === "팬이 보낸 직접 메시지에 아직 답하지 않았어요 · 3시간 전");
check("IMPORTANT_DATE — 팬이 공유한 내용 그대로",
  signalReasons({ ...base, importantDate: { content: "10월 20일 생일", date: "2026-10-02", daysUntil: 3 }, signals: ["IMPORTANT_DATE"] }, NOW)[0] === "팬이 공유한 날: 10월 20일 생일 · 3일 뒤" &&
    signalReasons({ ...base, importantDate: { content: "기념일", date: "2026-09-29", daysUntil: 0 }, signals: ["IMPORTANT_DATE"] }, NOW)[0] === "팬이 공유한 날: 기념일 · 오늘");
check("여러 신호는 받은 순서 그대로", signalReasons({ ...base, signals: ["NEW_SUBSCRIBER", "NO_HUMAN_REPLY"] }, NOW).length === 2);
check("전체 목록 한 줄 사실", fanFacts({ ...base, lastCreatorMessageAt: daysAgo(18) }, NOW) === "구독 31일 · 최근 30일 반응 6회 · 마지막 직접 대화 18일 전", fanFacts({ ...base, lastCreatorMessageAt: daysAgo(18) }, NOW));
check("대화 없음 · 반응 없음", fanFacts({ ...base, reactions30d: 0 }, NOW) === "구독 31일 · 직접 대화 없음");
check("상세 반응 요약", reactionSummary(base, NOW).startsWith("최근 Moment 5개 중 4개에 반응했어요. 최근 30일 반응 6회"));

console.log("\n추론형 · 점수형 표현 없음 (정적 검사)");
const FORBIDDEN = /(관심\s*높은|충성|이탈|위험|점수|랭킹|순위|스코어|score|rank|소홀|취약|애착|의존|심리|감정\s*상태|가장\s*중요한\s*팬|top\s*spender|VIP)/i;
const files = [
  "src/lib/fanSignals.ts",
  "src/app/studio/fans/page.tsx",
  "src/app/studio/fans/[fanId]/FanDetail.tsx",
  "src/lib/services/fanManager.ts",
];
for (const f of files) {
  // 이 규칙을 설명하는 주석은 제외하고 문자열 · 코드만 검사
  const code = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const hit = code.match(FORBIDDEN);
  check(`${f}: 금지 표현 없음`, !hit, hit?.[0]);
}
const all = [
  ...(["UNREPLIED_FAN_MESSAGE", "IMPORTANT_DATE", "NEW_SUBSCRIBER", "RECENT_REACTIONS", "LONG_TIME_SINCE_HUMAN", "NO_HUMAN_REPLY"] as const).flatMap((s) =>
    signalReasons({ ...base, lastFanMessageAt: daysAgo(1), lastCreatorMessageAt: daysAgo(20), importantDate: { content: "생일", date: "x", daysUntil: 2 }, signals: [s] }, NOW),
  ),
  fanFacts(base, NOW),
  reactionSummary(base, NOW),
];
check("모든 문장에 추론 · 감정 · 평가 표현 없음", all.every((t) => !FORBIDDEN.test(t) && !/(느끼|외로|서운|좋아하는\s*팬|열성)/.test(t)), all);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
