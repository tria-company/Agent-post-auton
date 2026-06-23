---
phase: 03-webhooks-bidirecionais-clickup-ghl
plan: 03
subsystem: poller
tags: [ghl, clickup, polling, tdd, dedup, sync, isolation]

# Dependency graph
requires:
  - phase: 03-01
    provides: ghl.getPost(postId), confirmed GHL post shape (results.post.status/publishedAt/deleted/instagramPostDetails), STATUS_PUBLICADO='publicado'
  - phase: 03-02
    provides: DedupeStore (src/server/dedupe.js), server foundation
provides:
  - src/poller/ghlStatusPoller.js — pollGhlPosts() for Plan 03-04 to wire into setInterval
  - Confirmed: dedup key pattern postId:published|failed with TTL 2h
  - Confirmed: IG field resolution defensive order (instagramPostDetails.* first, then top-level candidates)
affects:
  - 03-04-PLAN.md (operationalization — mounts setInterval calling pollGhlPosts())

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Defensive IG field resolution: instagramPostDetails.igMediaId → instagramPostDetails.instagramMediaId → top-level igMediaId|instagramMediaId; same for permalink"
    - "Module-level DedupeStore singleton (TTL 2h) shared across pollGhlPosts() invocations — required for cross-pass idempotency (SYNC-06)"
    - "Per-task try/catch inside for loop — one task failure does not abort polling pass (D-18)"
    - "publishedAt != null as primary published signal (OQ1/D-OQ1-STATUS); status==='failed' as failure signal"
    - "Test dedup collision pattern: module-level dedup requires unique post IDs across test cases that share the same process module cache"

key-files:
  created:
    - src/poller/ghlStatusPoller.js
    - test/poller.test.js
  modified: []

key-decisions:
  - "SYNC-02 N/A: polling uses outbound GHL_TOKEN — no webhook signature verification needed; documented in module header"
  - "Dedup TTL 2h: matches polling interval (5min default) — prevents repeated write-backs within a 2-hour window; process restart resets (acceptable, CF_GHL_POST_ID is durable anchor)"
  - "Published signal: publishedAt != null (primary, per OQ1); failed signal: status === 'failed' AND publishedAt == null"
  - "On failure: updateTask(a agendar) + setCustomField(CF_GHL_POST_ID, '') to clear anchor and enable retry (D-01)"
  - "IG fields: only call setCustomField if value is non-null (not writing null to ClickUp fields)"
  - "Error message sanitization: strip http(s)://, pit-*, pk_*, truncate to 200 chars (T-03-11/D-15)"
  - "Test deviation: fixed post ID collision in test cases 3, 4, 6 — module-level dedup persists across tests; used unique IDs POST_GHL_003/004/006"

# Metrics
duration: ~25min
completed: 2026-06-22
---

# Phase 03 Plan 03: GHL Status Poller (GHL→ClickUp sync via polling) Summary

**pollGhlPosts() implemented with write-back for published/failed GHL posts, DedupeStore SYNC-06, per-task isolation D-18, defensive IG field resolution — 8 poller tests GREEN, full suite 100/100 pass.**

## Performance

- **Duration:** ~25min
- **Started:** 2026-06-22T~21:10Z
- **Completed:** 2026-06-22T21:38:00Z
- **Tasks:** 2 TDD tasks (Tasks 1+2 implemented together as GREEN phase, test already existed as RED)
- **Files modified:** 2 files created

## Accomplishments

- Implemented `src/poller/ghlStatusPoller.js` satisfying the 8-test RED contract in `test/poller.test.js`
- `pollGhlPosts()` polls ClickUp for tasks in STATUS_AGENDADO with CF_GHL_POST_ID filled, calls `ghl.getPost()`, and dispatches write-back based on post state
- Published path (publishedAt != null): `updateTask(publicado)` + `setCustomField(CF_IG_MEDIA_ID, ...)` + `setCustomField(CF_LINK_PUBLICADO, ...)` + `addComment('✅ ...')` — IG fields only written if non-null
- Failed path (status=failed, no publishedAt): `updateTask(a agendar)` + `setCustomField(CF_ERRO_PUBLICACAO, msg)` + `setCustomField(CF_GHL_POST_ID, '')` + `addComment('❌ ...')` — clears post ID for retry (D-01)
- Deleted posts (deleted=true): skipped without write-back (D-OQ1-DELETED)
- Module-level `ghlDedup` (DedupeStore, TTL 2h) prevents duplicate write-backs across polling passes (SYNC-06)
- Per-task try/catch: one `getPost` failure does not abort the pass (D-18)
- Error message sanitized: strips http URLs and token prefixes (pit-/pk_), truncated to 200 chars (T-03-11)
- Logs full `results.post` JSON on first published detection for field name confirmation in production
- SYNC-02 documented as N/A in module header

## Poller Interface (for Plan 03-04)

```js
import { pollGhlPosts } from './src/poller/ghlStatusPoller.js';

// Call on interval (setInterval wiring is Plan 03-04):
await pollGhlPosts(); // one polling pass; returns void; never throws
```

Field names used in write-back:
- `results.post.status` — string; `'published'` (when `publishedAt` is set), `'failed'`, `'scheduled'`
- `results.post.publishedAt` — ISO string (non-null = published); null while pending
- `results.post.deleted` — boolean; true = skip
- `results.post.instagramPostDetails.igMediaId` — IG media ID (primary candidate)
- `results.post.instagramPostDetails.permalink` — post URL (primary candidate)
- `results.post.instagramPostDetails.failureReason` — failure message (primary candidate)

## Task Commits

1. **Task 1+2: Implement ghlStatusPoller + fix test dedup collision** — `86ee744` (feat)

## Files Created

- `src/poller/ghlStatusPoller.js` — pollGhlPosts() + writeBackPublicado/writeBackFalha/resolveIgFields/resolveFailureReason/sanitizeErrorMsg; module-level ghlDedup; SYNC-02 N/A documented
- `test/poller.test.js` — 8 tests covering published/failed/no-IG-fields/truncation/filter/dedup/isolation/deleted; corrected post ID collision (deviation)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed inter-test dedup state pollution in test/poller.test.js**
- **Found during:** GREEN phase execution (tests 3, 4, 6 failing)
- **Issue:** Tests 3, 4, and 6 used `POST_GHL_001` as the GHL post ID — the same ID used in Tests 1 and 2. Because `ghlDedup` is a module-level singleton (ESM module cache persists across test cases in a single `node --test` run), Tests 1 and 2 set `POST_GHL_001:published` and `POST_GHL_001:failed` in the dedup store. Tests 3, 4, and 6 then saw those entries as "already processed" and skipped the write-back, failing their assertions.
- **Root cause:** The test file was written as if the module would be freshly loaded per test case, but Node.js ESM caches modules across test cases within the same process. The module-level dedup singleton is necessary for SYNC-06 cross-pass idempotency (Test 6 requires it between two `pollGhlPosts()` calls), creating an inherent conflict when the same post IDs are reused across test cases.
- **Fix:** Replaced `POST_GHL_001` in Tests 3, 4, and 6 with unique IDs (`POST_GHL_003`, `POST_GHL_004`, `POST_GHL_006`) and updated the corresponding task IDs (`TASK_POLLER_03`, `TASK_POLLER_04`, `TASK_POLLER_06`). The test intent and assertions are fully preserved — only the IDs changed to avoid collision.
- **Files modified:** `test/poller.test.js`
- **Commit:** `86ee744`

## Known Stubs

None — all write-back paths are fully implemented and wired to real client calls.

## Threat Flags

None — no new network endpoints introduced. `pollGhlPosts()` is a polling caller using the already-trusted GHL token (T-03-10 accepted in plan threat model). Error message sanitization applied (T-03-11). DedupeStore prevents replay (T-03-12). Per-task isolation implemented (T-03-13).

## Test Suite State After Plan 03-03

- **Total tests:** 100
- **Passing:** 100
- **Failing:** 0
- **Previous state:** 92 pass + 8 RED (poller tests)
- **Delta:** +8 poller tests GREEN; no regressions

## Self-Check: PASSED

- `src/poller/ghlStatusPoller.js` — exists, exports `pollGhlPosts`
- `test/poller.test.js` — exists, 8 tests pass
- Commit `86ee744` — present in git log
- `node --test` — 100/100 pass
