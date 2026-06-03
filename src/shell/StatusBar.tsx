import { IntakeChip } from "../ui";

export function StatusChips({
  intakeUrl,
  tunnelUrl,
  onShare,
}: {
  /** Local intake server URL (e.g. `http://127.0.0.1:<port>`). */
  intakeUrl: string | null;
  /** Public tunnel URL (from .openit/tunnel.json). Null when not sharing. */
  tunnelUrl: string | null;
  /** Click handler for share — kicks off the /share-intake flow. */
  onShare: () => void;
}) {
  return (
    <>
      <IntakeChip
        sharedUrl={intakeUrl}
        tunnelUrl={tunnelUrl}
        onShare={onShare}
      />
    </>
  );
}
