---
name: Remove sync tab in non-git modes
description: User expects no commit/push UI in local-only and folder-sync modes — saving a file IS the sync gesture
type: feedback
---

In local-only and folder-sync modes, the Sync/Source Control tab should not exist. The user's mental model is "save a file, that's it." The git commit/push UI is a vestigial concept from cloud-sync era. Only git-mode users should see version control surface.

**Why:** The whole point of the rearchitecture is that saving a file = syncing. Showing a commit UI confuses users who picked a Dropbox/iCloud folder — they don't have a mental model for "I edited a file but it isn't synced until I click Commit."

**How to apply:** Strip the Source Control / Sync tab entirely from the sidebar for Phase 1 (local-only mode). It can come back in Phase 2 gated to `syncMode === "git"` only.
