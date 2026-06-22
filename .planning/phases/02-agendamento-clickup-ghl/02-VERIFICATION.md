---
phase: 02-agendamento-clickup-ghl
verified: 2026-06-22T19:55:00Z
status: human_needed
score: 12/12 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Confirm that the UUIDs stored in .env for CF_LEGENDA, CF_DATA_PUBLICACAO, CF_ERRO_PUBLICACAO, CF_ID_TASK_MAE, CF_IG_MEDIA_ID, and CF_LINK_PUBLICADO exactly match the live custom field UUIDs on ClickUp list 901327135553"
    expected: "Each UUID resolves to the correct named field in the real Auton workspace; mis-matched UUIDs would silently read/write the wrong field or null"
    why_human: "The unit tests mock fetch; they cannot verify that the UUIDs in .env point to the correct live ClickUp fields. This was explicitly flagged in the verification instruction as a recommended human/integration check."
  - test: "Run npm start (without SMOKE_ONLY) against at least one real task in status 'a agendar' with Data de publicacao filled"
    expected: "Task transitions to 'agendado' in ClickUp and a scheduled post appears in GHL Social Planner for auton.app with the correct schedule date, caption, and media"
    why_human: "All pipeline tests are mock-based; live end-to-end correctness of createPost payload shape, account wiring, and ClickUp write-back cannot be confirmed without a real integration run"
---

# Phase 02: Agendamento ClickUp→GHL Verification Report

**Phase Goal:** Entregar o fluxo de valor principal de ponta a ponta — uma task marcada `a agendar` com `Data de publicação` preenchida vira um post agendado no GHL Social Planner para o Instagram (auton.app), e a task retorna como `agendado` com o id do post salvo em CF_GHL_POST_ID. Inclui carrossel multi-mídia, validação completa de Formato/data/conteúdo, e write-back de Erro de publicação mantendo a task em `a agendar` para retry.
**Verified:** 2026-06-22T19:55:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Service fails at boot (fail-fast) if any of the required .env vars is missing | VERIFIED | `src/config/index.js` lines 62-69: `EnvSchema.safeParse(process.env)` → `process.exit(1)` on failure; 6 config tests confirm fail-fast per missing var |
| 2  | config exposes CF_GHL_POST_ID, CF_LINK_DO_POST, CF_FORMATO, GHL_ACCOUNT_ID, GHL_USER_ID, STATUS_A_AGENDAR, STATUS_AGENDADO | VERIFIED | `src/config/index.js` lines 113-120: all 7 keys present in `Object.freeze({})` export |
| 3  | adm-zip 0.5.17 installed and ESM-importable | VERIFIED | `package.json` line 24: `"adm-zip": "^0.5.17"`; `node --input-type=module -e "import AdmZip from 'adm-zip'; new AdmZip()"` exits 0 with "adm-zip ESM OK" |
| 4  | runSchedulerBatch detects tasks with status 'a agendar' and filled Data de publicacao and ignores the rest (SCH-01) | VERIFIED | `pipeline.js` lines 299, 332-343: getListTasks + eligibility filter; test 4 (elegibilidade) GREEN |
| 5  | Task with GHL Post ID already filled is skipped before any GHL call (SCH-06) | VERIFIED | `pipeline.js` lines 339-341: `if (ghlPostId) return false` before processTask; test 3 (idempotência) GREEN |
| 6  | Legenda and link resolved from child task, with field-by-field fallback to mother task when empty (SCH-02) | VERIFIED | `pipeline.js` lines 135-174: `resolveContent` with independent field-by-field fallback via `clickup.getTask`; tests 5a/5b GREEN |
| 7  | Zip downloaded, validated (https + magic bytes + size), extracted with zip-slip guard, sorted numerically, files uploaded to GHL media library (SCH-03) | VERIFIED | `src/lib/zip.js` full implementation with all 4 guards (SSRF, zip-bomb, magic bytes, zip-slip); 9 zip tests GREEN |
| 8  | Single-media post (Reels/Feed) created scheduled in GHL for auton.app at Data de publicacao time (SCH-04) | VERIFIED | `pipeline.js` lines 247-258: createPost payload with accountIds, userId, scheduleDate (epochMs→ISO), type, media, status='scheduled'; test 2 E2E GREEN |
| 9  | Carousel (Formato='Carrossel') schedules a single GHL post with type='post' and media[] of ALL extracted files in numeric order — never type='carousel' (SCH-04) | VERIFIED | `pipeline.js` lines 231-241: `mediaCount === 'multiple'` uploads all files; `type` from `mapFormato` is 'post' for Carrossel; test 9 (3 files, 3 uploads, 1 createPost, type='post') GREEN |
| 10 | On success, task becomes 'agendado' and res.results.post._id is saved to CF_GHL_POST_ID (SCH-05) | VERIFIED | `pipeline.js` line 262: `res?.results?.post?._id ?? res?.post?._id`; lines 273-276: updateTask then setCustomField; test 2 asserts value='PID123' from results.post._id GREEN |
| 11 | On any failure (validation or GHL/MinIO error), CF_ERRO_PUBLICACAO receives a short human message without stack trace, URL, or token; task stays in 'a agendar' (SCH-07) | VERIFIED | `pipeline.js` lines 360-382: per-task catch, message truncated to 200 chars, setCustomField(CF_ERRO_PUBLICACAO) without updateTask; test 19 asserts no http/pit-/pk_ GREEN |
| 12 | An isolated failure in one task does not abort processing of remaining tasks in the batch (D-18) | VERIFIED | `pipeline.js` lines 353-383: per-task try/catch with continue; test 18 (3 tasks, first fails, last two succeed) GREEN |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/config/index.js` | Zod schema + CF_* aliases for 6 new Phase 2 vars | VERIFIED | Lines 46-54: CU_FIELD_GHL_POST_ID, CU_FIELD_LINK_DO_POST, CU_FIELD_FORMATO (uuid), GHL_ACCOUNT_ID, GHL_USER_ID (min(1)), STATUS_A_AGENDAR/STATUS_AGENDADO (with defaults) |
| `package.json` | adm-zip dependency | VERIFIED | Line 24: `"adm-zip": "^0.5.17"` |
| `test/config.test.js` | Fail-fast + Phase 2 key presence assertions | VERIFIED | 6 Phase 2 test cases confirmed passing (config tests 7-12) |
| `src/lib/zip.js` | downloadAndExtract, cleanupTmp, mimeFromFilename | VERIFIED | 191 lines; all 3 exports present; 4 security guards implemented |
| `src/scheduler/pipeline.js` | runSchedulerBatch, processTask, resolveContent, readCF, mapFormato | VERIFIED | 387 lines; all 5 exports present and wired |
| `src/clients/clickup.js` | getListTasks with auto-pagination | VERIFIED | Lines 179-194: while(true) pagination with URLSearchParams statuses[] |
| `src/clients/ghl.js` | uploadMedia multipart + createPost with userId | VERIFIED | Lines 125-175: uploadMedia without Content-Type manual; createPost JSDoc updated with userId requirement and results.post._id shape |
| `src/index.js` | runSchedulerBatch wired after boot() when !SMOKE_ONLY | VERIFIED | Lines 18, 107-110: import and conditional call |
| `test/zip.test.js` | Security guard + functional tests for zip.js | VERIFIED | 16 tests, all passing |
| `test/pipeline.test.js` | E2E + idempotency + carousel + validation tests | VERIFIED | 23 pipeline tests, all passing |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/scheduler/pipeline.js` | `src/clients/clickup.js getListTasks` | `clickup.getListTasks(config.CLICKUP_LIST_ID, config.STATUS_A_AGENDAR)` | WIRED | pipeline.js line 299 |
| `src/scheduler/pipeline.js` | `src/lib/zip.js downloadAndExtract` | `downloadAndExtract(linkDoPost)` | WIRED | pipeline.js line 222 |
| `src/scheduler/pipeline.js` | `src/clients/ghl.js uploadMedia + createPost` | `ghl.uploadMedia(...)` / `ghl.createPost(payload)` | WIRED | pipeline.js lines 239, 258 |
| `src/scheduler/pipeline.js` | `src/clients/clickup.js write-back` | `setCustomField(task.id, config.CF_GHL_POST_ID, postId)` | WIRED | pipeline.js line 276 |
| `src/scheduler/pipeline.js` | `src/clients/clickup.js CF_ERRO_PUBLICACAO` | `setCustomField(task.id, config.CF_ERRO_PUBLICACAO, mensagem)` | WIRED | pipeline.js line 374 |
| `src/index.js` | `src/scheduler/pipeline.js runSchedulerBatch` | `await runSchedulerBatch()` when `!process.env.SMOKE_ONLY` | WIRED | index.js lines 18, 107-110 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `pipeline.js processTask` | `legenda`, `linkDoPost` | `resolveContent` → `readCF` from task.custom_fields / clickup.getTask fallback | Yes — reads from task.custom_fields array via field UUID lookup | FLOWING |
| `pipeline.js processTask` | `postId` | `ghl.createPost` → `res?.results?.post?._id` | Yes — correct extraction path confirmed empirically (Wave 0) | FLOWING |
| `pipeline.js runSchedulerBatch` | `tasks` | `clickup.getListTasks` → paginated GET /list/{id}/task | Yes — real HTTP call to ClickUp API | FLOWING |
| `pipeline.js runSchedulerBatch` | `formatoOptionsMap` | `clickup.getListFields` → type_config.options | Yes — real HTTP call to ClickUp API | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| adm-zip ESM importable | `node --input-type=module -e "import AdmZip from 'adm-zip'; new AdmZip(); console.log('adm-zip ESM OK')"` | exit 0, "adm-zip ESM OK" | PASS |
| Full test suite 67/67 | `node --test` | 67 pass, 0 fail, 0 skip | PASS |
| No TBD/FIXME/XXX in src/ | grep scan on src/ | No debt markers found | PASS |

### Probe Execution

No probe scripts declared in PLAN files. Phase 2 Wave 0 empirical smoke (`src/scheduler/smoke-upload.mjs`) was run by the executor during the human checkpoint — not re-run here (requires live GHL token). The smoke result is documented in 02-01-SUMMARY.md and is a human-executed artifact.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| SCH-01 | 02-01, 02-02 | Detect tasks with status 'a agendar' and filled Data de publicacao | SATISFIED | getListTasks + eligibility filter; test 4 GREEN |
| SCH-02 | 02-02 | Resolve content with fallback to mother task | SATISFIED | resolveContent field-by-field fallback; tests 5a/5b GREEN |
| SCH-03 | 02-02 | Make media available for GHL (download + upload) | SATISFIED | zip.js + uploadMedia; zip tests + E2E GREEN |
| SCH-04 | 02-02, 02-03 | Create scheduled post in GHL for Instagram, respecting Formato | SATISFIED | processTask createPost with all Formato branches; tests 2, 9, 11 GREEN |
| SCH-05 | 02-02 | On success, move task to 'agendado' and persist GHL post id | SATISFIED | updateTask + setCustomField(CF_GHL_POST_ID, res.results.post._id); test 2 GREEN |
| SCH-06 | 02-01, 02-02 | Idempotency — skip task that already has GHL post id | SATISFIED | eligibility filter `if (ghlPostId) return false`; test 3 GREEN |
| SCH-07 | 02-02, 02-03 | On failure, fill Erro de publicacao and keep task in 'a agendar' | SATISFIED | per-task catch with setCustomField(CF_ERRO_PUBLICACAO); tests 12-19 GREEN |

**All 7 SCH requirements from REQUIREMENTS.md (Phase 2 block) are SATISFIED.**

Note: Plan 02-01 frontmatter lists `requirements: [SCH-01, SCH-03, SCH-04, SCH-05, SCH-06, SCH-07]` — SCH-02 is listed only in 02-02 but was partially set up in Wave 0 (config exposing CF_LEGENDA, CF_LINK_DO_POST). All 7 are fully satisfied by the three plans combined.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None found | — | No TBD/FIXME/XXX/TODO/PLACEHOLDER/return null/hardcoded empty in Phase 2 source files | — | — |

Debt marker scan of `src/config/index.js`, `src/clients/clickup.js`, `src/clients/ghl.js`, `src/lib/zip.js`, `src/scheduler/pipeline.js`, `src/index.js`: clean.

### Human Verification Required

#### 1. Live ClickUp Custom Field UUID Validation

**Test:** Open ClickUp workspace → list 901327135553 → Custom Fields. For each of the following fields, confirm the UUID in `.env` matches the field UUID shown in ClickUp: CF_LEGENDA, CF_DATA_PUBLICACAO, CF_ERRO_PUBLICACAO, CF_ID_TASK_MAE, CF_IG_MEDIA_ID, CF_LINK_PUBLICADO (Phase 1 fields) and CF_GHL_POST_ID, CF_LINK_DO_POST, CF_FORMATO (Phase 2 fields).
**Expected:** Each .env UUID resolves to the correct named field. A mismatch would cause the pipeline to silently read null or write to the wrong field.
**Why human:** Unit tests mock fetch; they cannot verify that the stored UUIDs point to the correct live fields in the real Auton workspace. The executor noted this explicitly in the verification instruction.

#### 2. Live End-to-End Integration Run

**Test:** With a real task in ClickUp list 901327135553 set to status `a agendar` with `Data de publicacao` set to a future date, `Legenda` filled, and `Link do post` pointing to a valid MinIO zip, run `npm start` (without SMOKE_ONLY).
**Expected:** The task status changes to `agendado` in ClickUp, the GHL Post ID custom field is filled with the new post id, and a scheduled post appears in the GHL Social Planner for the Instagram `auton.app` account at the specified time with correct caption and media.
**Why human:** All 67 tests use mocked HTTP responses. Live correctness of the API payload shape, token scopes, account wiring, and ClickUp write-back sequence cannot be confirmed by mock-based tests alone.

### Gaps Summary

No automated gaps found. All 12 must-have truths are verified by code inspection and the 67/67 green test suite. The two human verification items above are the only remaining open items — they are integration-layer checks that require live credentials and cannot be substituted by automated verification.

**Empirical context honored (per instructions):**
- `pipeline.js` line 249: `userId: config.GHL_USER_ID` — present and required
- `pipeline.js` line 262: `res?.results?.post?._id ?? res?.post?._id` — correct extraction path (results.post._id first, defensive fallback)
- Carousel uses `type: 'post'` (never 'carousel') — confirmed in mapFormato and test 10

---

_Verified: 2026-06-22T19:55:00Z_
_Verifier: Claude (gsd-verifier)_
