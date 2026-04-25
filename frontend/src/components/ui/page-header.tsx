import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: React.ReactNode;
  context?: React.ReactNode;  // e.g., org chip
  actions?: React.ReactNode;
  className?: string;
}

/** Canonical page header block — keeps typography + rhythm consistent
 * across every module. */
export function PageHeader({ title, description, context, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold text-gray-900 tracking-[-0.01em] leading-tight">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-sm text-gray-500 leading-relaxed max-w-2xl">{description}</p>
        )}
        {context && <div className="mt-2.5">{context}</div>}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">{actions}</div>
      )}
    </div>
  );
}
