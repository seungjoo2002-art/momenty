import { MomentDetailView } from "./MomentDetailView";

export default async function MomentDetailPage(props: PageProps<"/moments/[momentId]">) {
  const { momentId } = await props.params;
  return <MomentDetailView momentId={momentId} />;
}
