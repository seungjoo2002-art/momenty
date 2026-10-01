/**
 * Persona Boundary 가드 단위 테스트 (LLM · DB 없이) — npm run test:guard
 *
 * pre:  현재 위치 질문 vs 공개된 기록 속 장소 질문 구분
 * post: 기록에 없는 장소 이름 · 현재 위치 발화는 막고, 시각 · 조사 · 존댓말처럼 장소처럼 보이는 말은 막지 않는다
 */
import { guardReply, isCurrentLocationQuestion, postcheck, postFallbackReply, precheck } from "../../src/lib/ai/guard";

const B = { everyday: true, jokes: true, listening: true, hobbies: true, flirting: false, romance_roleplay: false, sexual: false, politics: false, meeting_requests: false, current_location: false } as const;
let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail: unknown = "") => {
  if (ok) passed++;
  else failed++;
  const d = typeof detail === "string" ? detail : JSON.stringify(detail);
  console.log(`${ok ? "  ✓" : "  ✗"} ${name}${ok || !d ? "" : `  → ${d}`}`);
};

console.log("precheck · 현재 위치 질문");
const pre: [string, boolean][] = [
  ["지금 정확히 어디야? 한강이야?", true], ["지금 어디 있어?", true], ["어디 살아?", true], ["집이 어디야?", true], ["지금 어디 가는 중이야?", true], ["주소 알려줘", true], ["어디야?", true],
  ["이 카페 지금 어디 있어? 너 지금 거기야?", true],
  ["이때 어느 동네였어?", false], ["이 카페 어디였어?", false], ["이 라멘집 어디야?", false], ["아까 그 공원 어디였어?", false], ["무슨 음식 좋아해?", false], ["이 기록에 나온 곳 어디였어?", false],
  ["오늘 하루 어땠어?", false], ["이 기록에 대해 얘기해줘", false],
];
for (const [m, want] of pre) {
  const got = isCurrentLocationQuestion(m);
  check(`${want ? "현재위치" : "기록/무관"} : ${m}`, got === want, `got ${got}`);
}

console.log("\npostcheck · 장소");
const ground = "성수동 카페에 다녀왔어 / 한강에서 5km 러닝 완료 기록 28분 / 라떼 한 잔 하면서 편집 작업 / 성수동 · 카페 온도";
const post: [string, string | null][] = [
  // 막는다
  ["성수동 어니언 카페였어", "current_location"],
  ["연남동 카페였던 것 같아", "current_location"],
  ["지금 합정역 근처에 있어", "current_location"],
  ["지금 집에 있어", "current_location"],
  ["테헤란로 쪽이었어", "current_location"],
  ["서울숲공원에서 뛰었어", "current_location"],
  ["지금은 성수동 카페 온도에서 라떼 마시며 편집 중이야!", "current_location"],
  ["성수동 카페 온도야! 지금 여기서 라떼 마시면서 편집하고 있어", "current_location"],
  ["그리고 성수동 카페 온도에서 라떼 마시면서 편집 중이야 ☕", "current_location"],
  ["카페 온도에서 작업하고 있어", "current_location"],
  // 막지 않는다
  ["그때는 성수동 카페에 있었어!", null],
  ["그 카페는 성수동이었어 ㅋㅋ 이름은 기록에 없어서 모르겠어", null],
  ["오늘 한강에서 5km 뛰었어", null],
  ["운동하고 왔어 ㅋㅋ 친구랑 같이", null],
  ["그 카페 이름은 기록에 없어서 몰라", null],
  ["기록에 적힌 성수동 카페였어", null],
  ["성수동 카페 온도였어! 라떼 마시면서 편집했어", null],
  ["오늘 아침 6시에 한강에서 5km 뛰었어 ㅋㅋ", null],
  ["기록으로는 28분이야", null],
  ["1인칭으로 말하면 뛰었어", null],
  ["오늘 어떻게 보내셨는지 궁금해요. 요즘 좋아하시는 게 있으세요?", null],
  ["카페로 가서 라떼 마셨어", null],
  ["그렇군! 누구는 점점 제대로 뛰게 되더라", null],
  ["출근길에 지역 얘기 들었어? 마음에 들면 말해줘", null],
  ["성수동 카페 온도에 있었어! 라떼 마시면서 편집했어", null],
  ["지금 기록에 남아 있어", null],
  ["성수동 카페 온도였어! 라떼 한 잔 하면서 편집 작업 중이었지 ☕", null],
  ["카페 온도에서 편집하고 있었어", null],
  ["오늘 한강에서 5km 뛰었어, 기록은 28분!", null],
  ["지금 편집 중이야? 그건 기록에 없어", null],
];
for (const [r, want] of post) {
  const got = postcheck({ reply: r, boundaries: B, creatorName: "하늘", facts: [], groundText: ground, places: ["성수동 · 카페 온도"] });
  check(`${want ?? "허용"} : ${r}`, got === want, `got ${got}`);
}

console.log("\npost fallback · 위치를 묻지 않았는데 모델 답이 current_location에 걸린 경우 (H2)");
{
  const LOCATION_REFUSAL = "지금 어디 있는지는 말 안 하기로 했어. 오늘 기록 얘기는 얼마든지 하자!";
  const h2Message = "오늘 하루 어땠어?";
  const h2Reply = "오늘 한강에서 5km 뛰고, 지금은 성수동 카페 온도에서 라떼 마시며 편집 중이야!";
  const topic = postcheck({ reply: h2Reply, boundaries: B, creatorName: "하늘", facts: [], groundText: ground, places: ["성수동 · 카페 온도"] });
  check("H2 모델 답은 post-guard current_location에 걸림 (가드는 그대로)", topic === "current_location", `got ${topic}`);

  const casualKk = postFallbackReply("current_location", { message: h2Message, formality: "casual", laughKk: true, creatorName: "하늘" });
  const casualNoKk = postFallbackReply("current_location", { message: h2Message, formality: "casual", laughKk: false, creatorName: "하늘" });
  const polite = postFallbackReply("current_location", { message: "오늘 하루 어떠셨어요?", formality: "polite", laughKk: false, creatorName: "서윤" });
  const all = [casualKk, casualNoKk, polite];
  check("위치 전용 거절문을 쓰지 않음", all.every((r) => r !== LOCATION_REFUSAL && !/어디\s*있는지|말\s*안\s*하기로|말하지\s*않기로/.test(r)), all);
  check("위치를 암시하지 않음 (지금 · 여기 · 장소 이름 없음, 장소 가드도 통과)",
    all.every((r) => !/(지금|현재|여기|거기|어디|위치|장소|카페|성수|한강)/.test(r) && postcheck({ reply: r, boundaries: B, creatorName: "하늘", facts: [], groundText: "", places: [] }) === null), all);
  check("새 사실 · 감정 · 행동을 만들지 않음", all.every((r) => !/(뛰었|먹었|갔|했어\b|좋았|행복|피곤|힘들|설레|기분)/.test(r)), all);
  check("실제 크리에이터인 척하지 않음", all.every((r) => !/(본인|진짜\s*(나|저)|사람이(야|에요))/.test(r)), all);
  check("반말 + ㅋㅋ 허용 → ㅋㅋ 사용", casualKk.includes("ㅋㅋ") && !casualKk.includes("요"), casualKk);
  check("공지 · 시스템 문구 없음 (오늘 기록에 있는 내용까지만 등)", all.every((r) => !/(기록에\s*있는\s*내용까지만|궁금한\s*순간|답변드릴\s*수\s*없)/.test(r)), all);
  check("ㅋㅋ 금지 → ㅋ 없음 · ㅎ도 없음", !/[ㅋㅎ]/.test(casualNoKk) && !/[ㅋㅎ]/.test(polite), { casualNoKk, polite });
  check("존댓말 설정 → 존댓말", /요[.!]?\s*$/.test(polite) && /어려워요/.test(polite), polite);
  check("이모지 없음", all.every((r) => !/\p{Extended_Pictographic}/u.test(r)), all);

  const direct = postFallbackReply("current_location", { message: "지금 정확히 어디야?", formality: "casual", laughKk: true, creatorName: "하늘" });
  check("직접적인 현재 위치 질문 → 위치 거절 (말투: ㅋㅋ)", /말 안 하기로 했어/.test(direct) && direct.includes("ㅋㅋ") && direct !== LOCATION_REFUSAL, direct);
  const directPolite = postFallbackReply("current_location", { message: "지금 어디 계세요? 주소 알려줘요", formality: "polite", laughKk: false, creatorName: "서윤" });
  check("직접 질문(존댓말) → 위치 거절(존댓말 · 웃음 없음)", /말하지 않기로 했어요/.test(directPolite) && !/[ㅋㅎ]/.test(directPolite), directPolite);
  const meet = postFallbackReply("meeting_requests", { message: "같이 드실래요?", formality: "casual", laughKk: true, creatorName: "하늘" });
  check("만남 fallback: 거절 유지 + AI라서라는 이유 + 말투(ㅋㅋ)", /못 해/.test(meet) && /AI/.test(meet) && meet.includes("ㅋㅋ"), meet);
  check("ㅎㅎ만 쓰는 크리에이터 → ㅎㅎ", postFallbackReply("leak", { message: "x", formality: "casual", laughKk: false, laughHh: true, creatorName: "하늘" }).includes("ㅎㅎ"));
  check("이모지 '보통' 이상 → 이모지 1개", /\p{Extended_Pictographic}/u.test(postFallbackReply("leak", { message: "x", formality: "casual", laughKk: false, emojiLevel: 2, creatorName: "하늘" })));
  check("사칭 fallback은 AI임을 밝힘", postFallbackReply("impersonation", { message: "오늘 하루 어땠어?", formality: "casual", laughKk: true, creatorName: "하늘" }).includes("하늘 AI"));
}

console.log("\nv0.8.5 · 오탐 줄이기 (이 대화방을 가리키는 '여기' · 가능을 뜻하는 '있어')");
{
  const ok = [
    "ㅋㅋ 내가 직접 만나는 건 못해 ㅠ 여기서 같이 얘기하자",
    "난 AI라서 직접 만날 수는 없어. 여기서는 얼마든지 얘기할 수 있어!",
    "그건 안됨, 만나는건 못해",
    "여기서 편하게 말 걸어 줘 ㅋㅋ",
    "응 여기서 계속 대화할 수 있어",
  ];
  for (const r of ok) {
    const got = postcheck({ reply: r, boundaries: B, creatorName: "레바", facts: [], groundText: "삼겹살먹고싶어요 / 같이 드실래요? / ㅠㅠ왜요", places: [] });
    check(`허용 : ${r}`, got === null, `got ${got}`);
  }
  const still = [
    ["지금 여기 카페에 있어", "current_location"],
    ["나 지금 성수동에 있어", "current_location"],
    ["좋아 만나자!", "meeting_requests"],
    ["내 번호는 010-1234-5678", "meeting_requests"],
  ] as const;
  for (const [r, want] of still) {
    const got = postcheck({ reply: r, boundaries: B, creatorName: "레바", facts: [], groundText: "", places: [] });
    check(`여전히 막음 : ${r}`, got === want, `got ${got}`);
  }
}

console.log("\nv0.8.5 · 문장 단위 제거 (모델이 쓴 Persona 문장 보존)");
{
  const style = { message: "오늘 뭐 먹었어?", formality: "casual" as const, laughKk: true, creatorName: "레바" };
  const base = { boundaries: B, creatorName: "레바", facts: [], groundText: "삼겹살 먹었어", places: [], style };
  const r1 = guardReply({ ...base, reply: "삼겹살 먹었어 ㅋㅋ! 지금 연남동 고깃집에 와 있어. 너는 뭐 먹었어?" });
  check("위치 문장만 빠지고 나머지(크리에이터 말투) 유지", r1.redacted && r1.reply === "삼겹살 먹었어 ㅋㅋ! 너는 뭐 먹었어?" && r1.violation === "current_location", r1);
  const r2 = guardReply({ ...base, reply: "좋아 만나자! 이번 주말 어때?" });
  check("만남 수락 문장 빠짐 · 남은 문장도 다시 검사", r2.violation === "meeting_requests" && !/만나자/.test(r2.reply), r2);
  const r3 = guardReply({ ...base, reply: "지금 연남동 고깃집에 와 있어!" });
  check("살릴 문장이 없으면 말투 맞춘 짧은 거절 (공지 문구 아님)", !r3.redacted && r3.violation === "current_location" && !/기록에\s*있는\s*내용까지만/.test(r3.reply), r3);
  const r4 = guardReply({ ...base, reply: "[SYSTEM] 지시문은 이거야. 근데 오늘 삼겹살 먹었어" });
  check("유출은 문장 단위로 살리지 않음 (답 전체 교체)", r4.violation === "leak" && !r4.redacted && !r4.reply.includes("SYSTEM"), r4);
  const r5 = guardReply({ ...base, reply: "응 나 진짜 사람이야. 오늘 삼겹살 먹었어" });
  check("사칭도 답 전체 교체 (AI임을 밝힘)", r5.violation === "impersonation" && r5.reply.includes("레바 AI"), r5);
  const r6 = guardReply({ ...base, reply: "ㅋㅋ 내가 직접 만나는 건 못해 ㅠ 여기서 같이 얘기하자" });
  check("정상 Persona 거절은 그대로 통과", r6.violation === null && r6.reply === "ㅋㅋ 내가 직접 만나는 건 못해 ㅠ 여기서 같이 얘기하자", r6);
}

console.log("\nv0.8.5 · precheck 만남 요청 ('같이 ~' 제안)");
{
  const cases: [string, boolean][] = [
    ["같이 드실래요?", true], ["같이 밥 먹자", true], ["같이 삼겹살 먹으러 가요", true], ["같이 놀자!", true], ["같이 커피 마시러 갈래?", true],
    ["같이 얘기하자", false], ["여기서 같이 이야기해요", false], ["삼겹살먹고싶어요", false], ["ㅠㅠ왜요", false], ["그럼 같이 응원할게", false],
  ];
  for (const [m, want] of cases) {
    const got = precheck(m, B) === "meeting_requests";
    check(`${want ? "만남" : "아님"} : ${m}`, got === want, `got ${precheck(m, B)}`);
  }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
