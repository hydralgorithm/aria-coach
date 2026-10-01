import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-11 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus-visible:border-iris-400/60 focus-visible:ring-2 focus-visible:ring-iris-400/30 disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Input }
