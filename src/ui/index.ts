/** OpenIT design system — primitives barrel.
 *
 * Spec: auto-dev/design-explorations/2026-04-29-shell-chrome/v5/index.html
 * Plan: auto-dev/plans/2026-04-29-design-system-v5-foundation.md
 *
 * Token reference: src/styles/tokens.css
 */

export { Button } from "./Button";
export type {
  ButtonProps,
  ButtonVariant,
  ButtonSize,
  ButtonTone,
} from "./Button";

export { TabStrip, Tab } from "./TabStrip";
export type { TabStripProps, TabStripVariant, TabProps } from "./TabStrip";

export { IntakeChip } from "./IntakeChip";
export type { IntakeChipProps } from "./IntakeChip";

export { SlackChip } from "./SlackChip";
export type { SlackChipProps } from "./SlackChip";

export { Banner } from "./Banner";
export type { BannerProps, BannerVariant } from "./Banner";

export { PaneBody } from "./Pane";
export type { PaneBodyProps } from "./Pane";

export { TitleRail } from "./TitleRail";
export type { TitleRailProps } from "./TitleRail";
