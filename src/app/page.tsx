"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import { nextPathFor } from "@/lib/services/auth";

/** 첫 화면: 로그인했으면 이어서 하던 곳으로, 아니면 소개 화면으로 */
export default function Home() {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "signedIn") router.replace(nextPathFor(state.account));
    else if (state.status === "signedOut" || state.status === "error") router.replace("/onboarding");
  }, [state, router]);

  return <main aria-busy className="min-h-dvh bg-canvas" />;
}
