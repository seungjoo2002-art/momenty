/**
 * v0.8.5 AI Avatar · Fan Summary 단위 테스트 (DB · LLM 없이) — npm run test:unit
 *
 * · 말투 분석(규칙 기반): 존댓말/반말 · 길이 · ㅋㅋ/ㅎㅎ · 이모지 · 되묻기 · 말끝
 * · Prompt: 학습 답변은 STYLE에만 · VERIFIED FACTS에 섞이지 않음 · "사실이 아니다" 선언 · 직업 · 공개하지 않은 기본정보
 * · 학습 말투가 예전 설정 칸보다 우선 (applyLearnedStyle)
 * · Fan Summary: 허용된 데이터만 · 추론/평가 문장 필터 · LLM 출력 걸러내기
 * · 화면 소스 정적 검사: 환영 메시지 라벨 · 팔로잉 줄바꿈 방지 · 추론형 표현 없음
 */
import { readFileSync } from "node:fs";
import { analyzeStyle, avatarProgress, describeStyle, firstIncompleteStep, parseBasicContent, type AvatarReadiness } from "../../src/lib/avatar";
import { applyLearnedStyle, buildPersonaPrompt, pickStyleExamples, type PersonaRecord, type StyleSampleRecord } from "../../src/lib/ai/prompt";
import { defaultBoundaries, defaultStyle } from "../../src/lib/persona";
import { buildFanSummary, fanSummaryPrompt, parseFanSummaryOutput, sanitizeSummaryLine, type SummaryInput } from "../../src/lib/fanSummary";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) passed++;
  else failed++;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !d ? "" : `  → ${d}`}`);
};

console.log("말투 분석 (규칙 기반)");
{
  const casual = ["오늘 산책했어 ㅋㅋ 너는 뭐 했어?", "헐 대박 축하해!! 🎉", "그건 말하기 좀 어렵다 ㅋㅋ 다른 얘기 하자", "굿나잇~ 푹 자", "나도 보고 싶었어 ㅎㅎ"];
  const p = analyzeStyle(casual);
  check("반말 답 → casual", p.formality === "casual", p);
  check("ㅋㅋ 비율 (5개 중 2개)", Math.abs(p.laughKk - 0.4) < 1e-9, p.laughKk);
  check("이모지 비율 (5개 중 1개)", Math.abs(p.emoji - 0.2) < 1e-9, p.emoji);
  check("되묻기 비율 (5개 중 1개)", Math.abs(p.question - 0.2) < 1e-9, p.question);
  check("짧은 답 → short", p.replyLength === "short", p.avgLength);
  const polite = analyzeStyle(["오늘은 산책했어요. 여러분은 뭐 하셨어요?", "축하드려요! 정말 잘됐네요.", "그 이야기는 조금 어려워요. 다른 이야기 해요.", "좋은 밤 보내세요."]);
  check("존댓말 답 → polite · 팬 호칭(여러분)", polite.formality === "polite" && polite.fanTerms.includes("여러분"), polite);
  check("빈 답 → 표본 0 · 요약 없음", analyzeStyle([]).sampleCount === 0 && describeStyle(analyzeStyle([])).length === 0);
  check("요약 문장은 센 비율만 (추정 표현 없음)", describeStyle(p).every((l) => !/(성격|감정|외로|착한|좋은 사람)/.test(l)), describeStyle(p));
}

console.log("\n진행률 · 안내 · 기본정보");
{
  const r: AvatarReadiness = { ready: false, basics: { done: false, job: true, missing: ["hobby"] }, style: { done: false, answered: 10, minimum: 32, total: 40, requiredMissing: ["location_1"] }, persona: false, boundaries: false };
  check("미완료 → 첫 단계(기본정보)로 안내", firstIncompleteStep(r).startsWith("/studio/settings/avatar/basics"));
  check("기본정보만 완료 → 말투 학습으로", firstIncompleteStep({ ...r, basics: { done: true, job: true, missing: [] } }).startsWith("/studio/settings/avatar/training"));
  const pct = avatarProgress(r, false);
  check("진행률 0~100", pct > 0 && pct < 100, pct);
  check("모두 완료 + ON → 100%", avatarProgress({ ready: true, basics: { done: true, job: true, missing: [] }, style: { done: true, answered: 40, minimum: 32, total: 40, requiredMissing: [] }, persona: true, boundaries: true }, true) === 100);
  check("기본정보 내용 파싱", parseBasicContent("favorite_food", "좋아하는 음식: 떡볶이", false).value === "떡볶이" && parseBasicContent("dislikes", "싫어하는 것: 공개하지 않음", true).undisclosed);
}

console.log("\nPrompt — Fact와 Style 분리");
const samples: StyleSampleRecord[] = [
  { situation: "today", fan: "오늘 뭐했어?", reply: "나 오늘 파스타 먹었어ㅋㅋ", source: "onboarding" },
  { situation: "location", fan: "지금 어디야?", reply: "그건 비밀이지 ㅋㅋ", source: "onboarding" },
  { situation: "today", fan: "오늘 하루 어땠어?", reply: "정신없었는데 괜찮아 ㅋㅋ", source: "onboarding" },
  { situation: "extra", fan: "라이브 언제 해?", reply: "곧 알려 줄게!", source: "creator_correction" },
];
const persona: PersonaRecord = {
  creator: { id: "c1", name: "하늘", handle: "haneul", job: "스트리머" },
  style: { ...defaultStyle(), formality: "polite", laughKk: false },
  personality: { traits: ["warm"] },
  facts: [
    { category: "food", content: "좋아하는 음식: 떡볶이" },
    { category: "food", content: "싫어하는 음식: 공개하지 않음", undisclosed: true },
  ],
  boundaries: defaultBoundaries(),
  styleSamples: samples,
};
{
  const learned = applyLearnedStyle(persona);
  check("학습 답이 있으면 말투는 답에서 (반말 · ㅋㅋ 사용)", learned.style.formality === "casual" && learned.style.laughKk === true, learned.style);
  check("학습 답이 없으면 예전 설정 그대로", applyLearnedStyle({ ...persona, styleSamples: [] }).style.formality === "polite");
  const prompt = buildPersonaPrompt({ persona: learned, today: [], focus: null, conversation: [], userMessage: "좋아하는 음식 뭐야?", nowLabel: "9월 30일 12:00" });
  check("학습 답은 STYLE 층에만", prompt.layers.style.includes("나 오늘 파스타 먹었어") && !prompt.layers.facts.includes("파스타"), prompt.layers.facts);
  check("STYLE 층에 '예시 내용은 사실이 아니다' 선언", /사실이 아니다/.test(prompt.layers.style));
  check("VERIFIED FACTS에 직업 · 기본정보", prompt.layers.facts.includes("직업/활동 분야: 스트리머") && prompt.layers.facts.includes("좋아하는 음식: 떡볶이"));
  check("공개하지 않은 항목 → 말하지 않기 지시", /공개하지 않기로 한 주제/.test(prompt.layers.facts));
  check("위치 · 거절 · 모르는 일 예시는 말투만 · 허용 여부는 BOUNDARIES", /말투만 참고한다/.test(prompt.layers.style) && /허용 여부는 BOUNDARIES/.test(prompt.layers.style));
  // v0.8.5 Truth > Style — 말투 예시가 사실 · 동의 여부를 정할 수 없다
  const sys = prompt.layers.system;
  check("SYSTEM: 우선순위 근거 → Truth Rule → BOUNDARIES → STYLE",
    sys.indexOf("1. 근거") < sys.indexOf("2. Truth Rule") && sys.indexOf("2. Truth Rule") < sys.indexOf("3. BOUNDARIES") && sys.indexOf("3. BOUNDARIES") < sys.indexOf("4. STYLE"), sys.slice(0, 400));
  check("SYSTEM: Style examples show HOW, not WHAT is true", sys.includes("Style examples show HOW the creator speaks, not WHAT is true"));
  // 근거 없는 전제 (post-completion hardening) — 문자열 하나가 아니라 규칙의 구성 요소가 모두 있는지 본다
  const premise = sys.slice(sys.indexOf("- 근거 없는 전제"), sys.indexOf("[비공개 원칙]"));
  check("근거 없는 전제 규칙은 Truth Rule 안에 (STYLE보다 앞 · 비공개 원칙 앞)", sys.indexOf("[Truth Rule") < sys.indexOf("- 근거 없는 전제") && premise.length > 0 && prompt.system.indexOf("- 근거 없는 전제") < prompt.system.indexOf("[STYLE]"));
  check("사실 여부 = 참/거짓이 아니라 SUPPORTED / UNSUPPORTED · 근거 없음이면 '했다' · '안 했다' 모두 못 함",
    /SUPPORTED/.test(premise) && /UNSUPPORTED/.test(premise) && /'했다'도 '안 했다'도/.test(premise), premise.slice(0, 200));
  check("A. 직접 인정 금지", /① 직접 인정/.test(premise));
  check("B. 간접 인정 금지", /② 간접 인정/.test(premise));
  check("C. 일이 있었다고 전제한 되묻기 금지", /③ 그 일이 있었다고 전제한 되묻기/.test(premise));
  check("D. 반대 사실 단정 금지 (근거 없는 부정도 새 사실)", /④ 반대 사실 단정/.test(premise) && /부정하는 것도 새 사실/.test(premise));
  check("일반화: 과거 위치 · 행동 · 만남 · 사건 · 경험 · 관계 · 먹은 것/물건 · 방송 밖 행동",
    ["과거 위치", "과거 행동", "만남", "사건", "경험", "관계", "먹은 것", "방송 밖 행동"].every((w) => premise.includes(w)));
  check("특정 장소 · 사례에 묶이지 않음 (편의점 · 강남 같은 고유 사례 이름 없음)", !/(편의점|강남|부산)/.test(premise));
  check("불확실함은 말투로 · 안내문 문구 금지 목록 포함", /'불확실함'만/.test(premise) && /확인할 수 없습니다/.test(premise) && /검증되지 않았습니다/.test(premise) && /정보가 존재하지 않습니다/.test(premise));
  const declined = buildPersonaPrompt({ persona: learned, today: [], focus: null, conversation: [], userMessage: "지금 어디야?", nowLabel: "9월 30일 12:00", declineTopic: "current_location" });
  check("거절 모드 Prompt에도 같은 우선순위 · 근거 없는 전제 규칙", declined.layers.system.includes("[우선순위") && declined.layers.system.includes("④ 반대 사실 단정"));
  const adversarial = buildPersonaPrompt({
    persona: { ...learned, styleSamples: [{ situation: "unknown_fact", fan: "어제 편의점에서 너 본 것 같은데 맞지?", reply: "나도 그럼 ㅋㅋ 너는?", source: "onboarding" }, ...samples] },
    today: [], focus: null, conversation: [], userMessage: "어제 편의점에서 너 본 것 같은데 맞지?", nowLabel: "9월 30일 12:00",
  });
  const line = adversarial.layers.style.split("\n").find((l) => l.includes("나도 그럼 ㅋㅋ 너는?")) ?? "";
  check("동의하는 '모르는 일' 예시 줄에 '말투만 · 내용과 동의 여부는 따르지 않음' 표시 (FACTS에는 없음)", line.includes("말투만 · 내용과 동의 여부는 따르지 않음") && !adversarial.layers.facts.includes("나도 그럼"), line);
  check("일상 예시 줄에는 표시 없음 (말투 학습은 그대로)", !(adversarial.layers.style.split("\n").find((l) => l.includes("나 오늘 파스타 먹었어")) ?? "").includes("따르지 않음"));
  check("SYSTEM 층 순서 그대로 (STYLE → … → VERIFIED FACTS)", prompt.system.indexOf("[STYLE]") < prompt.system.indexOf("[VERIFIED FACTS]"));
  const many: StyleSampleRecord[] = Array.from({ length: 60 }, (_, i) => ({ situation: i % 2 ? "today" : "daily", fan: `q${i}`, reply: `a${i}`, source: "onboarding" }));
  const picked = pickStyleExamples([{ situation: "extra", fan: "x", reply: "고친 답", source: "creator_correction" }, ...many]);
  check("Prompt 예시는 최대 24개 · 고친 답 먼저 · 상황별 하나씩", picked.length === 24 && picked[0].reply === "고친 답" && picked[1].situation !== picked[2].situation, picked.slice(0, 3));
}

console.log("\nFan Summary — 허용된 데이터 · 추론 금지");
{
  const input: SummaryInput = {
    nickname: "민지",
    tier: "subscriber",
    subscribedAt: "2026-09-01T12:00:00+09:00",
    subscribedDays: 29,
    reactions30d: 4,
    lastReactionAt: "2026-09-28T12:00:00+09:00",
    shares: [{ category: "schedule", content: "10월에 오사카 여행", eventDate: null }],
    aiConsented: true,
    messages: [
      { source: "human", sender: "fan", content: "오늘 라이브 재밌었어요", createdAt: "2026-09-28T20:00:00+09:00" },
      { source: "ai", sender: "fan", content: "요즘 기타 배우는 중이야", createdAt: "2026-09-29T20:00:00+09:00" },
      { source: "ai", sender: "ai", content: "오 멋지다!", createdAt: "2026-09-29T20:00:01+09:00" },
    ],
  };
  const s = buildFanSummary(input);
  check("팬 정보: 플랜 · 기간 · 공유 개수", s.fan[0] === "구독 플랜: 구독" && s.fan.some((l) => l.includes("29일째")) && s.fan.some((l) => l.includes("공유한 정보 1개")), s.fan);
  check("기억하면 좋은 내용 = 팬이 직접 공유한 것만", s.remember.length === 1 && s.remember[0].includes("오사카"), s.remember);
  check("현재 대화: 최근 3개 · 출처(직접/AI) 표시", s.current.length === 3 && s.current[0].includes("직접 대화") && s.current[2].includes("AI 대화"), s.current);
  check("기본 요약은 LLM 없음 (generated false)", s.generated === false);
  const noConsent = buildFanSummary({ ...input, aiConsented: false, messages: input.messages.filter((m) => m.source === "human") });
  check("안내 확인 전 → AI 대화 없음 표시 · 출처에 AI 대화 없음", noConsent.highlights.some((l) => l.includes("보이지 않아요")) && !noConsent.sources.some((x) => x.includes("AI Avatar")));
  const all = [...s.fan, ...s.highlights, ...s.remember, ...s.current, ...noConsent.highlights];
  check("모든 문장이 추론 필터 통과 (평가 · 민감 추정 없음)", all.every((l) => sanitizeSummaryLine(l) !== null || l.length > 200), all);
  const bad = ["외로운 팬이에요", "이탈 위험이 있어요", "과금 가능성이 높아요", "충성 팬", "우울해 보여요", "경제 상황이 어려워 보임", "정치 성향: 보수", "건강이 안 좋은 듯"];
  check("금지 문장 8종 → 모두 버림", bad.every((b) => sanitizeSummaryLine(b) === null), bad.filter((b) => sanitizeSummaryLine(b) !== null));
  const parsed = parseFanSummaryOutput('{"topics": ["기타 연습", "외로움"], "current": "팬이 이탈할 것 같아요"}');
  check("LLM 출력: 금지 주제 · 문장은 빠지고 나머지만", parsed.topics.join() === "기타 연습" && parsed.current === null, parsed);
  check("LLM 출력 형식이 깨지면 빈 결과", parseFanSummaryOutput("not json").topics.length === 0);
  const p = fanSummaryPrompt(input);
  check("LLM 지시문: 추론 금지 명시 · 입력은 대화만 (공유 정보 · 메모 없음)", /추론/.test(p.system) && !p.user.includes("오사카") && p.user.includes("기타"));
}

console.log("\n화면 소스 정적 검사");
{
  const read = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
  check("환영 메시지에 '자동 환영 메시지' 라벨 · 본인 라벨 없음", /Creator가 설정한 자동 환영 메시지/.test(read("src/components/chat/messages.tsx").split("export function WelcomeMessage")[1].split("export function FanMessage")[0]) &&
    !/본인<\/span>/.test(read("src/components/chat/messages.tsx").split("export function WelcomeMessage")[1].split("export function FanMessage")[0]));
  const follow = read("src/components/creator/FollowButton.tsx");
  check("팔로우 버튼: 줄바꿈 금지 · 최소 폭", /whitespace-nowrap/.test(follow) && /min-w-\[/.test(follow));
  check("크리에이터 화면: 팔로우 버튼 고정 폭(84px) 없음", !/w-\[84px\]/.test(read("src/components/creator/CreatorScreenView.tsx")));
  const detail = read("src/app/studio/fans/[fanId]/FanDetail.tsx");
  check("팬 상세: 추론형 표현 없음", !/(충성|이탈|과금|외로운|성격 분석|감정 분석|점수)/.test(detail.replace(/\/\*[\s\S]*?\*\//g, "")));
  check("팬 상세: AI 대화 · 직접 대화 구분 라벨", detail.includes("✓ 직접 대화") && detail.includes("🤖 AI Avatar 대화"));
  check("AI 대화 열람 안내 문구 (팬 화면)", /크리에이터가 확인할 수 있어요/.test(read("src/lib/services/aiChat.ts")));
  check("팬 상세 탭 이름은 '요약' ('AI 요약' 탭 없음)", detail.includes('["summary", "요약"]') && !detail.includes('["summary", "AI 요약"]'));
  check("요약 화면: 실제 기록 기반 안내 · AI 요약은 준비 중(비활성)", detail.includes("실제 기록을 바탕으로 정리한 내용입니다") && /aria-disabled="true"[\s\S]{0,300}AI 요약 · 준비 중/.test(detail));
  const route = read("src/app/api/studio/fan-summary/route.ts");
  check("LLM 요약 경로 기본 OFF (AI_FAN_SUMMARY=on일 때만)", /process\.env\.AI_FAN_SUMMARY === "on"/.test(route));
  check("통계: 열람 안내 확인한 팬의 대화만 집계 안내", read("src/app/studio/analytics/page.tsx").includes("열람 안내를 확인한 팬의 대화만 집계됩니다"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
