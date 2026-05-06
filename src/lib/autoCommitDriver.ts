// Auto-commit driver — disabled. Git infrastructure has been removed;
// entity writes no longer need auto-committing.

export async function startAutoCommitDriver(_repo: string): Promise<void> {
  // no-op: git auto-commit removed
}

export async function stopAutoCommitDriver(): Promise<void> {
  // no-op: git auto-commit removed
}
