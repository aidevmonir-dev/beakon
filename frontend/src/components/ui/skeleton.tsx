import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-gradient-to-r from-canvas-100 via-canvas-50 to-canvas-100 bg-[length:200%_100%]",
        className,
      )}
      style={{ animation: "shimmer 1.4s ease-in-out infinite" }}
    />
  );
}

export function SkeletonRow({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="border-t border-canvas-100">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <Skeleton className={cn("h-3", i === 1 ? "w-48" : "w-16")} />
        </td>
      ))}
    </tr>
  );
}
