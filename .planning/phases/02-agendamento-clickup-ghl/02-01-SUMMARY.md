---
phase: 02-agendamento-clickup-ghl
plan: 01
subsystem: api
tags: [ghl, clickup, config, zod, adm-zip, social-media, upload, multipart]

# Dependency graph
requires:
  - phase: 01-fundacao-config-clients-logging
    provides: src/config/index.js EnvSchema pattern, src/clients/ghl.js, logging
provides:
  - Config zod schema extended with 6 Phase 2 env vars (fail-fast CFG-01)
  - adm-zip 0.5.17 installed and ESM-importable
  - Empirically verified GHL upload+createPost flow (A1/A2/A4/A7 confirmed)
  - Smoke script src/scheduler/smoke-upload.mjs with empirical findings
  - Documented critical Plano 02 implementation requirements (userId, response shape, token scopes)
affects: [02-02-PLAN.md, 02-03-PLAN.md]

# Tech tracking
tech-stack:
  added: [adm-zip@0.5.17]
  patterns:
    - zod EnvSchema extension with z.string().uuid() for required UUIDs and z.string().min(1).default() for optional-with-defaults
    - native Node 24 FormData + Blob for multipart upload (no extra deps)
    - createPost payload must include top-level userId (not optional)
    - post id lives at response.results.post._id (not response.post._id)

key-files:
  created:
    - src/scheduler/smoke-upload.mjs
    - .planning/phases/02-agendamento-clickup-ghl/02-01-SUMMARY.md
  modified:
    - src/config/index.js
    - .env.example
    - test/config.test.js
    - package.json
    - package-lock.json

key-decisions:
  - "GHL createPost REQUIRES top-level userId field — 422 without it; resolve via GET /users/?locationId= (users.readonly scope)"
  - "createPost response shape: post id at results.post._id, NOT post._id (Pitfall 7 empirically confirmed)"
  - "GHL token needs medias.write + medias.readonly + users.readonly scopes beyond social-media-posting.* for full pipeline"
  - "Status names confirmed: a agendar / agendado match defaults — STATUS_A_AGENDAR / STATUS_AGENDADO use defaults"
  - "Native Node 24 FormData/Blob works for /medias/upload-file multipart upload without extra deps (A4 confirmed)"

patterns-established:
  - "EnvSchema Phase 2 extension: uuid() for required field UUIDs, min(1).default() for optional status names"
  - "Smoke scripts in src/scheduler/ validate high-risk assumptions empirically before full pipeline build"

requirements-completed: [SCH-01, SCH-03, SCH-04, SCH-05, SCH-06, SCH-07]

# Metrics
duration: 120min
completed: 2026-06-22
---

# Phase 02 Plan 01: Wave 0 Setup Summary

**Config extended with 6 Phase 2 env vars (fail-fast CFG-01), adm-zip 0.5.17 installed, and empirical smoke confirmed GHL upload+createPost end-to-end with 3 critical implementation findings for Plano 02**

## Performance

- **Duration:** ~120 min (includes human checkpoint for ClickUp custom fields + smoke run)
- **Started:** 2026-06-22T17:00:00Z
- **Completed:** 2026-06-22T20:00:00Z
- **Tasks:** 3 (Task 1: config TDD, Task 2: adm-zip install, Task 3: human checkpoint + smoke)
- **Files modified:** 7

## Accomplishments

- Extended `src/config/index.js` zod EnvSchema with 6 Phase 2 vars: `CU_FIELD_GHL_POST_ID`, `CU_FIELD_LINK_DO_POST`, `CU_FIELD_FORMATO` (UUID-required), `GHL_ACCOUNT_ID` (string-required), `STATUS_A_AGENDAR`/`STATUS_AGENDADO` (with defaults `a agendar`/`agendado`) — config test green 10/10
- Installed `adm-zip@0.5.17`; ESM default import confirmed working in Node 24 without `createRequire`
- Smoke empirical (`node src/scheduler/smoke-upload.mjs`) PASSED: upload to GHL media library + createPost scheduled test post created (`_id: 6a3986c9d015d306b4628f35`, 201 Created)
- Discovered and documented 3 critical findings that MUST inform Plano 02-02 implementation

## Empirical Smoke Results (Wave 0 — A1/A2/A4/A7)

All four assumptions tested and confirmed:

| Assumption | Description | Result |
|------------|-------------|--------|
| A1 | `type='post'` accepted by createPost | CONFIRMED |
| A2 | Upload CDN url usable in `media[].url` of createPost | CONFIRMED — response echoes uploaded url |
| A4 | Native Node 24 FormData + Blob for POST /medias/upload-file | CONFIRMED — but required `medias.write` + `medias.readonly` scopes on token (401 without them) |
| A7 | `GHL_ACCOUNT_ID` (`...Lm_17841440215631995`) accepted; echoed in `accountIds` | CONFIRMED |

**Test post created:** `_id = 6a3986c9d015d306b4628f35`, scheduled +7 days from run. User deleted `[SMOKE TEST — APAGAR]` post from GHL Social Planner.

**ClickUp status names confirmed** (list 901327135553, Auton team): `a agendar | agendado | publicado | monitorando` — match defaults exactly. No `.env` override needed for `STATUS_A_AGENDAR`/`STATUS_AGENDADO`.

## CRITICAL FINDINGS FOR PLANO 02 (02-02-PLAN.md)

These three findings were NOT in the plan and MUST change how Plano 02 implements `createPost`:

### Finding 1: createPost REQUIRES top-level `userId`

Without `userId` in the payload, the API returns `422 "userId must be a string", "userId should not be empty"`. This field is NOT optional.

- **Resolution:** Store `GHL_USER_ID` in `.env` (now documented in `.env.example`)
- **How to obtain:** `GET /users/?locationId=<GHL_LOCATION_ID>` — requires `users.readonly` scope on the GHL Private Integration Token
- **Smoke used:** static `GHL_USER_ID=6CuISGqrYj5gvxMYNnR4` (Lucas Manoel) via `.env`
- **Plano 02 action:** Read `config.GHL_USER_ID` and include as `userId` in every `createPost` call

### Finding 2: createPost response shape — post id at `results.post._id`

The plan's `must_haves` text stated "retorna `response.post._id`" — this is WRONG. The empirical smoke confirmed:

```
response.results.post._id  ← CORRECT (Pitfall 7 confirmed)
response.post._id           ← ABSENT in actual response
```

- **Plano 02 action:** Extract post id as `data?.results?.post?._id` (defensive fallback to `data?.post?._id` for forward compatibility)
- **Write-back to ClickUp:** Use `results.post._id` as the value saved to `CF_GHL_POST_ID` custom field

### Finding 3: GHL Private Integration Token requires 3 additional scopes

Beyond `social-media-posting.*`, the pipeline needs:

| Scope | Required for |
|-------|-------------|
| `medias.write` | POST /medias/upload-file (returns 401 without it) |
| `medias.readonly` | Reading media library entries |
| `users.readonly` | GET /users/?locationId=... to resolve userId |

- **Plano 02 action:** Document in deployment runbook; token must have all scopes before pipeline runs
- **Smoke evidence:** Upload endpoint returned `401 "token is not authorized for this scope"` until `medias.write`+`medias.readonly` were added

### Minor Observation (non-blocking)

The smoke `createPost` response showed `"platform": "google"` on the post object even though `accountIds` was the Instagram account (`...Lm_17841440215631995`). Did not block scheduling (post appeared in GHL Social Planner correctly). Flag for verification in Plano 02 — may be a GHL API quirk or a display artifact.

## Task Commits

1. **Task 1: Estender config com 6 vars Phase 2 (TDD)** - `9775464` (feat + test)
2. **Task 2: Instalar adm-zip 0.5.17** - `8057019` (chore)
3. **Task 3: Smoke script preparado** - `7bc99f5` (chore)
4. **STATE/ROADMAP partial (awaiting checkpoint)** - `2d82562` (docs)
5. **Smoke empirical fix: userId + results.post._id** - `4d4a470` (fix)
6. **doc: GHL_USER_ID + token scopes in .env.example** - `9a3c481` (docs)

## Files Created/Modified

- `src/config/index.js` — zod EnvSchema extended with 6 Phase 2 vars; CF_* aliases added to frozen export
- `test/config.test.js` — 4 new test cases for Phase 2 vars (fail-fast + presence + defaults)
- `src/scheduler/smoke-upload.mjs` — empirical smoke script: upload + createPost; includes userId, results.post._id extraction
- `.env.example` — GHL_USER_ID placeholder added; required token scopes documented
- `package.json` — adm-zip@0.5.17 dependency added
- `package-lock.json` — lock file updated

## Decisions Made

- **GHL_USER_ID via .env (not auto-resolved):** Plano 02 uses a static user id from .env rather than a dynamic API call at runtime, keeping the pipeline simple and avoiding an extra `users.readonly` call per scheduling cycle. The user resolves this once during setup.
- **Status names match defaults:** No `.env` override required for `STATUS_A_AGENDAR`/`STATUS_AGENDADO` — confirmed against the real ClickUp list.
- **adm-zip@0.5.17 pinned:** Specific version pinned per Package Legitimacy Audit in RESEARCH.md (verdict OK, npm, 13yr history, 17.8M dl/week).
- **Smoke script kept in repo:** `src/scheduler/smoke-upload.mjs` committed for reproducibility and future debugging; it is a dev tool, not part of the production pipeline.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed smoke createPost payload missing userId**
- **Found during:** Task 3 (smoke checkpoint resolution — empirical run)
- **Issue:** API returned 422 `"userId must be a string"` — original smoke script did not include `userId` in payload
- **Fix:** Added `GHL_USER_ID` to `REQUIRED` env var list, read from `process.env`, passed as `userId` in createPost payload
- **Files modified:** `src/scheduler/smoke-upload.mjs`
- **Verification:** Smoke passed with 201 Created
- **Committed in:** `4d4a470`

**2. [Rule 1 - Bug] Fixed post id extraction from wrong response path**
- **Found during:** Task 3 (smoke checkpoint resolution — empirical run)
- **Issue:** Original smoke read `data?.post?._id` which is always `undefined` in real response; actual id is at `data.results.post._id`
- **Fix:** Updated extraction to `data?.results?.post?._id ?? data?.post?._id` (correct path + defensive fallback)
- **Files modified:** `src/scheduler/smoke-upload.mjs`
- **Verification:** Smoke logs correct post._id (`6a3986c9d015d306b4628f35`)
- **Committed in:** `4d4a470`

**3. [Rule 2 - Missing Critical] Added GHL_USER_ID and token scope documentation to .env.example**
- **Found during:** Task 3 (smoke resolution revealed required userId and scope requirements)
- **Issue:** `.env.example` lacked `GHL_USER_ID` key and had no guidance on the 3 additional GHL token scopes discovered empirically
- **Fix:** Added `GHL_USER_ID=<user-id-ghl>` with explanation, added scope documentation block
- **Files modified:** `.env.example`
- **Committed in:** `9a3c481`

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 missing critical)
**Impact on plan:** All fixes needed for smoke correctness. The userId + response shape findings are essential inputs for Plano 02-02 — without them Plano 02 would have shipped broken code.

## Issues Encountered

- GHL upload endpoint returned 401 until `medias.write` + `medias.readonly` were added to the Private Integration Token. Resolved by user updating token scopes before re-running smoke.
- createPost `422 userId required` required adding `GHL_USER_ID` to `.env` and payload — auto-fixed (deviation 1 above).

## User Setup Required

User has already completed the following for this plan:
- Created "GHL Post ID" custom field (Text) in ClickUp list 901327135553 and added `CU_FIELD_GHL_POST_ID` UUID to `.env`
- Added `CU_FIELD_LINK_DO_POST` UUID to `.env`
- Added `GHL_ACCOUNT_ID` (`...Lm_17841440215631995`) to `.env`
- Added `GHL_USER_ID` (`6CuISGqrYj5gvxMYNnR4` — Lucas Manoel) to `.env`
- Added `medias.write`, `medias.readonly`, `users.readonly` scopes to GHL Private Integration Token

For Plano 02-02, no additional user setup should be required beyond what is already in `.env`.

## Known Stubs

None — this plan's outputs are foundational (config + dep install + smoke). No UI rendering or data flow to stub.

## Threat Flags

None — no new network endpoints or auth paths beyond the empirical smoke script (which is a dev tool, not part of the production server surface).

## Next Phase Readiness

**Wave 1 (02-02-PLAN.md) is unblocked.** All empirical blockers resolved:
- Config exposing all 6 Phase 2 vars (fail-fast)
- adm-zip available for zip extraction
- GHL upload+createPost flow confirmed working
- 3 critical implementation requirements documented (userId, response shape, token scopes)

**Plano 02-02 MUST:**
1. Include `userId: config.GHL_USER_ID` in every `createPost` call
2. Extract post id as `data.results.post._id` (not `data.post._id`)
3. Ensure deployment runbook lists the 3 required token scopes

---
*Phase: 02-agendamento-clickup-ghl*
*Completed: 2026-06-22*
