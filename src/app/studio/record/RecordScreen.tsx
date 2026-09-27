"use client";

import { useEffect, useState } from "react";
import { useStudioCreator } from "@/components/auth/Gates";
import { emptyDraft, getDraft, setDraftMedia, type MomentDraft } from "@/lib/services/drafts";
import type { MomentType } from "@/lib/types";
import { RecordComposer } from "./RecordComposer";

/**
 * 작성 중인 Draft가 있으면 이어서 쓴다.
 * - 미리보기에서 "수정하기"로 돌아온 경우 (유형 지정 없음)
 * - 같은 유형으로 다시 들어온 경우
 * 다른 유형으로 들어오면 새로 시작한다.
 */
export function RecordScreen({ requestedType }: { requestedType?: MomentType }) {
  const { id: creatorId } = useStudioCreator();
  const [initial, setInitial] = useState<MomentDraft | null>(null);

  useEffect(() => {
    getDraft(creatorId).then((draft) => {
      const resume = draft && (!requestedType || draft.type === requestedType);
      if (!resume) setDraftMedia(creatorId, null);
      setInitial(resume ? draft : emptyDraft(creatorId, requestedType ?? "photo"));
    });
  }, [creatorId, requestedType]);

  if (!initial) return <main className="h-dvh bg-[#121017]" />;
  return <RecordComposer initial={initial} />;
}
