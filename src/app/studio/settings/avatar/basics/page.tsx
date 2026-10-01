import { AvatarBasicsForm } from "./AvatarBasicsForm";

export default async function AvatarBasicsPage(props: PageProps<"/studio/settings/avatar/basics">) {
  const { notice } = await props.searchParams;
  return <AvatarBasicsForm notice={notice === "1"} />;
}
