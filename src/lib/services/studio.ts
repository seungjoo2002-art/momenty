/**
 * Creator Mode 데이터 접근 레이어.
 */
import { creators } from "@/lib/mock/creators";
import { buildStudioFans, CURRENT_CREATOR_ID, studioAnalytics, studioToday } from "@/lib/mock/studio";
import type { AnalyticsSnapshot, Creator, FanProfile, StudioToday, Tier } from "@/lib/types";

export async function getCurrentCreator(): Promise<Creator> {
  return creators.find((c) => c.id === CURRENT_CREATOR_ID)!;
}

export async function getStudioFans(tier?: Tier): Promise<FanProfile[]> {
  const fans = buildStudioFans();
  return tier ? fans.filter((f) => f.tier === tier) : fans;
}

export async function getStudioFan(id: string): Promise<FanProfile | undefined> {
  return buildStudioFans().find((f) => f.id === id);
}

export async function getAnalytics(): Promise<AnalyticsSnapshot> {
  return studioAnalytics;
}

export async function getStudioToday(): Promise<StudioToday> {
  return studioToday;
}
