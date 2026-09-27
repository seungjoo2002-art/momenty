import { Clock } from "lucide-react";
import { ButtonLink } from "./Button";
import { TopBar } from "./TopBar";

/** 아직 열지 않은 기능 — 예시 데이터를 보여주지 않고 준비 중임을 알린다 */
export function ComingSoon({
  title,
  description,
  backHref,
  primary,
}: {
  title: string;
  description: string;
  backHref?: string;
  primary?: { href: string; label: string };
}) {
  return (
    <main className="flex min-h-[80dvh] flex-col">
      {backHref && <TopBar backHref={backHref} />}
      <div className="flex flex-1 flex-col items-center justify-center px-8 text-center">
        <span className="grid size-11 place-items-center rounded-full bg-brand-tint text-brand">
          <Clock className="size-5" />
        </span>
        <p className="mt-3 text-name font-semibold">{title}</p>
        <p className="mt-1 text-caption leading-relaxed text-muted">{description}</p>
        {primary && (
          <ButtonLink href={primary.href} variant="soft" size="sm" className="mt-5">
            {primary.label}
          </ButtonLink>
        )}
      </div>
    </main>
  );
}
