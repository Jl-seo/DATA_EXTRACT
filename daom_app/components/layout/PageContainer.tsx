import { cn } from "@/lib/utils";

interface PageContainerProps {
  children: React.ReactNode;
  className?: string;
  maxWidth?: string;
}

export function PageContainer({
  children,
  className,
  maxWidth = "7xl"
}: PageContainerProps) {
  return (
    <div className={cn("p-6 min-h-full lg:h-full bg-slate-50/50", className)}>
      <div className={cn("mx-auto w-full space-y-6 lg:h-full flex flex-col", maxWidth === "full" ? "max-w-full" : "max-w-7xl")}>
        {children}
      </div>
    </div>
  );
}
