import { SpeechTraining } from "./SpeechTraining";

export default async function AvatarTrainingPage(props: PageProps<"/studio/settings/avatar/training">) {
  const { notice } = await props.searchParams;
  return <SpeechTraining notice={notice === "1"} />;
}
