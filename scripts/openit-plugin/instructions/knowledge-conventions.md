# Knowledge conventions

Knowledge is for *employee-facing* answers — questions an employee might ask the admin, written so anyone can read them. Anything under `knowledge/` may be shared with employees verbatim, so write for that audience, not in admin-only shorthand.

## What belongs in knowledge

- Setup steps employees will follow (VPN, password reset, MFA, ...).
- Policy explanations employees will reference (PTO, expense, security).
- Reusable answers to recurring employee questions.

## What does NOT belong in knowledge

Admin-only operational notes ("how I cleaned up dupes last Tuesday") do not belong in `knowledge/`. They'll eventually surface to an unrelated employee question, which is wrong. Route admin self-work to a **command**, not a knowledge article.

The split is by **artifact type** — knowledge or command — not by folder depth. **Never use subfolders inside `knowledge/`** to separate admin from employee notes.

## File conventions

- **Knowledge article** lives at `knowledge/<slug>.md`.
- Search with `Glob "knowledge/**/*.md"` or `node .claude/scripts/knowledge-search.mjs "<query>"`.
- One topic per file. Cross-link with relative markdown links when topics relate.
- Lead with the answer. Employees skim; bury caveats below.
