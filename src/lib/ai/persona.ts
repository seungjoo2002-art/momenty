/**
 * Creator AI (Mock).
 *
 * 원칙
 * - AI는 "오늘 실제로 기록된 Moment" 중 aiContextEnabled=true인 것만 근거로 답한다.
 * - Boundary에 걸리는 질문은 답하지 않는다.
 * - 모든 응답은 UI에서 AI임이 표시된다 (AIMessage).
 *
 * 실제 연동 시: 이 함수 시그니처를 유지한 채 서버 Route Handler(/api/persona)를 호출하도록 교체.
 * API 키는 절대 클라이언트로 내려보내지 않는다.
 */
import type { Creator, Moment } from "@/lib/types";
import { formatTime } from "@/lib/utils/format";

export interface PersonaReply {
  text: string;
  refMomentIds: string[];
  blocked?: boolean;
}

const BOUNDARY_KEYWORDS = ["주소", "어디 살", "숙소", "연애", "남자친구", "여자친구", "전화번호", "만나"];

export async function generatePersonaReply(
  creator: Creator,
  moments: Moment[],
  fanMessage: string,
): Promise<PersonaReply> {
  await new Promise((r) => setTimeout(r, 1100));

  if (BOUNDARY_KEYWORDS.some((k) => fanMessage.includes(k))) {
    return {
      text: `그 이야기는 ${creator.name} 님이 AI에게 맡기지 않은 주제예요. 대신 오늘 있었던 순간들에 대해 이야기해요.`,
      refMomentIds: [],
      blocked: true,
    };
  }

  const usable = moments.filter((m) => m.aiContextEnabled);
  if (usable.length === 0) {
    return {
      text: "오늘은 아직 남긴 순간이 없어서, 오늘 이야기는 조금 이따 해도 될까요? 기록이 생기면 그걸로 이야기할게요.",
      refMomentIds: [],
    };
  }

  const pick = usable[(fanMessage.length * 7) % usable.length];
  const openers = ["음, 그 얘기 들으니까", "맞아요,", "아 그거요!"];
  const opener = openers[fanMessage.length % openers.length];

  return {
    text: `${opener} ${formatTime(pick.createdAt)}쯤이었어요. "${pick.content}" — 그 순간이 오늘 제일 기억에 남아요. 당신의 오늘은 어땠어요?`,
    refMomentIds: [pick.id],
  };
}
