import { Camera, Mic, PenLine, Video } from "lucide-react";
import type { MomentType, ReactionKey } from "@/lib/types";

export const MOMENT_TYPE_META: Record<MomentType, { label: string; icon: typeof Camera }> = {
  photo: { label: "사진", icon: Camera },
  video: { label: "영상", icon: Video },
  voice: { label: "음성", icon: Mic },
  text: { label: "텍스트", icon: PenLine },
};

export const REACTIONS: { key: ReactionKey; emoji: string; label: string }[] = [
  { key: "love", emoji: "🤍", label: "좋아요" },
  { key: "touched", emoji: "🥺", label: "뭉클해요" },
  { key: "cheer", emoji: "👏", label: "응원해요" },
  { key: "smile", emoji: "☺️", label: "웃겨요" },
];
