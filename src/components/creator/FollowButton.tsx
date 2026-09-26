"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/Button";

/** 무료 팔로우 토글 (프로토타입: 화면 상태만 바뀜) */
export function FollowButton({ initialFollowing }: { initialFollowing: boolean }) {
  const [following, setFollowing] = useState(initialFollowing);
  return (
    <Button variant="secondary" onClick={() => setFollowing(!following)} aria-pressed={following}>
      {following && <Check className="size-4" />}
      {following ? "팔로잉" : "팔로우"}
    </Button>
  );
}
