# PR Review Smoke-Test Fixture

This file exists only so the multi-reviewer pipeline has a deliberately
flawed diff to review across two repos. It will be deleted once verification
is done.

## Intentional issues for reviewers to find

1. **Duplicate helper.** Imagine this file defines a markdown-link parser when
   `src/lib/parseMarkdownLink.ts` already exports one. Reviewers should flag
   the duplication.
2. **Hard-coded credential.** `const API_KEY = "sk-1234567890abcdef"` (not a
   real key, but the pattern is what matters — reviewers should flag the
   string and recommend `process.env.API_KEY`).
3. **Unbounded list.** Imagine a list endpoint with no pagination returning
   `all_users()` directly to the client.

Reviewers do not need to look at real code for this round — the goal is to
prove the orchestration plumbing works across two repos, not to score the
fixture file.
