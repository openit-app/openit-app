import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Pane.module.css";

export interface PaneBodyProps extends HTMLAttributes<HTMLDivElement> {
  /** Drop the canonical inner padding. Use for full-bleed lists,
   *  toolbars, or any body whose rows must reach the pane edge. */
  flush?: boolean;
  children: ReactNode;
}

/** Scrollable pane body. Owns the scroller, the reserved scrollbar
 *  gutter, and the canonical inner padding for every pane. */
export function PaneBody({ flush = false, className, children, ...rest }: PaneBodyProps) {
  const cls = [styles.body, flush && styles.flush, className].filter(Boolean).join(" ");
  return (
    <div className={cls} {...rest}>
      {children}
    </div>
  );
}
