import { AvatarReview } from "./AvatarReview";

export default async function AvatarReviewPage(props: PageProps<"/studio/settings/avatar/review">) {
  const { notice } = await props.searchParams;
  return <AvatarReview notice={notice === "1"} />;
}
