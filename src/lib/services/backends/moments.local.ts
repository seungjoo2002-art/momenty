/**
 * Moment 저장소 — localStorage 구현 (개발용 fallback).
 * Supabase 환경 변수가 없을 때만 쓰인다. 공개범위는 화면에서 구독 등급으로 계산된다(locked 없음).
 *
 * 최초 실행 시 Mock Moment(지난 며칠 + 오늘)를 seed한다. 이미 있으면 다시 만들지 않는다.
 * Mock 크리에이터들은 매일 정해 둔 시각에 Moment를 남긴 것으로 치고, 그 시각이 지난 것만 이어서 채운다.
 */
import { buildMockDay, buildPastMoments } from "@/lib/mock/moments";
import { createChannel, isBrowser, readJSON, writeJSON } from "@/lib/storage/local";
import type { Moment } from "@/lib/types";
import { kstDate } from "@/lib/utils/format";
import type { MomentBackend, MomentQuery } from "./types";

const MOMENTS_KEY = "momenty:moments:v1";
const LIKES_KEY = "momenty:likes:v1";

interface MomentTable {
  /** 처음 seed한 날. 이날의 Mock Moment는 원래 id(m101…)를 쓴다 — 채팅·보관함 Mock이 참조 */
  firstDay: string;
  /** 지운 Mock Moment가 다시 채워지지 않도록 */
  deletedIds: string[];
  moments: Moment[];
}

let cache: MomentTable | null = null;
let lastSync = 0;
const channel = createChannel([MOMENTS_KEY, LIKES_KEY], () => {
  cache = null; // 다른 탭에서 바뀌었다
});

function table(): MomentTable {
  const today = kstDate();
  if (!isBrowser) {
    // 서버 렌더링에는 저장소가 없으므로 seed 데이터를 그대로 보여준다
    return { firstDay: today, deletedIds: [], moments: [...buildPastMoments(), ...buildMockDay(today)] };
  }
  if (cache && Date.now() - lastSync < 60_000) return cache;

  let t = cache ?? readJSON<MomentTable | null>(MOMENTS_KEY, null);
  let changed = false;
  if (!t || !Array.isArray(t.moments) || !t.firstDay) {
    t = { firstDay: today, deletedIds: [], moments: buildPastMoments() };
    changed = true;
  }

  const have = new Set([...t.moments.map((m) => m.id), ...t.deletedIds]);
  const due = buildMockDay(today, today === t.firstDay ? "" : `-${today}`).filter((m) => !have.has(m.id));
  if (due.length) {
    t = { ...t, moments: [...t.moments, ...due] };
    changed = true;
  }

  if (changed) {
    try {
      writeJSON(MOMENTS_KEY, t);
    } catch {
      /* 저장 공간이 부족해도 화면은 보여준다 */
    }
  }
  cache = t;
  lastSync = Date.now();
  return t;
}

function save(t: MomentTable) {
  writeJSON(MOMENTS_KEY, t); // 용량 초과 시 StorageFullError — 캐시는 바꾸지 않는다
  cache = t;
}

function mutate(fn: (t: MomentTable) => MomentTable) {
  save(fn(table()));
  channel.emit();
}

const likedIds = () => readJSON<string[]>(LIKES_KEY, []);

function withLike(m: Moment, liked: string[]): Moment {
  return { ...m, likedByMe: liked.includes(m.id) };
}

function newId() {
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const localMoments: MomentBackend = {
  async list(q: MomentQuery) {
    const liked = likedIds();
    let list = table().moments.filter(
      (m) =>
        (!q.creatorIds || q.creatorIds.includes(m.creatorId)) &&
        (!q.ids || q.ids.includes(m.id)) &&
        (!q.from || m.createdAt >= q.from) &&
        (!q.to || m.createdAt < q.to),
    );
    list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    if (q.order === "desc") list.reverse();
    if (q.limit) list = list.slice(0, q.limit);
    return list.map((m) => withLike(m, liked));
  },

  async get(id) {
    const m = table().moments.find((x) => x.id === id);
    return m && withLike(m, likedIds());
  },

  async create(input) {
    const moment: Moment = {
      ...input,
      id: newId(),
      createdAt: new Date().toISOString(),
      reactions: { love: 0, cheer: 0, touched: 0, smile: 0 },
    };
    mutate((t) => ({ ...t, moments: [...t.moments, moment] }));
    return moment;
  },

  async update(id, patch) {
    let updated: Moment | undefined;
    mutate((t) => ({
      ...t,
      moments: t.moments.map((m) => (m.id === id ? (updated = { ...m, ...patch }) : m)),
    }));
    return updated;
  },

  async remove(id) {
    mutate((t) => ({ ...t, deletedIds: [...t.deletedIds, id], moments: t.moments.filter((m) => m.id !== id) }));
  },

  async toggleLove(id) {
    const liked = likedIds();
    const on = !liked.includes(id);
    writeJSON(LIKES_KEY, on ? [...liked, id] : liked.filter((x) => x !== id));
    mutate((t) => ({
      ...t,
      moments: t.moments.map((m) =>
        m.id === id ? { ...m, reactions: { ...m.reactions, love: Math.max(0, m.reactions.love + (on ? 1 : -1)) } } : m,
      ),
    }));
    return on;
  },

  subscribe: (listener) => channel.subscribe(listener),
};
