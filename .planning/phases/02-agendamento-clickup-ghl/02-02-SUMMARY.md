---
phase: 02-agendamento-clickup-ghl
plan: 02
subsystem: scheduler
tags: [clickup, ghl, pipeline, zip, security, tdd, instagram, scheduling]

# Dependency graph
requires:
  - phase: 02-agendamento-clickup-ghl
    plan: 01
    provides: config EnvSchema (6 Phase 2 vars), adm-zip, GHL_USER_ID discovery, empirical smoke findings
provides:
  - runSchedulerBatch: batch pipeline ClickUp→GHL (detect+idempotency+resolve+download+upload+schedule+writeback)
  - src/lib/zip.js: downloadAndExtract with 4 security guards (SSRF/zip-bomb/magic-bytes/zip-slip)
  - src/clients/clickup.js: getListTasks with auto-pagination
  - src/clients/ghl.js: uploadMedia multipart + createPost with userId + JSDoc updated
  - GHL_USER_ID added to config EnvSchema (fail-fast) and frozen export
affects: [02-03-PLAN.md]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "zip security guards: SSRF(https-only) + zip-bomb(100MB limit) + magic-bytes(PK\\x03\\x04) + zip-slip(basename+relative guard)"
    - "createPost payload MUST include userId: config.GHL_USER_ID (422 without it)"
    - "createPost response: post id at res.results.post._id (not res.post._id) — defensive fallback kept"
    - "uploadMedia: native Node 24 FormData+Blob, no Content-Type manual (boundary auto)"
    - "getListTasks: while(true) pagination via page param until tasks[] empty"
    - "pipeline isolation: per-task try/catch; failure does not abort batch (D-18)"
    - "try/finally cleanupTmp: always runs regardless of success or failure (D-11)"
    - "resolveContent: field-by-field fallback to mother task independently (D-04/D-05/D-06)"

key-files:
  created:
    - src/lib/zip.js
    - src/scheduler/pipeline.js
    - test/zip.test.js
    - test/pipeline.test.js
  modified:
    - src/clients/clickup.js (getListTasks added)
    - src/clients/ghl.js (uploadMedia added, createPost JSDoc expanded)
    - src/config/index.js (GHL_USER_ID added to EnvSchema + frozen export)
    - src/index.js (runSchedulerBatch wired after boot() when !SMOKE_ONLY)
    - test/config.test.js (FULL_ENV + 2 new GHL_USER_ID tests)

key-decisions:
  - "GHL_USER_ID added to config schema as required (z.string().min(1)) — 422 without it in createPost"
  - "CF_LEGENDA/CF_DATA_PUBLICACAO/CF_ID_TASK_MAE sourced from existing config vars (already in Phase 1 schema) — no new env vars needed"
  - "Post id extraction: res?.results?.post?._id ?? res?.post?._id (defensive fallback to support potential API shape changes)"
  - "Formato labels confirmed live: Reels/Carrossel/Stories/Feed estático — FORMATO_MAP uses these exact labels"
  - "Formato orderindex read from ClickUp dropdown field value; mapped via getListFields bootstrap in runSchedulerBatch"
  - "Mother task fallback: field-by-field independent (legenda and link resolved separately, each falls back to mother if empty)"
  - "Plano 02 handles single media only (first file); Plano 03 extends to carousel (multiple files)"
  - "GHL upload url returned from uploadMedia used directly in media[].url (A2 confirmed empirically in Wave 0)"

# Metrics
duration: 90min
completed: 2026-06-22
---

# Phase 02 Plan 02: Core Vertical Slice Summary

**Batch pipeline ClickUp→GHL implemented ponta-a-ponta: detects 'a agendar' tasks, downloads MinIO zip with 4 security guards, uploads media to GHL, creates scheduled post with userId, writes back 'agendado' + GHL Post ID — 56/56 tests GREEN**

## Performance

- **Duration:** ~90 min
- **Started:** 2026-06-22T18:00:00Z
- **Completed:** 2026-06-22T19:23:00Z
- **Tasks:** 3 (Task 1: RED tests + getListTasks; Task 2: zip.js + uploadMedia; Task 3: pipeline.js GREEN + index.js wire)
- **Files created/modified:** 9

## Accomplishments

- **Task 1 (RED):** Added `getListTasks` to clickup client (pagination, statuses[] query string). Added `GHL_USER_ID` to config EnvSchema (required, fail-fast). Created `test/pipeline.test.js` with E2E and idempotency tests in RED (pipeline not yet existing), getListTasks tests GREEN.
- **Task 2 (GREEN for zip/upload):** Created `src/lib/zip.js` with `downloadAndExtract` (4 security guards), `cleanupTmp`, `mimeFromFilename`. Added `ghl.uploadMedia` (pRetry-wrapped, no Content-Type manual, returns {url,fileId}). Created `test/zip.test.js` with 16 tests all GREEN.
- **Task 3 (GREEN for pipeline):** Created `src/scheduler/pipeline.js` with `runSchedulerBatch`, `processTask`, `resolveContent`, `readCF`, `mapFormato`. Wired in `src/index.js` after boot() when !SMOKE_ONLY. Expanded pipeline tests to 12 tests all GREEN. Full suite: 56/56 GREEN.

## Contracts Established

### `src/lib/zip.js`

```
downloadAndExtract(zipUrl: string) → Promise<{ files: Array<{name, path, buffer}>, tmpDir: string }>
  Throws: SSRF (non-https), zip-bomb (>100MB), magic-bytes (not PK\x03\x04), zip-slip (../ traversal)
  Filters: __MACOSX, .DS_Store, directories
  Order: numeric sort (parseInt) with localeCompare fallback

cleanupTmp(tmpDir: string) → Promise<void>
  Always silent (catch() → no-op)

mimeFromFilename(filename: string) → string
  .jpg/.jpeg → image/jpeg, .mp4 → video/mp4, .mov → video/quicktime, .png → image/png, .webp → image/webp, .gif → image/gif
  Unknown → application/octet-stream
```

### `src/scheduler/pipeline.js`

```
runSchedulerBatch() → Promise<void>
  1. getListTasks(CLICKUP_LIST_ID, STATUS_A_AGENDAR)
  2. getListFields → build formatoOptionsMap (orderindex→label)
  3. Filter: CF_DATA_PUBLICACAO non-null AND CF_GHL_POST_ID empty (idempotency)
  4. Per-task: processTask in try/catch isolation (D-18)

processTask(task, formatoOptionsMap) → Promise<void>
  resolveContent → mapFormato → downloadAndExtract (in try/finally cleanupTmp)
  → uploadMedia → createPost (with userId) → updateTask(agendado) → setCustomField(CF_GHL_POST_ID)

resolveContent(task) → Promise<{legenda, linkDoPost}>
  Field-by-field fallback: if legenda empty → getTask(CF_ID_TASK_MAE) → read CF_LEGENDA
                           if linkDoPost empty → getTask(CF_ID_TASK_MAE) → read CF_LINK_DO_POST
  (One getTask call if either field needs fallback)

readCF(task, fieldId) → value | null
mapFormato(name) → {ghlType: 'post'|'reel', mediaCount: 'single'|'multiple'}
  FORMATO_MAP: Reels→reel/single, Carrossel→post/multiple, Feed estático→post/single
```

### `src/clients/clickup.js` — new: `getListTasks`

```
getListTasks(listId, statusFilter) → Promise<Array<task>>
  Paginates with while(true) using page param; stops when tasks[] empty
  Query: statuses[]=<statusFilter>&include_closed=false&subtasks=false&page=N
```

### `src/clients/ghl.js` — new: `uploadMedia`

```
uploadMedia(fileBuffer, fileName, mimeType) → Promise<{url, fileId}>
  POST /medias/upload-file (multipart/form-data, no Content-Type header manual)
  pRetry(retries=3); 4xx → AbortError(AppError); 429 → wait+retry; 5xx → retry
  Returns: {url, fileId} (A2 confirmed: url usable in createPost media[].url)
```

## Critical Corrections Applied (from empirical smoke Wave 0)

### Correction 1: `userId` in createPost payload (MANDATORY)

- **Issue:** GHL API returns 422 `"userId must be a string"` without it
- **Fix:** Added `GHL_USER_ID` to config EnvSchema as required (`z.string().min(1)`), exposed on frozen config, passed as `userId: config.GHL_USER_ID` in every createPost call
- **Test stubs updated:** createPost stubs return real shape `{results:{post:{_id:'PID123'}}}`

### Correction 2: Post id at `res.results.post._id` (not `res.post._id`)

- **Issue:** Plan's Task 1 stub and Task 3 action referenced `res?.post?._id` (wrong)
- **Fix:** Extraction: `res?.results?.post?._id ?? res?.post?._id` (correct path + defensive fallback)
- **All test stubs:** Return `{success:true, statusCode:201, results:{post:{_id:'PID123'}}, traceId:'...'}`

### Correction 3: `GHL_USER_ID` added to config EnvSchema

- **Issue:** Not in Phase 1 schema, only in `.env`
- **Fix:** Added `GHL_USER_ID: z.string().min(1, {...})` to EnvSchema and `GHL_USER_ID: env.GHL_USER_ID` to frozen export
- **Tests:** 2 new tests in `test/config.test.js` (presence + fail-fast); config suite now 12/12

## Field IDs Sourcing Decision (CF_LEGENDA / CF_DATA_PUBLICACAO / CF_ID_TASK_MAE)

These three fields were already present in the config schema from Phase 1 (Plan 01-01):
- `CF_LEGENDA` ← `CU_FIELD_LEGENDA` = `91c07244-6ce6-42c7-bea2-ec49dba12fd3`
- `CF_DATA_PUBLICACAO` ← `CU_FIELD_DATA_PUBLICACAO` = `d5107244-d044-4bd0-ae5c-c07f8a4f194e`
- `CF_ID_TASK_MAE` ← `CU_FIELD_ID_TASK_MAE` = `3f37fbaa-93d0-4344-9fe2-f7c2c7320383`

**Decision:** Used existing config vars directly — no new env vars needed. UUIDs match the real Auton ClickUp list `901327135553` field IDs provided in the `real_clickup_field_ids` authoritative reference.

## Formato Labels Confirmation

Real dropdown options confirmed via live API during Phase 1 boot (Wave 0 log output):

| orderindex | label | GHL type | mediaCount |
|------------|-------|----------|------------|
| 0 | Reels | reel | single |
| 1 | Carrossel | post | multiple |
| 2 | Stories | (invalid in Phase 2, D-13) | — |
| 3 | Feed estático | post | single |

`FORMATO_MAP` uses these exact labels. The plan mentioned "Sequência" as a possible option in other workspaces — it was NOT present in the live Auton list. `Sequência` is mapped defensively as `post/single` in `FORMATO_MAP`.

**Flag for Plano 03:** Confirm Formato labels haven't changed before extending to carousel. The live labels may drift if the user renames dropdown options in ClickUp.

## GHL upload url vs fileId (A2 Decision)

Wave 0 smoke confirmed (A2): the `url` returned by `POST /medias/upload-file` is directly usable in `media[].url` of createPost — no need to use `fileId`. Pipeline uses `url` from upload response. `fileId` is also captured (`{url, fileId}`) in case Plano 03 needs it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added GHL_USER_ID to config schema**
- **Found during:** Pre-execution (critical_empirical_corrections instruction)
- **Issue:** GHL_USER_ID was in `.env` but NOT in EnvSchema → no fail-fast, no config.GHL_USER_ID access
- **Fix:** Added `GHL_USER_ID: z.string().min(1, {...})` to EnvSchema; added `GHL_USER_ID: env.GHL_USER_ID` to frozen config; added 2 new config tests; updated FULL_ENV
- **Files modified:** `src/config/index.js`, `test/config.test.js`
- **Commit:** `7532e27`

**2. [Rule 1 - Bug] Fixed createPost test stubs to use real response shape**
- **Found during:** Task 1 (plan's stubs used wrong shape `{post:{_id:'PID123'}}`)
- **Fix:** Changed all createPost stubs to `{results:{post:{_id:'PID123'}}}` with defensive fallback in pipeline
- **Files modified:** `test/pipeline.test.js`
- **Commit:** `32ddfac`

**3. [Rule 1 - Bug] Fixed MinIO stub in E2E test to return valid zip bytes**
- **Found during:** Task 3 GREEN phase — E2E test failed with "magic bytes inválidos"
- **Issue:** Original MinIO stub returned `PK\x05\x06` (end-of-central-directory) instead of `PK\x03\x04` (local file header) — magic bytes guard correctly rejected it
- **Fix:** Used `AdmZip` in test to generate a proper zip buffer with real `PK\x03\x04` magic bytes
- **Files modified:** `test/pipeline.test.js` (added `makeZipBuffer` helper + updated stub)
- **Commit:** `32ddfac`

## Task Commits

1. **Task 1 (RED):** `7532e27` — `test(02-02): RED — pipeline E2E + idempotência + getListTasks + GHL_USER_ID config`
2. **Task 2 (GREEN zip/upload):** `1622ec7` — `feat(02-02): zip.js security guards + ghl.uploadMedia (Task 2 GREEN)`
3. **Task 3 (GREEN pipeline):** `32ddfac` — `feat(02-02): pipeline.js batch orchestration + index.js wire (Task 3 GREEN)`

## TDD Gate Compliance

| Gate | Commit | Type | Description |
|------|--------|------|-------------|
| RED | 7532e27 | test(02-02) | Failing tests for E2E+idempotency (pipeline.js absent); getListTasks passing |
| GREEN | 1622ec7 + 32ddfac | feat(02-02) | zip.js + pipeline.js implement the tested behaviors |
| REFACTOR | — | — | No refactor needed |

RED gate: 2 tests fail for "Cannot find module pipeline.js" — proven RED. GREEN gate: all 56 tests pass.

## Known Stubs

None — this plan implements the full happy-path pipeline. The only intentional deferral is Plano 03's write-back of `CF_ERRO_PUBLICACAO` on failure (pipeline currently logs error and continues, per D-18; the ClickUp field write-back is Plano 03 scope).

## Threat Flags

None — all threat model items (T-02-03 through T-02-08) were mitigated in this plan. No new network endpoints or trust boundaries introduced beyond what the threat model covers.

## Self-Check

Files created/modified all committed and accessible. Commits verified via `git log`.
