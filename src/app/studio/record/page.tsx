import { getCurrentCreator } from "@/lib/services/studio";
import type { MomentType } from "@/lib/types";
import { RecordScreen } from "./RecordScreen";

const TYPES: MomentType[] = ["photo", "video", "voice", "text"];

export default async function MomentRecordPage(props: PageProps<"/studio/record">) {
  const { type } = await props.searchParams;
  const requestedType = TYPES.includes(type as MomentType) ? (type as MomentType) : undefined;
  const creator = await getCurrentCreator();
  // key: 대시보드에서 다른 유형으로 다시 들어오면 입력 상태를 새로 시작
  return <RecordScreen key={requestedType ?? "draft"} requestedType={requestedType} creatorId={creator.id} />;
}
