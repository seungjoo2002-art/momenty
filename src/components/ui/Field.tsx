import { cn } from "@/lib/utils/cn";

export function Field({
  label,
  className,
  ...rest
}: { label: string; className?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1.5 block text-caption font-medium text-ink-2">{label}</span>
      <input
        className="h-13 w-full rounded-tile border border-line-strong bg-surface px-4 text-body outline-none placeholder:text-faint focus:border-brand focus:ring-4 focus:ring-brand/10"
        {...rest}
      />
    </label>
  );
}
