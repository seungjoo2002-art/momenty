import { getOnboardingSample } from "@/lib/services/onboarding";
import { OnboardingCarousel } from "./OnboardingCarousel";

export const dynamic = "force-dynamic";

/** 가입 전 소개 — 그림은 고정 예시 (실제 사용자 데이터가 아니다) */
export default async function OnboardingPage() {
  const { creator, moments } = await getOnboardingSample();
  return <OnboardingCarousel creator={creator} moments={moments} />;
}
