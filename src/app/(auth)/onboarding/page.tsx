import { getCreator } from "@/lib/services/creators";
import { getOnboardingSample } from "@/lib/services/moments";
import { OnboardingCarousel } from "./OnboardingCarousel";

// 크리에이터 정보를 DB에서 읽으므로 빌드 시점이 아니라 요청 시점에 렌더링한다
export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const creator = (await getCreator("c1"))!;
  const moments = await getOnboardingSample();
  return <OnboardingCarousel creator={creator} moments={moments} />;
}
