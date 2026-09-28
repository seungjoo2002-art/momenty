/**
 * Fan Memory (팬 쪽) — My > AI Memory.
 *
 * 팬 본인 세션으로만 (RLS: fan_ai_settings · fan_memories는 팬 본인만. 크리에이터는 읽을 수 없다).
 * 팬이 할 수 있는 것: Memory ON/OFF · 보기 · 개별 삭제 · 크리에이터별 삭제 · 전체 삭제.
 * 새 Memory를 만드는 것은 서버(/api/ai/chat → record_fan_memories)뿐이다 — 팬도 직접 쓰거나 고칠 수 없다.
 * OFF로 바꿔도 기존 Memory는 지우지 않는다 (AI가 쓰지 않을 뿐). 지우는 것은 팬이 직접.
 */
import { currentUserId, supabase } from "@/lib/supabase/client";
import type { FanMemoryItem } from "@/lib/types";
import { ServiceError, toServiceError } from "./errors";

export interface FanMemoryState {
  /** 기본 OFF — 팬이 켜야 기억한다 */
  enabled: boolean;
  items: FanMemoryItem[];
}

interface MemoryRow {
  id: string;
  creator_id: string;
  category: FanMemoryItem["category"];
  content: string;
  created_at: string;
}

async function requireUser() {
  const uid = await currentUserId();
  if (!uid) throw new ServiceError("로그인이 필요해요.", "auth");
  return uid;
}

export async function getFanMemoryState(): Promise<FanMemoryState> {
  try {
    const uid = await requireUser();
    const sb = supabase();
    const [settings, memories] = await Promise.all([
      sb.from("fan_ai_settings").select("memory_enabled").eq("fan_id", uid).maybeSingle(),
      sb.from("fan_memories").select("id, creator_id, category, content, created_at").eq("fan_id", uid).order("created_at", { ascending: false }),
    ]);
    if (settings.error) throw settings.error;
    if (memories.error) throw memories.error;
    return {
      enabled: settings.data?.memory_enabled === true,
      items: ((memories.data ?? []) as MemoryRow[]).map((r) => ({ id: r.id, creatorId: r.creator_id, category: r.category, content: r.content, createdAt: r.created_at })),
    };
  } catch (e) {
    throw toServiceError(e, "AI Memory를 불러오지 못했어요.");
  }
}

/** ON/OFF — 행이 없으면 만든다 (update → 없으면 insert) */
export async function setFanMemoryEnabled(on: boolean): Promise<void> {
  try {
    const uid = await requireUser();
    const sb = supabase();
    const { data, error } = await sb.from("fan_ai_settings").update({ memory_enabled: on }).eq("fan_id", uid).select("fan_id");
    if (error) throw error;
    if (data?.length) return;
    const { error: insErr } = await sb.from("fan_ai_settings").insert({ fan_id: uid, memory_enabled: on });
    if (insErr) throw insErr;
  } catch (e) {
    throw toServiceError(e, "설정을 저장하지 못했어요.");
  }
}

/** 삭제: 하나 · 한 크리에이터 AI의 것 전부 · 전체 */
export async function deleteFanMemories(target: { id: string } | { creatorId: string } | "all"): Promise<number> {
  try {
    const uid = await requireUser();
    let q = supabase().from("fan_memories").delete().eq("fan_id", uid);
    if (target !== "all") q = "id" in target ? q.eq("id", target.id) : q.eq("creator_id", target.creatorId);
    const { data, error } = await q.select("id");
    if (error) throw error;
    return data?.length ?? 0;
  } catch (e) {
    throw toServiceError(e, "지우지 못했어요.");
  }
}
