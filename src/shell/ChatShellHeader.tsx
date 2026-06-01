import { type ReactNode } from "react";
import { Button } from "../ui";

export function ChatShellHeader({
  onResumeSession,
  dragHandle,
}: {
  onResumeSession?: () => void;
  dragHandle?: ReactNode;
}) {
  return (
    <div className="chat-shell-header">
      {dragHandle}
      <span className="chat-shell-title">Claude</span>
      <span className="chat-shell-sub">your IT copilot</span>
      <span className="chat-shell-spacer" />
      {onResumeSession && (
        <Button
          variant="subtle"
          size="sm"
          iconOnly
          onClick={onResumeSession}
          title="Resume previous Claude session"
          aria-label="Resume a previous Claude session"
        >
          ↺
        </Button>
      )}
    </div>
  );
}
