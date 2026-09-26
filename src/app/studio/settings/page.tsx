import { Ban, Bell, CreditCard, FolderClock, MessagesSquare, Repeat, ShieldCheck, UserRound } from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { ButtonLink } from "@/components/ui/Button";
import { ListGroup, ListRow, PageHeader, SectionHeader } from "@/components/ui/primitives";
import { getCurrentCreator } from "@/lib/services/studio";
import { formatPrice } from "@/lib/utils/format";

const icon = "size-[18px]";

export default async function StudioSettingsPage() {
  const creator = await getCurrentCreator();

  return (
    <main className="animate-fade-in">
      <PageHeader title="설정" />

      <section className="flex items-center gap-3 px-5">
        <Avatar src={creator.avatarUrl} name={creator.name} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-name font-semibold">{creator.name}</p>
          <p className="text-caption text-muted">@{creator.handle}</p>
        </div>
        <ButtonLink href={`/creators/${creator.id}/today`} variant="secondary" size="sm">
          팬 화면 보기
        </ButtonLink>
      </section>

      <section className="mt-7">
        <SectionHeader title="Creator AI & 안전" caption="AI가 나를 대신해 말하는 방식과 한계" />
        <ListGroup>
          <ListRow href="/studio/settings/persona" icon={<MessagesSquare className={icon} />} label="Persona" description="말투, 참고할 Moment 범위" />
          <ListRow href="/studio/settings/boundary" icon={<Ban className={icon} />} label="Boundary" description="AI가 답하지 않을 주제와 질문" />
          <ListRow href="/studio/settings/safeshare" icon={<ShieldCheck className={icon} />} label="SafeShare" description="위치 · 얼굴 · 개인정보 보호" />
        </ListGroup>
      </section>

      <section className="mt-7">
        <SectionHeader title="계정" />
        <ListGroup>
          <ListRow href="/studio/records" icon={<FolderClock className={icon} />} label="내 기록 (Records)" description="지금까지 남긴 하루들" />
          <ListRow icon={<UserRound className={icon} />} label="프로필 편집" />
          <ListRow
            icon={<CreditCard className={icon} />}
            label="구독 가격 · 정산"
            description={`구독 ${formatPrice(creator.pricing.subscriber)} · Premium ${formatPrice(creator.pricing.premium)}`}
          />
          <ListRow icon={<Bell className={icon} />} label="알림" />
        </ListGroup>
      </section>

      <div className="mx-5 mt-6">
        <ButtonLink href="/today" variant="secondary" block>
          <Repeat className="size-4" />팬 모드로 전환
        </ButtonLink>
      </div>
    </main>
  );
}
