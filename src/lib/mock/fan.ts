import type { FanSubscription } from "@/lib/types";
import { avatar } from "./images";

/**
 * seed 전용 데모 팬 (npm run db:seed). 앱 화면은 이 값을 읽지 않는다.
 * 유료 등급(subscriber · premium)은 결제 연동 전 권한 테스트용 — seed(service role)만 만들 수 있다.
 */
export const demoFan: { nickname: string; handle: string; avatarUrl: string; subscriptions: FanSubscription[] } = {
  nickname: "새벽산책",
  handle: "dawn.walk",
  avatarUrl: avatar(5),
  subscriptions: [
    { creatorId: "c1", tier: "premium", since: "2026-04-02", renewsAt: "2026-10-02" },
    { creatorId: "c3", tier: "subscriber", since: "2026-06-18", renewsAt: "2026-10-18" },
    { creatorId: "c2", tier: "subscriber", since: "2026-07-01", renewsAt: "2026-10-01" },
    { creatorId: "c5", tier: "follow", since: "2026-05-20" },
    { creatorId: "c4", tier: "follow", since: "2026-08-11" },
    { creatorId: "c8", tier: "follow", since: "2026-09-01" },
  ],
};
