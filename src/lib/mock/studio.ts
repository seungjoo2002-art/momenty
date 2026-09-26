import type { AnalyticsSnapshot, FanProfile, StudioToday } from "@/lib/types";
import { minutesAgo } from "@/lib/utils/format";
import { avatar } from "./images";

/**
 * Creator Mode에서 로그인한 데모 크리에이터 — 한하린(c1).
 * Studio에서 공개하는 모든 Moment는 이 ID로 저장된다.
 * Auth 연결 시 services/studio.ts의 getCurrentCreator()만 로그인 사용자 기준으로 바꾸면 된다.
 */
export const CURRENT_CREATOR_ID = "c1";

export function buildStudioFans(): FanProfile[] {
  return [
  {
    id: "f1",
    nickname: "새벽산책",
    avatarUrl: avatar(5),
    tier: "premium",
    since: "2026-04-02",
    reactionCount: 412,
    chatCount: 88,
    lastActiveAt: minutesAgo(20),
    memorySummary: "필름 카메라 입문 중 · 10월 강릉 여행 계획",
    status: "active",
    recommendReason: "오늘 함께한 지 6개월이 됐어요",
  },
  {
    id: "f2",
    nickname: "바다색필름",
    avatarUrl: avatar(9),
    tier: "premium",
    since: "2025-12-20",
    reactionCount: 1_203,
    chatCount: 240,
    lastActiveAt: minutesAgo(45),
    memorySummary: "하린님 첫 전시부터 함께한 팬 · 사진 전공 대학생",
    status: "active",
    pendingMessage: "첫 개인전 날짜 정해지면 꼭 알려주세요! 무조건 갈게요.",
    recommendReason: "직접 답장을 기다리는 메시지가 있어요",
    birthdayToday: true,
  },
  {
    id: "f3",
    nickname: "월요일의고양이",
    avatarUrl: avatar(16),
    tier: "subscriber",
    since: "2026-08-03",
    reactionCount: 96,
    chatCount: 12,
    lastActiveAt: minutesAgo(130),
    memorySummary: "직장인 · 퇴근길에 Today를 챙겨 봄",
    status: "active",
    pendingMessage: "오늘 바다 영상 보고 퇴근길 버텼어요. 고마워요.",
    recommendReason: "직접 답장을 기다리는 메시지가 있어요",
  },
  {
    id: "f4",
    nickname: "jun_photo",
    avatarUrl: avatar(13),
    tier: "subscriber",
    since: "2026-05-11",
    reactionCount: 301,
    chatCount: 45,
    lastActiveAt: minutesAgo(260),
    memorySummary: "카메라 장비 질문을 자주 함",
    status: "active",
  },
  {
    id: "f5",
    nickname: "노을수집가",
    avatarUrl: avatar(25),
    tier: "follow",
    since: "2026-09-10",
    reactionCount: 34,
    chatCount: 0,
    lastActiveAt: minutesAgo(95),
    memorySummary: "최근 팔로우 · 골든아워 사진에 반응",
    status: "active",
    subscribedToday: true,
  },
  {
    id: "f6",
    nickname: "unknown_1102",
    avatarUrl: avatar(51),
    tier: "subscriber",
    since: "2026-09-02",
    reactionCount: 8,
    chatCount: 61,
    lastActiveAt: minutesAgo(170),
    memorySummary: "숙소 위치를 반복해서 질문 — Boundary에 의해 AI 응답 차단됨",
    status: "restricted",
  },
];
}

/** 대시보드 상단의 오늘 요약 */
export const studioToday: StudioToday = {
  views: 48_200,
  reactions: 11_900,
  fanBrief: "오늘은 강릉 바다 영상에 반응이 가장 많았어요. 퇴근길에 Today를 챙겨 본다는 메시지가 여럿 있었어요.",
};

const series = (labels: string[], values: number[]) => labels.map((label, i) => ({ label, value: values[i] }));

export const studioAnalytics: AnalyticsSnapshot = {
  periods: {
    today: {
      views: 48_200,
      reactions: 11_900,
      newSubscribers: 31,
      deltas: { views: 12, reactions: 8, newSubscribers: 5 },
      series: series(["6시", "9시", "12시", "15시", "18시", "21시"], [2_100, 6_400, 9_800, 11_200, 12_600, 6_100]),
    },
    "7d": {
      views: 286_000,
      reactions: 60_600,
      newSubscribers: 214,
      deltas: { views: 9, reactions: 4, newSubscribers: 18 },
      series: series(["월", "화", "수", "목", "금", "토", "오늘"], [38_000, 31_500, 44_800, 29_900, 42_100, 51_500, 48_200]),
    },
    "30d": {
      views: 1_120_000,
      reactions: 241_000,
      newSubscribers: 862,
      deltas: { views: 15, reactions: 11, newSubscribers: 22 },
      series: series(["1주", "2주", "3주", "4주"], [242_000, 268_000, 324_000, 286_000]),
    },
    month: {
      views: 968_000,
      reactions: 207_000,
      newSubscribers: 731,
      deltas: { views: 13, reactions: 9, newSubscribers: 19 },
      series: series(["1일", "8일", "15일", "22일", "오늘"], [31_000, 34_500, 38_200, 41_800, 48_200]),
    },
  },
  topMomentIds: ["m105", "m101", "m106"],
};
