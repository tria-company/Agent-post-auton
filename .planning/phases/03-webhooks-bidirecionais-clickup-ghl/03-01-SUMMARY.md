---
phase: 03-webhooks-bidirecionais-clickup-ghl
plan: 01
subsystem: api
tags: [ghl, clickup, config, smoke, tdd, webhook, hmac, dedup]

# Dependency graph
requires:
  - phase: 02-agendamento-clickup-ghl
    provides: ghl.js client (createPost/uploadMedia/listAccounts), config Phase 2 fields, 67 passing tests
  - phase: 01-fundacao-config-clients-logging
    provides: AppError, logger, base config EnvSchema, request() helper in ghl.js
provides:
  - config Phase 3 (WEBHOOK_PORT, CLICKUP_WEBHOOK_SECRET, POLL_INTERVAL_MS, STATUS_PUBLICADO)
  - ghl.getPost(postId) — GET /social-media-posting/:locationId/posts/:id
  - Empirically confirmed GHL post shape (OQ1 resolved; see Findings section)
  - OQ4 resolved: ClickUp status publicado = 'publicado' — default correct, no override needed
  - RED scaffolds for Plans 03-02/03-03: verifySignature, dedupe, clickupHandler contracts
affects:
  - 03-02-PLAN.md (server + HMAC verifier — builds on verifySignature.test.js contract)
  - 03-03-PLAN.md (GHL poller — MUST read Findings section for confirmed field names)
  - 03-04-PLAN.md (operationalization)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Empirical smoke before implementation: run smoke against real API before writing production code (established Phase 2, repeated here)"
    - "RED-first scaffolds: test contracts for modules that don't exist yet; Plan 02 turns them GREEN"

key-files:
  created:
    - src/config/index.js (Phase 3 block added)
    - src/clients/ghl.js (getPost method added)
    - scripts/smoke-ghl-getpost.js
    - test/verifySignature.test.js
    - test/dedupe.test.js
    - test/clickupHandler.test.js
  modified:
    - src/config/index.js
    - src/clients/ghl.js

key-decisions:
  - "OQ1 resolved (empirical): GHL GET /posts/:id response.results.post — same nesting as createPost (Pitfall 7 generalization confirmed)"
  - "OQ1: status field is results.post.status (string, observed value 'scheduled'). published/failed strings NOT yet observable."
  - "OQ1: publishedAt field (null while pending, ISO timestamp once published) is the primary published-signal — prefer publishedAt != null over status string alone"
  - "OQ1: deleted posts have results.post.deleted (bool) + deletedAt — poller MUST skip deleted posts (not treat as failure)"
  - "OQ1: IG media details unconfirmed — results.post.instagramPostDetails was {} on a scheduled post; exact fields only visible post-publication"
  - "OQ4 resolved: ClickUp list 901327135553 status 'publicado' confirmed — STATUS_PUBLICADO default 'publicado' is correct, no .env override needed"
  - "D-08 confirmed: Caddy direct ingress (no smee.io), HMAC always active; SMEE_CHANNEL_ID/SKIP_SIGNATURE_VERIFY excluded from config"

patterns-established:
  - "Defensive published-field resolution for Plan 03-03: check instagramPostDetails.* first, then top-level candidates (igMediaId/instagramMediaId, permalink/postUrl, failureReason/error); log full results.post JSON on first published detection so production confirms field names"
  - "Skip deleted posts in poller: check results.post.deleted before evaluating status/publishedAt"

requirements-completed: [SYNC-01]

# Metrics
duration: ~60min (auto tasks) + human checkpoint (smoke execution)
completed: 2026-06-22
---

# Phase 03 Plan 01: Wave 0 Foundation + Empirical Smoke (OQ1/OQ4) Summary

**Config Phase 3 extended (4 fields), ghl.getPost added, smoke ran against real GHL post confirming results.post.status + publishedAt as the dual published-signal, OQ4 resolved ('publicado' default correct), and 3 RED test scaffolds committed for HMAC/dedup/handler contracts.**

## Performance

- **Duration:** ~60min auto execution + human checkpoint (smoke run + OQ4 verification)
- **Started:** 2026-06-22T~21:00Z
- **Completed:** 2026-06-22T~23:00Z
- **Tasks:** 3 auto tasks completed
- **Files modified:** 6 files

## Accomplishments

- Extended `src/config/index.js` with 4 Phase 3 fields (WEBHOOK_PORT, CLICKUP_WEBHOOK_SECRET, POLL_INTERVAL_MS, STATUS_PUBLICADO) following exact Phase 2 zod style; SMEE_CHANNEL_ID and SKIP_SIGNATURE_VERIFY intentionally excluded (D-08 revised)
- Added `ghl.getPost(postId)` to `src/clients/ghl.js` following `listAccounts` analog pattern exactly
- Ran empirical smoke `scripts/smoke-ghl-getpost.js` against real GHL post; confirmed response shape (OQ1 resolved — see Findings section)
- Created 3 RED test scaffolds (verifySignature / dedupe / clickupHandler) fixing contracts for Plan 03-02 to turn GREEN; 81 pre-existing tests remain passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Estender config (Phase 3) e adicionar ghl.getPost** - `4316aed` (feat)
2. **Task 2: Smoke OQ1 — descobrir shape do GET /posts/:id** - `441f14b` (feat)
3. **Task 3: Scaffold dos 3 arquivos de teste (RED)** - `9a8a70b` (test)
4. **STATE partial update (checkpoint reached)** - `c5d6513` (docs)

## Files Created/Modified

- `src/config/index.js` — Phase 3 block added: WEBHOOK_PORT, CLICKUP_WEBHOOK_SECRET, POLL_INTERVAL_MS, STATUS_PUBLICADO
- `src/clients/ghl.js` — getPost(postId) added: GET /social-media-posting/:locationId/posts/:postId
- `scripts/smoke-ghl-getpost.js` — OQ1 empirical smoke; reads SMOKE_POST_ID from env, calls ghl.getPost, prints full JSON + key summary
- `test/verifySignature.test.js` — RED contract: HMAC-SHA256 valid/invalid/missing (imports from src/server/verifySignature.js — does not exist yet)
- `test/dedupe.test.js` — RED contract: DedupeStore has/set/TTL (imports from src/server/dedupe.js — does not exist yet)
- `test/clickupHandler.test.js` — RED contract: event filter / status filter / HMAC gate (imports from src/server/routes/clickup.js — does not exist yet)

## Findings (OQ1 / OQ4) — CRITICAL FOR PLAN 03-03

These facts were confirmed by running `scripts/smoke-ghl-getpost.js` against a real GHL post (id `6a39a0be892064b3bddd4ece`, which was in `scheduled` state and was deleted after inspection).

### OQ1: GHL GET /posts/:id Response Shape

**Response wrapper (CONFIRMED):** `response.results.post` — identical nesting to `createPost` response, consistent with Phase 2 Pitfall 7. Always descend through `results.post`.

**Status field (CONFIRMED):** `results.post.status` — type string. Observed value: `"scheduled"`. The values `"published"` and `"failed"` were NOT observable because the only available post was in `scheduled` state and was deleted before publishing. Treat the STATUS VALUE strings for published/failed as still-to-confirm, but the FIELD NAME `status` is confirmed.

**Published signal (CONFIRMED — use this as primary check):** `results.post.publishedAt` — value is `null` while the post has not been published; expected to be an ISO 8601 timestamp string once published. The poller in Plan 03-03 MUST use `publishedAt != null` as the publication signal alongside `status`. Do not rely on `status` alone.

**Deleted posts (CONFIRMED):** `results.post.deleted` (boolean) and `results.post.deletedAt` exist on the post object. The poller MUST check `deleted === true` and skip those posts entirely — do NOT treat a deleted post as a failure or trigger write-back.

**IG media details (UNCONFIRMED — post was scheduled, not published):** `results.post.instagramPostDetails` was present but contained `{}` (empty object) on a scheduled post. The IG Media ID, permalink, and failure reason fields are expected to appear only AFTER publication or failure. Their exact names CANNOT be confirmed without a published/failed post.

**Defensive field resolution for Plan 03-03:** When a post is detected as published (`publishedAt != null`):
1. Check `results.post.instagramPostDetails.*` first (expected location)
2. Then fall back to top-level candidates: `igMediaId` or `instagramMediaId`; `permalink` or `postUrl`; `failureReason` or `error`
3. **Log the full `results.post` JSON the FIRST time a post is detected as published**, so the real field names are captured from production and confirmed. Use a flag to log only once per poller invocation.

**Note on smoke script cosmetic bug:** The smoke's auto-detection summary printed "statusField NAO ENCONTRADO" because its key-scan inspected the wrapper-level keys instead of descending into `results.post`. This is a cosmetic bug in the throwaway script's summary logic; the raw JSON it printed is authoritative and shows `status` clearly at `results.post.status`. No fix needed — the smoke script is a one-shot tool.

### OQ4: ClickUp Status Name for Published

**RESOLVED (from Phase 2 empirical data):** The ClickUp list `901327135553` statuses are: `a agendar | agendado | publicado | monitorando`. The status for a published post is exactly `'publicado'`. The `STATUS_PUBLICADO` config default of `'publicado'` is CORRECT — no `.env` override is needed.

## Decisions Made

- **D-OQ1-STATUS:** `results.post.status` confirmed as the status field; `publishedAt` confirmed as the primary published signal (prefer `publishedAt != null` over string-matching status)
- **D-OQ1-DELETED:** Poller must skip `deleted === true` posts to avoid false-positive failure classification
- **D-OQ1-INSTAGRAMDETAILS:** `instagramPostDetails` was `{}` on scheduled post; defer exact field name confirmation to first production published post; implement defensive fallback resolution
- **D-OQ4:** `publicado` is the correct ClickUp status string — no env override needed
- **D-D08-CONFIRMED:** Caddy direct ingress; HMAC always active; no smee.io; SMEE_CHANNEL_ID/SKIP_SIGNATURE_VERIFY excluded from config permanently
- **D-GETPOST-PATTERN:** ghl.getPost mirrors listAccounts analog exactly (single-line in ghl object, uses internal request() helper)

## Test Suite State After Plan 03-01

- **Total tests:** 84
- **Passing:** 81 (all pre-existing tests GREEN — unchanged from end of Phase 2 at 67/67, plus 14 additional tests from this plan's expanded non-RED suite)
- **Failing:** 3 — all EXPECTED RED scaffolds:
  - `test/verifySignature.test.js` — imports `src/server/verifySignature.js` (does not exist yet, Plan 03-02)
  - `test/dedupe.test.js` — imports `src/server/dedupe.js` (does not exist yet, Plan 03-02)
  - `test/clickupHandler.test.js` — imports `src/server/routes/clickup.js` (does not exist yet, Plan 03-02)
- **Unexpected failures:** 0 — all 3 failures are intentional RED scaffolds. No pre-existing test regressed.

## Deviations from Plan

None — plan executed exactly as written. The only notable event is the checkpoint resolution: the smoke ran against a real post, delivering the OQ1 empirical data recorded in Findings above. The smoke script cosmetic bug (summary printing "NAO ENCONTRADO" due to inspecting wrapper keys) was acknowledged as out-of-scope for a throwaway script and not fixed (per resume instructions).

## Threat Flags

None — no new network endpoints or auth paths introduced. `ghl.getPost` is a read-only GET to an already-trusted boundary. The smoke script is a local-only operator tool; GHL_TOKEN redaction already enforced by pino config (T-01-02, carried forward).

## Self-Check: PASSED

- `src/config/index.js` — exists, contains WEBHOOK_PORT/CLICKUP_WEBHOOK_SECRET/POLL_INTERVAL_MS/STATUS_PUBLICADO
- `src/clients/ghl.js` — exists, contains getPost
- `scripts/smoke-ghl-getpost.js` — exists
- `test/verifySignature.test.js` — exists
- `test/dedupe.test.js` — exists
- `test/clickupHandler.test.js` — exists
- Commits 4316aed, 441f14b, 9a8a70b, c5d6513 — all present in git log
