import { ComingSoon } from "@/components/ui/ComingSoon";

export default function SafeShareSettingsPage() {
  return (
    <ComingSoon
      backHref="/studio/settings"
      title="SafeShare 설정은 준비 중이에요"
      description="지금도 사진의 위치 정보(EXIF)는 올리기 전에 지워져요. 위치 지연 공개 · 얼굴 흐림 설정은 곧 열려요."
    />
  );
}
