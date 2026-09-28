/**
 * Safe Delay (v0.8) — 크리에이터 본인 세션으로만 (RLS: creator_safety_settings는 본인만. 팬은 설정을 알 수 없다).
 *
 * 공개 시각(visible_at)은 DB가 저장 순간 서버 시각 + 이 설정으로 정한다 — 앱 · 타이머가 정하지 않는다.
 * 설정을 바꿔도 이미 공개 예정인 Moment는 그대로. "지금 공개"만 앞당길 수 있다 (publish_moment_now).
 */
import { supabase } from "@/lib/supabase/client";
import { notifyMomentsChanged } from "./backends/moments.supabase";
import { toServiceError } from "./errors";

export type SafeDelayMode = "off" | "fixed" | "variable";
export const SAFE_DELAY_MINUTES = [15, 30, 60, 120] as const;
export type SafeDelayMinutes = (typeof SAFE_DELAY_MINUTES)[number];

export interface SafeDelaySettings {
  mode: SafeDelayMode;
  minutes: SafeDelayMinutes;
}

export const DEFAULT_SAFE_DELAY: SafeDelaySettings = { mode: "off", minutes: 30 };

export async function getSafeDelay(creatorId: string): Promise<SafeDelaySettings> {
  const { data, error } = await supabase().from("creator_safety_settings").select("safe_delay_mode, safe_delay_minutes").eq("creator_id", creatorId).maybeSingle();
  if (error) throw toServiceError(error, "Safe Delay 설정을 불러오지 못했어요.");
  return data ? { mode: data.safe_delay_mode as SafeDelayMode, minutes: data.safe_delay_minutes as SafeDelayMinutes } : DEFAULT_SAFE_DELAY;
}

/** 저장 (update → 없으면 insert — creator_id는 바꿀 수 없는 컬럼이라 upsert 대신) */
export async function saveSafeDelay(creatorId: string, s: SafeDelaySettings): Promise<void> {
  const sb = supabase();
  const row = { safe_delay_mode: s.mode, safe_delay_minutes: s.minutes };
  const { data, error } = await sb.from("creator_safety_settings").update(row).eq("creator_id", creatorId).select("creator_id");
  if (error) throw toServiceError(error, "Safe Delay 설정을 저장하지 못했어요.");
  if (data?.length) return;
  const { error: insErr } = await sb.from("creator_safety_settings").insert({ creator_id: creatorId, ...row });
  if (insErr) throw toServiceError(insErr, "Safe Delay 설정을 저장하지 못했어요.");
}

/** 공개 예정 Moment를 지금 공개 (크리에이터 본인만 — DB가 확인) */
export async function publishMomentNow(momentId: string): Promise<void> {
  const { error } = await supabase().rpc("publish_moment_now", { p_moment_id: momentId });
  if (error) throw toServiceError(error, "지금 공개하지 못했어요.");
  notifyMomentsChanged();
}

/** 공개 예정인지 (크리에이터 화면 전용 — 팬은 visibleAt을 받지 않는다) */
export function isScheduled(visibleAt: string | undefined, nowMs = Date.now()): boolean {
  return !!visibleAt && Date.parse(visibleAt) > nowMs;
}

/** 설정 설명 (크리에이터에게만) */
export function describeSafeDelay(s: SafeDelaySettings): string {
  if (s.mode === "off") return "기록하면 바로 공개돼요.";
  const label = s.minutes >= 60 ? `${s.minutes / 60}시간` : `${s.minutes}분`;
  if (s.mode === "fixed") return `기록한 뒤 ${label} 후에 공개돼요.`;
  const lo = s.minutes / 2;
  const hi = (s.minutes * 3) / 2;
  const fmt = (m: number) => (m >= 60 ? `${Math.round((m / 60) * 10) / 10}시간` : `${m}분`);
  return `기록한 뒤 ${fmt(lo)} ~ ${fmt(hi)} 사이에서 매번 다르게 공개돼요.`;
}
