/**
 * MOMENTY 도메인 타입.
 * Supabase 테이블 스키마로 그대로 옮길 수 있도록 평평한(flat) 구조로 유지한다.
 *
 * Moment → Today → Persona → Human
 *  - Moment: 크리에이터가 원하는 순간 남긴 하나의 기록
 *  - Today: 하루 동안 쌓인 Moment의 모음 (정해진 시간 슬롯 없음)
 *  - Persona: 실제 Moment만을 근거로 대화하는 Creator AI
 *  - Human: 실제 크리에이터 본인의 참여
 */

export type MomentType = "text" | "photo" | "video" | "voice";

/** public: 전체 / subscribers: 구독자 / premium: Premium 구독자 */
export type Visibility = "public" | "subscribers" | "premium";

export type ReactionKey = "love" | "cheer" | "touched" | "smile";
export type Reactions = Record<ReactionKey, number>;

export type SafeShareFlag = "location_delayed" | "location_removed" | "faces_blurred";

export interface Moment {
  id: string;
  creatorId: string;
  type: MomentType;
  /** 텍스트 본문 또는 캡션 */
  content: string;
  /** 사진 · 영상 · 음성 파일 (비공개 Storage는 signed URL) */
  mediaUrl?: string;
  /** 영상 포스터 이미지 */
  posterUrl?: string;
  /** video / voice 길이(초) */
  durationSec?: number;
  /** ISO 8601 */
  createdAt: string;
  visibility: Visibility;
  reactions: Reactions;
  location?: string;
  safeShare?: SafeShareFlag[];
  /** Safe Delay 공개 시각 — DB가 크리에이터 본인에게만 준다 (팬은 받지 않는다). 지금보다 뒤면 "공개 예정" */
  visibleAt?: string;
  /** Creator AI가 이 Moment를 대화 참고 정보로 사용해도 되는지 */
  aiContextEnabled: boolean;
  /**
   * 서버(DB)가 판단한 잠금 여부. true면 content · mediaUrl은 비어서 온다.
   * 없으면(로컬 개발 모드) 구독 등급으로 계산한다 — utils/access.ts isMomentLocked
   */
  locked?: boolean;
  /** 지금 사용자가 ♥를 눌렀는지 */
  likedByMe?: boolean;
}

export type CategoryKey = "photo" | "music" | "dance" | "food" | "art" | "sports" | "books" | "coffee";

export interface Creator {
  id: string;
  /** 이 크리에이터 프로필을 가진 사용자 (profiles.id = auth.uid) */
  profileId: string;
  name: string;
  handle: string;
  job: string;
  category: CategoryKey;
  bio: string;
  avatarUrl: string;
  coverUrl: string;
  followers: number;
  subscribers: number;
  pricing: { subscriber: number; premium: number };
  verified: boolean;
  tags: string[];
  personaEnabled: boolean;
}

/**
 * 지난 하루 (Archive / Records).
 * 따로 저장하지 않고, 같은 날짜(KST)의 Moment를 묶어서 계산한다 — services/moments.ts
 */
export interface DailyRecord {
  /** `${creatorId}-${date}` */
  id: string;
  creatorId: string;
  /** YYYY-MM-DD (KST) */
  date: string;
  /** 그날 반응이 가장 많았던 Moment */
  title: string;
  momentCount: number;
  /** 볼 수 있는 사진·영상이 없으면 비어 있다 */
  coverUrl?: string;
  highlight: string;
  reactionTotal: number;
  /** 그날의 첫 Moment — 상세에서 하루를 차례로 넘겨 본다 */
  firstMomentId: string;
}

/** follow: 무료 팔로우 / subscriber: 구독 / premium: Premium 구독 */
export type Tier = "follow" | "subscriber" | "premium";

export interface FanSubscription {
  creatorId: string;
  tier: Tier;
  since: string;
  renewsAt?: string;
}

/** 로그인한 사용자의 팬 쪽 관계 (비로그인이면 id = "" · 빈 목록) */
export interface FanUser {
  id: string;
  subscriptions: FanSubscription[];
}

/** ai: Creator AI / creator: 실제 크리에이터 본인 / system: 안내 */
export type ChatSender = "fan" | "ai" | "creator" | "system";

export interface ChatMessage {
  id: string;
  sender: ChatSender;
  text: string;
  createdAt: string;
  /** AI 응답이 근거로 삼은 Moment */
  refMomentIds?: string[];
}

export interface ChatThread {
  id: string;
  creatorId: string;
  fanId: string;
  messages: ChatMessage[];
  unread: number;
}

/** Fan Memory — 팬 본인만 보고 지울 수 있다 (크리에이터는 볼 수 없다) */
export interface FanMemoryItem {
  id: string;
  creatorId: string;
  category: import("./fanMemory").MemoryCategory;
  content: string;
  createdAt: string;
}


/** Studio 대시보드의 오늘 요약 */
export interface StudioToday {
  views: number;
  reactions: number;
  /** AI가 정리한 오늘의 팬 반응 요약 (사실 요약만) */
  fanBrief: string;
}

export type AnalyticsPeriod = "today" | "7d" | "30d" | "month";

export interface AnalyticsPeriodData {
  views: number;
  reactions: number;
  newSubscribers: number;
  /** 직전 같은 기간 대비 % */
  deltas: { views: number; reactions: number; newSubscribers: number };
  /** 조회수 추이 */
  series: { label: string; value: number }[];
}

export interface AnalyticsSnapshot {
  periods: Record<AnalyticsPeriod, AnalyticsPeriodData>;
  topMomentIds: string[];
}
