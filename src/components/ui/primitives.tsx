import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/** 필요한 곳에만 쓰는 카드. 테두리는 옅은 선, 그림자는 쓰지 않거나 아주 옅게. */
export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("rounded-card border border-line bg-surface", className)}>{children}</div>;
}

/** 탭 화면 상단 제목 (Discover, Chat, Archive, My …) */
export function PageHeader({
  title,
  caption,
  right,
  className,
}: {
  title: React.ReactNode;
  caption?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex items-end justify-between gap-3 px-5 pt-5 pb-4", className)}>
      <div className="min-w-0">
        <h1 className="text-title font-bold">{title}</h1>
        {caption && <p className="mt-0.5 text-caption text-muted">{caption}</p>}
      </div>
      {right}
    </header>
  );
}

export function SectionHeader({
  title,
  caption,
  href,
  actionLabel = "전체보기",
  className,
}: {
  title: React.ReactNode;
  caption?: React.ReactNode;
  href?: string;
  actionLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn("mb-3 flex items-end justify-between gap-3 px-5", className)}>
      <div className="min-w-0">
        <h2 className="text-section font-semibold">{title}</h2>
        {caption && <p className="mt-0.5 text-caption text-muted">{caption}</p>}
      </div>
      {href && (
        <Link href={href} className="pressable flex shrink-0 items-center py-1 text-caption text-muted hover:text-ink">
          {actionLabel}
          <ChevronRight className="size-4" />
        </Link>
      )}
    </div>
  );
}

export function Chip({
  active,
  children,
  className,
  type = "button",
  ...rest
}: { active?: boolean; className?: string; children: React.ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "pressable inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-caption font-medium",
        active ? "bg-ink text-white" : "border border-line-strong bg-surface text-ink-2 hover:bg-canvas",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

/** 기간 선택 등 작은 segmented control */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex rounded-full bg-brand-tint p-1", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 flex-1 rounded-full text-caption transition-colors duration-150",
            value === o.value ? "bg-surface font-semibold text-ink shadow-card" : "font-medium text-muted",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ value, label, className }: { value: React.ReactNode; label: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="text-name font-semibold tabular-nums">{value}</div>
      <div className="mt-0.5 text-meta text-muted">{label}</div>
    </div>
  );
}

export function EmptyState({ icon, title, description }: { icon?: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center px-8 py-12 text-center">
      {icon && <div className="mb-3 grid size-11 place-items-center rounded-full bg-brand-tint text-brand">{icon}</div>}
      <p className="text-sub font-semibold">{title}</p>
      {description && <p className="mt-1 text-caption text-muted">{description}</p>}
    </div>
  );
}

/** 목록 그룹 (설정 등) — 행 사이 구분선 */
export function ListGroup({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "mx-5 overflow-hidden rounded-card border border-line bg-surface [&>*+*]:border-t [&>*+*]:border-line",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** 목록 행. href가 없으면 아직 준비 중인 항목으로, 눌리지 않는 모양으로 보인다. */
export function ListRow({
  href,
  icon,
  label,
  description,
}: {
  href?: string;
  icon?: React.ReactNode;
  label: string;
  description?: string;
}) {
  const body = (
    <>
      {icon && <div className={cn("grid size-8 shrink-0 place-items-center", href ? "text-ink-2" : "text-faint")}>{icon}</div>}
      <div className="min-w-0 flex-1">
        <div className={cn("text-sub font-medium", !href && "text-muted")}>{label}</div>
        {description && <div className="truncate text-meta text-muted">{description}</div>}
      </div>
      {href ? <ChevronRight className="size-4 shrink-0 text-faint" /> : <span className="shrink-0 text-meta text-faint">준비 중</span>}
    </>
  );

  return href ? (
    <Link href={href} className="flex min-h-[52px] items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-canvas active:bg-brand-tint">
      {body}
    </Link>
  ) : (
    <div className="flex min-h-[52px] items-center gap-2.5 px-3.5 py-2.5">{body}</div>
  );
}
