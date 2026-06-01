import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <Loader2Icon
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  )
}

function SpinnerWithText({ className, text, textSize, ...props }: { className?: string; text: string; textSize?: string } & React.ComponentProps<"svg">) {
  return (
    <div className={cn("flex flex-row items-center gap-2", className)}>
      <Spinner {...props} />
      <span className={`font-light ${textSize || "text-sm"}`}>{text}</span>
    </div>
  );
}

export { Spinner, SpinnerWithText }
