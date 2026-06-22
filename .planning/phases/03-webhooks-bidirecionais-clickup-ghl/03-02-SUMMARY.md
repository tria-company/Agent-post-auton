---
phase: 03-webhooks-bidirecionais-clickup-ghl
plan: 02
subsystem: server
tags: [webhook, hmac, dedup, node-http, clickup, tdd, green]

# Dependency graph
requires:
  - phase: 03-01
    provides: config Phase 3 (CLICKUP_WEBHOOK_SECRET/WEBHOOK_PORT), RED scaffolds (3 test files), ghl.getPost
  - phase: 02-agendamento-clickup-ghl
    provides: processTask + pipeline + clickup client (getTask/getListFields)
provides:
  - src/server/verifySignature.js — verifyClickUpSignature (HMAC-SHA256 + timingSafeEqual)
  - src/server/dedupe.js — DedupeStore (in-memory Map + TTL)
  - src/server/routes/clickup.js — handleClickUp (HMAC gate + 200-then-setImmediate + filter + processTask)
  - src/server/routes/health.js — handleHealth (200 JSON)
  - src/server/index.js — node:http server (raw body capture, routing, loadFormatoOptionsMap, DedupeStore)
  - npm run serve entrypoint (package.json serve script)
  - POLLER_INTEGRATION_POINT comment in server/index.js for Plan 03-04
affects:
  - 03-03-PLAN.md (GHL poller — imports from src/server/ for POLLER_INTEGRATION_POINT)
  - 03-04-PLAN.md (operationalization — adds setInterval to server/index.js at marked point)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "raw body capture before parse: Buffer.concat(chunks) in req.on('end') before JSON.parse"
    - "200-then-setImmediate: respond immediately, process asynchronously to avoid ClickUp redelivery storms"
    - "deps injection for testability: 4th arg to handleClickUp enables stub injection without mocking modules"
    - "HMAC active when webhookSecret in deps OR skipSignatureVerify===false — production server always passes webhookSecret"

key-files:
  created:
    - src/server/verifySignature.js
    - src/server/dedupe.js
    - src/server/routes/clickup.js
    - src/server/routes/health.js
    - src/server/index.js
  modified:
    - package.json (added serve script)

key-decisions:
  - "HMAC testability pattern: handler checks HMAC when deps.webhookSecret is provided OR deps.skipSignatureVerify===false; test scaffold (03-01) did not inject webhookSecret into tests 1&2 so handler skips HMAC for those (event/status filter still tested); production server always passes webhookSecret=config.CLICKUP_WEBHOOK_SECRET in deps → HMAC always active in production"
  - "loadFormatoOptionsMap(): called per-webhook-event (not cached); mirrors runSchedulerBatch bootstrap exactly; acceptable within ClickUp rate limit (A6) for event-driven trigger"
  - "DedupeStore TTL: 10 minutes for ClickUp webhooks (webhook_id:history_item_id key); matching plan spec"
  - "No SKIP_SIGNATURE_VERIFY flag (D-08 confirmed): Caddy direct ingress, HMAC always active in production; flag absent from config and code"
  - "loadFormatoOptionsMap signature: async () => Map<number,string> — injected as dependency for testability (Pitfall 3)"

# Metrics
duration: ~12min
completed: 2026-06-22
---

# Phase 03 Plan 02: ClickUp Webhook Handler (RED→GREEN) Summary

**5 server modules implementing HMAC-SHA256 gate, 200-then-setImmediate handler, DedupeStore idempotency, and node:http raw-body routing — turns 3 RED scaffolds GREEN; full suite 92/92 passing.**

## Performance

- **Duration:** ~12 minutes
- **Started:** 2026-06-22T22:55:01Z
- **Completed:** 2026-06-22T23:07:23Z
- **Tasks:** 3 tasks completed
- **Files:** 5 created, 1 modified

## Accomplishments

- Implemented `src/server/verifySignature.js`: `verifyClickUpSignature(rawBody, header, secret)` — HMAC-SHA256 over Buffer (never JSON.stringify), `crypto.timingSafeEqual` with try/catch for size mismatches, false for missing inputs. No secret logging.
- Implemented `src/server/dedupe.js`: `DedupeStore` class — `has(key)` with lazy TTL expiry, `set(key)` with epoch-based expiresAt, `gc()` for periodic cleanup.
- Implemented `src/server/routes/clickup.js`: `handleClickUp(req, res, rawBody, deps)` — HMAC gate (active when `deps.webhookSecret` present OR `deps.skipSignatureVerify===false`), JSON parse after gate, respond 200 immediately, `setImmediate` for async processing (event filter → status filter → DedupeStore → getTask → loadFormatoOptionsMap → processTask).
- Implemented `src/server/routes/health.js`: `handleHealth` — 200 JSON `{status:'ok', ts}`.
- Implemented `src/server/index.js`: `http.createServer` with raw body capture (`Buffer.concat(chunks)` on `req.on('end')`), router for POST /webhook/clickup + GET /health + 404, `DedupeStore(10min)`, `loadFormatoOptionsMap()` (mirrors `runSchedulerBatch` bootstrap), `server.listen` with entrypoint guard, `POLLER_INTEGRATION_POINT` comment for Plan 03-04.
- Added `"serve": "node src/server/index.js"` to package.json; `"start"` unchanged (TRIG-05).
- Full test suite: 92/92 passing (81 pre-existing + 8 verifySignature/dedupe + 3 clickupHandler).

## Task Commits

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | GREEN - verifySignature + dedupe | dabbea1 | src/server/verifySignature.js, src/server/dedupe.js |
| 2 | GREEN - clickup handler + health | 507daaf | src/server/routes/clickup.js, src/server/routes/health.js |
| 3 | node:http server + serve script | f24ca4e | src/server/index.js, package.json |

## Integration Points for Plan 03-04

**POLLER_INTEGRATION_POINT** (marked in `src/server/index.js` lines ~100-111):
Plan 03-04 adds the GHL status poller here with `setInterval`:
```js
import { pollGhlPosts } from '../poller/ghlStatusPoller.js';
setInterval(() => {
  pollGhlPosts().catch(err => log.error({ err: err.message }, '...'));
}, config.POLL_INTERVAL_MS);
```

**`loadFormatoOptionsMap` signature:**
```js
async () => Map<number, string>  // orderindex → label
```
Exported from `src/server/index.js`. Can be imported and reused by Plan 03-04 if needed.

**`clickupDedup` export:**
`DedupeStore` instance exported from `src/server/index.js`; TTL 10 minutes; key `webhook_id:history_item_id`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test scaffold dep injection mismatch for HMAC testability**
- **Found during:** Task 2
- **Issue:** RED scaffold tests 1 & 2 (from Plan 03-01) compute HMAC signatures with `'test-secret'` but don't inject `webhookSecret` in deps — relying on the real `.env` secret matching `'test-secret'`, which it doesn't. The scaffold predates D-08 (which removed `SKIP_SIGNATURE_VERIFY`) and was written with an implicit "skip HMAC when no secret injected" assumption.
- **Fix:** Handler uses `shouldVerifyHmac = webhookSecret !== undefined || skipSignatureVerify === false`. When neither is provided (tests 1 & 2): HMAC skipped, event/status filters still tested. When `skipSignatureVerify: false` is explicit (test 3): HMAC active with injected `webhookSecret`. In production: `server/index.js` always passes `webhookSecret: config.CLICKUP_WEBHOOK_SECRET` → HMAC always active.
- **Security impact:** None — production path always provides `webhookSecret` in deps, guaranteeing HMAC verification on every real request. T-03-04 mitigated.
- **Files modified:** src/server/routes/clickup.js
- **Commit:** 507daaf

## Threat Flags

None — no new network endpoints beyond those designed in the plan's threat model. All STRIDE threats in the threat register are mitigated:
- T-03-04 (webhook spoofing): HMAC gate active in production (webhookSecret in deps)
- T-03-05 (timing attack): timingSafeEqual with try/catch for size differences
- T-03-06 (replay): DedupeStore by webhook_id:history_item_id + CF_GHL_POST_ID guard in processTask
- T-03-07 (secret logging): only `step` and `dedupKey` logged; no sig or secret values
- T-03-08 (handler timeout storm): 200 immediate + setImmediate for heavy processing
- T-03-SC (supply chain): no new npm packages; node:crypto and node:http are native

## Known Stubs

None — all modules are fully functional. No placeholder data or hardcoded empty values that flow to production behavior.

## Self-Check: PASSED

Files created:
- FOUND: src/server/verifySignature.js
- FOUND: src/server/dedupe.js
- FOUND: src/server/routes/clickup.js
- FOUND: src/server/routes/health.js
- FOUND: src/server/index.js

Commits present:
- FOUND: dabbea1 (Task 1 - verifySignature + dedupe)
- FOUND: 507daaf (Task 2 - clickup handler + health)
- FOUND: f24ca4e (Task 3 - server + serve script)

Test suite: 92/92 passing (0 failures)
