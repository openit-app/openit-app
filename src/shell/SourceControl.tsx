// SourceControl — disabled. Git infrastructure has been removed; the
// commit/push UI is no longer functional. The component is retained as
// a stub so any lingering lazy-import doesn't crash at runtime.

type Props = {
  repo: string | null;
  active?: boolean;
  onShowDiff: (text: string) => void;
  onFsChange?: () => void;
  onChangeCount?: (n: number) => void;
};

export function SourceControl({ }: Props) {
  return (
    <div className="sc-panel sc-empty">
      Source control has been removed in local-first mode.
    </div>
  );
}
