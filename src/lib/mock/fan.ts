import type { ChatThread, FanMemoryItem, FanUser } from "@/lib/types";
import { daysAgoDate, minutesAgo } from "@/lib/utils/format";
import { avatar } from "./images";

/** 로그인한 팬 (Mock) */
export const currentFan: FanUser = {
  id: "f1",
  nickname: "새벽산책",
  handle: "dawn.walk",
  avatarUrl: avatar(5),
  joinedAt: "2026-03-14",
  subscriptions: [
    { creatorId: "c1", tier: "premium", since: "2026-04-02", renewsAt: "2026-10-02" },
    { creatorId: "c3", tier: "subscriber", since: "2026-06-18", renewsAt: "2026-10-18" },
    { creatorId: "c2", tier: "subscriber", since: "2026-07-01", renewsAt: "2026-10-01" },
    { creatorId: "c5", tier: "follow", since: "2026-05-20" },
    { creatorId: "c4", tier: "follow", since: "2026-08-11" },
    { creatorId: "c8", tier: "follow", since: "2026-09-01" },
  ],
  savedMomentIds: ["m101", "m303", "m501"],
};

/** Creator AI가 이 팬에 대해 기억하는 것 — 팬이 직접 보고 지울 수 있다 */
export const fanMemory: FanMemoryItem[] = [
  { id: "fm1", creatorId: "c1", category: "호칭", content: "'새벽'이라고 불러주는 걸 좋아해요", createdAt: daysAgoDate(40) },
  { id: "fm2", creatorId: "c1", category: "관심사", content: "필름 카메라 입문 중 (Pentax MX)", createdAt: daysAgoDate(21) },
  { id: "fm3", creatorId: "c1", category: "기억할 일", content: "10월에 강릉 여행 계획", createdAt: daysAgoDate(6) },
  { id: "fm4", creatorId: "c1", category: "대화 요약", content: "아침 산책 루틴과 한강 사진에 대해 자주 이야기함", createdAt: daysAgoDate(2) },
  { id: "fm5", creatorId: "c3", category: "관심사", content: "성인 발레 클래스 3개월 차", createdAt: daysAgoDate(12) },
  { id: "fm6", creatorId: "c2", category: "대화 요약", content: "EP 수록곡 중 '새벽 두 시'를 가장 좋아함", createdAt: daysAgoDate(4) },
];

/** 요청 시점 기준으로 만든다 (시각이 오늘의 Moment와 어긋나지 않도록) */
export function buildChatThreads(): ChatThread[] {
  return [
  {
    id: "t1",
    creatorId: "c1",
    fanId: "f1",
    unread: 1,
    messages: [
      { id: "t1-1", sender: "system", text: "하린의 오늘을 기반으로 대화를 시작했어요", createdAt: minutesAgo(740) },
      { id: "t1-2", sender: "fan", text: "오늘 한강 사진 진짜 좋았어요! 어떻게 찍으신 거예요?", createdAt: minutesAgo(738) },
      {
        id: "t1-3",
        sender: "ai",
        text: "오늘 첫 컷 찍으러 나갔을 때였어요. 물빛이 유난히 파래서 한참 서 있었거든요. 새벽님도 산책 좋아하시잖아요 — 요즘도 걷고 계세요?",
        createdAt: minutesAgo(738),
        refMomentIds: ["m101"],
      },
      { id: "t1-4", sender: "fan", text: "네! 요즘은 필름 카메라 들고 나가요 ㅎㅎ", createdAt: minutesAgo(735) },
      {
        id: "t1-5",
        sender: "ai",
        text: "Pentax MX 들고요? 빛이 약할 땐 셔터 스피드를 한 칸만 느리게 가져가 보세요. 오늘 제가 찍은 첫 컷도 그렇게 찍었어요.",
        createdAt: minutesAgo(735),
        refMomentIds: ["m101"],
      },
      { id: "t1-6", sender: "system", text: "하린님이 직접 대화에 참여했습니다", createdAt: minutesAgo(21) },
      {
        id: "t1-7",
        sender: "creator",
        text: "새벽님! 필름 시작하셨다니 너무 반가워요. 첫 롤 현상하면 꼭 보여주세요 :)",
        createdAt: minutesAgo(20),
      },
    ],
  },
  {
    id: "t2",
    creatorId: "c3",
    fanId: "f1",
    unread: 0,
    messages: [
      { id: "t2-1", sender: "fan", text: "리허설 첫날 어떠셨어요?", createdAt: minutesAgo(400) },
      {
        id: "t2-2",
        sender: "ai",
        text: "긴장보다 설렘이 조금 더 컸어요. 쉬는 시간에 무대 뒤를 찍어뒀는데, 그 공기가 제일 좋아요.",
        createdAt: minutesAgo(400),
        refMomentIds: ["m302", "m303"],
      },
    ],
  },
  {
    id: "t3",
    creatorId: "c2",
    fanId: "f1",
    unread: 0,
    messages: [
      { id: "t3-1", sender: "fan", text: "새벽 두 시 가사 살아남았어요?", createdAt: minutesAgo(460) },
      {
        id: "t3-2",
        sender: "ai",
        text: "아직은요! 오늘 오전에 브릿지 멜로디도 녹음해뒀어요. 가사가 그 위에 잘 붙을지는 저도 궁금해요.",
        createdAt: minutesAgo(460),
        refMomentIds: ["m201", "m202"],
      },
    ],
  },
];
}
