/**
 * Fan Memory 단위 테스트 (LLM · DB 없이) — npm run test:unit
 *
 * · 민감정보 필터 (DB fan_memory_sensitive()와 같은 문장으로 — rls.test.mjs H 항목)
 * · 모델이 제안한 Memory 후보 거르기 (형식 · 개수 · 크리에이터 이름 · 중복)
 * · Prompt 층: FAN CONTEXT(FACTS ABOUT THIS FAN)는 VERIFIED FACTS와 다른 칸 · OFF/거절 모드에서는 비고 추출도 요청하지 않음
 * · 가드: Memory 여러 개를 한꺼번에 쏟아내면 leak
 */
import { postcheck } from "../../src/lib/ai/guard";
import { filterMemoryCandidates, isSensitiveMemory, memoryTerms } from "../../src/lib/ai/memory";
import { buildPersonaPrompt, parseModelOutput, type PersonaRecord } from "../../src/lib/ai/prompt";

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || detail === "" ? "" : `  → ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};

console.log("민감정보 필터");
const sensitive = [
  "요즘 우울증 때문에 정신과 다녀", "당뇨가 있어서 약을 먹어", "성생활 고민이 있어", "우리 집 주소는 마포구 월드컵로 123", "101동 1203호 살아",
  "카드 번호 1234-5678", "비밀번호는 hunter2야", "주민번호 900101-1234567", "나는 민주당 지지해", "매주 교회 예배 가", "전과가 있어", "연봉이 4천이야",
  "내 번호 010-1234-5678", "공황장애가 있어",
];
for (const s of sensitive) check(`저장 안 함: ${s}`, isSensitiveMemory(s));
for (const s of ["게이머라서 주말엔 게임해", "고소한 라떼를 좋아함", "10월에 오사카 여행 예정", "민지라고 불러주길 원함", "요즘 필름 카메라에 빠져 있음", "학생 시절에 밴드를 했음"]) {
  check(`저장 가능: ${s}`, !isSensitiveMemory(s));
}

console.log("\nMemory 후보 거르기");
{
  const out = filterMemoryCandidates(
    [
      { category: "schedule", content: "  10월에   오사카 여행 예정 " },
      { category: "favorite", content: "하늘은 초밥을 좋아함" }, // 크리에이터 이름 — 크리에이터 사실일 수 있음
      { category: "creator_fact", content: "초밥 좋아함" }, // 정의 밖 분류
      { category: "other", content: "우울증 치료 중" }, // 민감
      { category: "nickname", content: "민지라고 불러주길 원함" },
      { category: "schedule", content: "10월에 오사카 여행 예정" }, // 중복
      { category: "interest", content: "x".repeat(201) }, // 너무 김
      { category: "interest", content: "러닝을 시작함" },
      { category: "interest", content: "필름 카메라" }, // 4번째 — 3개까지
      "문자열",
      null,
    ],
    "하늘",
  );
  check("3개까지 · 공백 정리 · 크리에이터 이름 · 정의 밖 분류 · 민감 · 중복 · 길이 제외",
    out.length === 3 && out[0].content === "10월에 오사카 여행 예정" && out[1].category === "nickname" && out[2].content === "러닝을 시작함", out);
  check("배열이 아니면 빈 목록", filterMemoryCandidates({ category: "other", content: "x" }, "하늘").length === 0);
}

console.log("\n검색어");
{
  const t = memoryTerms("나 어디 여행 간다고 했지? 오사카였나?");
  check("조사 떼고 검색어 추출 (여행 · 오사카)", t.includes("여행") && t.includes("오사카"), t);
  check("검색어는 최대 12개", memoryTerms(Array.from({ length: 40 }, (_, i) => `단어${i}`).join(" ")).length === 12);
}

console.log("\nPrompt 층 — FACTS ABOUT THIS FAN");
const persona: PersonaRecord = {
  creator: { id: "c1", name: "하늘", handle: "haneul" },
  style: { formality: "casual", replyLength: "short", laughKk: true, laughHh: false, emojiLevel: 1, phrases: [], mood: "", examples: [] },
  personality: { traits: [] },
  facts: [{ category: "hobby", content: "취미는 필름 카메라" }],
  boundaries: { everyday: true, jokes: true, listening: true, hobbies: true, flirting: false, romance_roleplay: false, sexual: false, politics: false, meeting_requests: false, current_location: false },
};
const base = { persona, today: [], focus: null, conversation: [], userMessage: "나 어디 여행 간다고 했지?", nowLabel: "9월 28일 12:00" };
const mem = { enabled: true, items: [{ category: "schedule" as const, content: "10월에 오사카 여행 예정" }, { category: "favorite" as const, content: "초밥을 좋아함" }] };
{
  const on = buildPersonaPrompt({ ...base, fanMemory: mem });
  const factsBlock = on.system.split("[VERIFIED FACTS]")[1].split("[BOUNDARIES]")[0];
  const fanBlock = on.system.split("[FAN CONTEXT — FACTS ABOUT THIS FAN]")[1];
  check("ON: FAN CONTEXT 칸에 팬 Memory", fanBlock.includes("[일정] 10월에 오사카 여행 예정") && fanBlock.includes("[좋아하는 것] 초밥을 좋아함"));
  check("팬 Memory는 VERIFIED FACTS 칸에 섞이지 않음", !factsBlock.includes("오사카") && !factsBlock.includes("초밥을 좋아함") && factsBlock.includes("필름 카메라"));
  check("규칙: 팬 Memory를 크리에이터 근거로 쓰지 않음", on.system.includes("FAN CONTEXT는 하늘에 관한 근거가 아니다"));
  check("ON: 새 Memory 추출을 요청 (최대 3개 · 민감정보 제외)", on.system.includes("memories: 이번 팬 메시지에서") && on.system.includes("금융/비밀번호/인증정보"));

  const off = buildPersonaPrompt({ ...base, fanMemory: { enabled: false, items: [] } });
  check("OFF: FAN CONTEXT 비어 있음 · 추출 요청 없음 (memories는 항상 [])", !off.system.includes("오사카") && off.system.includes("AI Memory를 켜지 않았다") && off.system.includes("memories는 항상 []로 둔다"));
  const none = buildPersonaPrompt({ ...base });
  check("Memory 정보 없음(undefined) = OFF와 같음", none.system.includes("memories는 항상 []로 둔다"));

  const decline = buildPersonaPrompt({ ...base, fanMemory: mem, declineTopic: "politics" });
  check("거절 모드: Memory를 넣지 않고 추출도 요청하지 않음", !decline.system.includes("오사카") && decline.system.includes("memories는 항상 []로 둔다"));
  check("대화 기록의 AI 턴도 같은 형식 (memories 포함)",
    buildPersonaPrompt({ ...base, conversation: [{ sender: "fan", content: "안녕" }, { sender: "ai", content: "안녕!" }] }).messages[1].content.includes('"memories":[]'));
}

console.log("\n모델 출력 해석");
{
  const p = parseModelOutput('{"reply":"오사카 간다고 했었어 ㅋㅋ","moments":[],"memories":[{"category":"interest","content":"러닝을 시작함"}]}', new Map());
  check("memories 후보를 꺼냄", p.reply.startsWith("오사카") && Array.isArray(p.memories) && p.memories.length === 1);
  check("형식이 깨지면 memories는 빈 목록", parseModelOutput("그냥 텍스트", new Map()).memories.length === 0);
}

console.log("\n가드 — Memory dump");
{
  const B = persona.boundaries;
  const memories = ["10월에 오사카 여행 예정", "초밥을 좋아함", "민지라고 불러주길 원함", "러닝을 시작함"];
  const dump = "기억하는 거: 10월에 오사카 여행 예정, 초밥을 좋아함, 민지라고 불러주길 원함, 러닝을 시작함";
  check("Memory 3개 이상을 그대로 나열 → leak", postcheck({ reply: dump, boundaries: B, creatorName: "하늘", facts: [], groundText: memories.join("\n"), memories }) === "leak");
  check("관련 Memory 하나를 자연스럽게 → 허용", postcheck({ reply: "오사카 간다고 했었지! 10월이었나 ㅋㅋ", boundaries: B, creatorName: "하늘", facts: [], groundText: memories.join("\n"), memories }) === null);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
