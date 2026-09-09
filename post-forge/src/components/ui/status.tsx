import type { ReactNode } from "react";

type StatusTone = "neutral" | "info" | "success" | "warning" | "error";
export type StatusProps = { children: ReactNode; tone?: StatusTone; icon?: ReactNode; className?: string };

export function Status({ children, tone = "neutral", icon, className = "" }: StatusProps) {
  return (
    <div className={`status status-${tone}${className ? ` ${className}` : ""}`} role="status" aria-live="polite">
      <span className="status-icon" aria-hidden="true">{icon ?? "•"}</span>
      <span>{children}</span>
    </div>
  );
}
