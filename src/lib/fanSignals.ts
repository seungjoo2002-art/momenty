/**
 * Fan Manager 신호 → 화면 문장. 관찰된 사실과 이유만 그대로 쓴다.
 * "관심 높은 팬", "충성 팬", "이탈 위험", "소홀함을 느낌" 같은 추론 · 평가 · 감정 표현은 쓰지 않는다 (memory.unit 테스트가 확인).
 */
import type { ManagedFan } from "@/lib/services/fanManager";

const DAY = 86_400_000;
export const daysSince = (iso: string, nowMs: number) => Math.max(0, Math.floor((nowMs - Date.parse(iso)) / DAY));

function ago(iso: string, nowMs: number) {
  const min = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
  if (min < 60) return min <= 1 ? "방금" : `${min}분 전`;
  if (min < 60 * 24) return `${Math.floor(min / 60)}시간 전`;
  return `${Math.floor(min / (60 * 24))}일 전`;
}

/** "오늘 확인할 팬"의 이유 — 규칙 순서대로 */
export function signalReasons(f: ManagedFan, nowMs: number): string[] {
  return f.signals.map((s) => {
    switch (s) {
      case "UNREPLIED_FAN_MESSAGE":
        return `팬이 보낸 직접 메시지에 아직 답하지 않았어요 · ${f.lastFanMessageAt ? ago(f.lastFanMessageAt, nowMs) : ""}`.replace(/ · $/, "");
      case "IMPORTANT_DATE": {
        const d = f.importantDate;
        return d ? `팬이 공유한 날: ${d.content} · ${d.daysUntil === 0 ? "오늘" : `${d.daysUntil}일 뒤`}` : "팬이 공유한 날이 다가와요.";
      }
      case "NEW_SUBSCRIBER":
        return !f.subscribedDays ? "오늘 구독을 시작했어요." : `구독한 지 ${f.subscribedDays}일 됐어요.`;
      case "RECENT_REACTIONS":
        return `최근 Moment ${f.recentMoments}개 중 ${f.recentReacted}개에 반응했어요.`;
      case "LONG_TIME_SINCE_HUMAN":
        return `마지막 직접 대화가 ${f.lastCreatorMessageAt ? daysSince(f.lastCreatorMessageAt, nowMs) : "?"}일 전이에요.`;
      case "NO_HUMAN_REPLY":
        return "구독 후 아직 직접 대화한 적이 없어요.";
    }
  });
}

/** 전체 팬 목록 한 줄 요약 — 사실만 */
export function fanFacts(f: ManagedFan, nowMs: number): string {
  const parts: string[] = [];
  if (f.subscribedDays != null) parts.push(`구독 ${f.subscribedDays}일`);
  if (f.reactions30d > 0) parts.push(`최근 30일 반응 ${f.reactions30d}회`);
  parts.push(f.lastCreatorMessageAt ? `마지막 직접 대화 ${ago(f.lastCreatorMessageAt, nowMs)}` : "직접 대화 없음");
  return parts.join(" · ");
}

/** 상세 화면의 반응 요약 문장 */
export function reactionSummary(f: ManagedFan, nowMs: number): string {
  if (!f.recentMoments) return "아직 남긴 Moment가 없어요.";
  const base = `최근 Moment ${f.recentMoments}개 중 ${f.recentReacted}개에 반응했어요.`;
  if (!f.reactions30d) return `${base} 최근 30일 반응은 없어요.`;
  return `${base} 최근 30일 반응 ${f.reactions30d}회${f.lastReactionAt ? ` · 마지막 반응 ${ago(f.lastReactionAt, nowMs)}` : ""}.`;
}
