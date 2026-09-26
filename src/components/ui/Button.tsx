import Link from "next/link";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "soft" | "ghost" | "dark" | "light";
type Size = "sm" | "md" | "lg";

const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-white hover:bg-brand-deep",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-canvas",
  soft: "bg-brand-soft text-brand-deep hover:bg-brand-soft/70",
  ghost: "text-ink-2 hover:bg-brand-tint",
  dark: "bg-ink text-white hover:bg-black",
  /** 어두운 배경(사진·Moment 상세) 위 */
  light: "bg-white text-ink hover:bg-white/90",
};

const SIZE: Record<Size, string> = {
  sm: "h-8 px-3.5 text-caption rounded-full",
  md: "h-11 px-5 text-sub rounded-tile",
  lg: "h-[52px] px-6 text-body rounded-tile",
};

interface BaseProps {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  className?: string;
  children: React.ReactNode;
}

export function buttonClass({ variant = "primary", size = "md", block, className }: Omit<BaseProps, "children">) {
  return cn(
    "pressable inline-flex shrink-0 items-center justify-center gap-1.5 font-semibold disabled:pointer-events-none disabled:opacity-40",
    VARIANT[variant],
    SIZE[size],
    block && "w-full",
    className,
  );
}

export function Button({
  variant,
  size,
  block,
  className,
  children,
  type = "button",
  ...rest
}: BaseProps & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={buttonClass({ variant, size, block, className })} {...rest}>
      {children}
    </button>
  );
}

export function ButtonLink({ href, variant, size, block, className, children }: BaseProps & { href: string }) {
  return (
    <Link href={href} className={buttonClass({ variant, size, block, className })}>
      {children}
    </Link>
  );
}
