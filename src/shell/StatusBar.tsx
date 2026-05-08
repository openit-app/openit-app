import type { SlackConfig, SlackStatus } from "../lib/api";
import { IntakeChip, SlackChip } from "../ui";

export function StatusChips({
  intakeUrl,
  tunnelUrl,
  onShare,
  slackConfig,
  slackStatus,
  onConnectSlack,
}: {
  /** Local intake server URL (e.g. `http://127.0.0.1:<port>`). */
  intakeUrl: string | null;
  /** Public tunnel URL (from .openit/tunnel.json). Null when not sharing. */
  tunnelUrl: string | null;
  /** Click handler for share — kicks off the /share-intake flow. */
  onShare: () => void;
  slackConfig: SlackConfig | null;
  slackStatus: SlackStatus | null;
  onConnectSlack: () => void;
}) {
  return (
    <>
      <IntakeChip
        sharedUrl={intakeUrl}
        tunnelUrl={tunnelUrl}
        onShare={onShare}
      />
      <SlackChip
        config={slackConfig}
        status={slackStatus}
        onConnect={onConnectSlack}
      />
    </>
  );
}
