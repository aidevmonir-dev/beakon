import { cn } from "@/lib/utils";
import { LucideIcon } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: LucideIcon;
  iconColor?: string;
}

export default function StatCard({
  title,
  value,
  change,
  changeType = "neutral",
  icon: Icon,
  iconColor = "bg-brand-100 text-brand-600",
}: StatCardProps) {
  return (
    <div className="card p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-semibold text-gray-900 mt-1">{value}</p>
          {change && (
            <p
              className={cn(
                "text-xs font-medium mt-1",
                changeType === "positive" && "text-green-600",
                changeType === "negative" && "text-red-600",
                changeType === "neutral" && "text-gray-500"
              )}
            >
              {change}
            </p>
          )}
        </div>
        <div className={cn("p-2.5 rounded-lg", iconColor)}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
}
