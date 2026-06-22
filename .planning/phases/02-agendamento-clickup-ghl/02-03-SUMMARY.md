---
phase: 02-agendamento-clickup-ghl
plan: 03
subsystem: scheduler
tags: [clickup, ghl, pipeline, carousel, validation, error-writeback, security, tdd, instagram, scheduling]

# Dependency graph
requires:
  - phase: 02-agendamento-clickup-ghl
    plan: 02
    provides: pipeline.js processTask/runSchedulerBatch; CF_ERRO_PUBLICACAO in config; single-media path; 56/56 tests GREEN
provides:
  - runSchedulerBatch: carousel multi-media support (mediaCount='multiple') + full validation + CF_ERRO_PUBLICACAO write-back
  - processTask: extended with date-past/Formato-invalid/no-content validation; per-task error write-back without status change
  - mapFormato: rejects empty/Stories/unknown with short safe messages
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "carousel: mediaCount='multiple' → upload ALL files in numeric order → media[] = N items; type='post' (NEVER 'carousel' — Pitfall 1/A1)"
    - "validation order: Formato → date → resolveContent → downloadAndExtract (minimize external work before rejecting)"
    - "error write-back: AppError.message (already normalized) or String(err.message).slice(0,200); NEVER zipUrl/token in message"
    - "batch isolation: per-task try/catch in runSchedulerBatch; failure → setCustomField(CF_ERRO_PUBLICACAO) + continue (D-18)"
    - "FORMATO_INVALIDO Set for explicit rejection of Stories (D-13); unknown formats also rejected"
    - "date validation: scheduleDateMs < Date.now() → throws 'Data no passado' before any GHL call (D-14)"
    - "TDD deviation: Task 2 RED tests passed immediately because Task 1 GREEN pre-covered validation behaviors in same file"

key-files:
  created: []
  modified:
    - src/scheduler/pipeline.js (carousel + validation + error write-back)
    - test/pipeline.test.js (11 new tests: 3 carousel + 8 validation/isolation/security)

key-decisions:
  - "Carousel uses type='post' + media[N] — NEVER type='carousel' (Pitfall 1 confirmed A1 in Wave 0)"
  - "All carousel files uploaded in numeric sort order (already guaranteed by downloadAndExtract); media[] preserves that order"
  - "Validation order: Formato (map lookup + mapFormato) → date (< Date.now()) → resolveContent → download; minimizes external calls before rejecting"
  - "Error message safety: derived from AppError.message or String(err.message).slice(0,200); zipUrl never flows into error message"
  - "Status unchanged on failure: setCustomField(CF_ERRO_PUBLICACAO, msg) only; NO updateTask — task stays STATUS_A_AGENDAR for retry (D-14/SCH-07)"
  - "FORMATO_INVALIDO Set with 'Stories' for explicit D-13 rejection; unknown orderindex → 'Formato vazio'"
  - "TDD: Task 2 validation behaviors pre-implemented in Task 1 GREEN (same pipeline.js file) — documented as deviation"

# Metrics
duration: 15min
completed: 2026-06-22
---

# Phase 02 Plan 03: Carrossel + Validação + Erro de Publicação Summary

**Carrossel agenda post único GHL com media[] de todos os arquivos em ordem numérica; validação completa de Formato/data/conteúdo bloqueia schedules inválidos com write-back seguro em CF_ERRO_PUBLICACAO; falhas isoladas nunca abortam o batch — 67/67 testes GREEN**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-06-22T19:30:00Z
- **Completed:** 2026-06-22T19:38:00Z
- **Tasks:** 2 (Task 1: carousel RED+GREEN; Task 2: validation RED, GREEN already present from Task 1)
- **Files created/modified:** 2

## Accomplishments

- **Task 1 (RED):** Added 3 carousel tests (Test 9: 3 files → 3 uploads + 1 createPost type='post' + media[3] in numeric order; Test 10: mapFormato Carrossel → ghlType='post' never 'carousel'; Test 11: Feed estático regression 1 upload + media[1]). RED confirmed: Test 9 failed `media[] deve ter 3 itens — 1 !== 3`.
- **Task 1 (GREEN):** Extended `processTask` in `pipeline.js`: `mediaCount='multiple'` uploads all files (in numeric order from downloadAndExtract) and builds `media[]` with N items; `mediaCount='single'` unchanged. Added `FORMATO_INVALIDO Set`, updated `mapFormato` with safe short messages for empty/Stories/unknown. Added date validation (`scheduleDateMs < Date.now()`). Added full `CF_ERRO_PUBLICACAO` write-back in batch catch (AppError.message, truncated to 200, no updateTask). Imported `AppError`.
- **Task 2 (RED):** Added 8 validation/isolation/security tests (Tests 12-19). All passed GREEN immediately because Task 1 GREEN pre-implemented validation behaviors — documented as TDD deviation.
- **Full suite:** 67/67 GREEN (56 original + 11 new).

## Contracts Extended

### `src/scheduler/pipeline.js` — extended processTask

```
processTask(task, formatoOptionsMap) → Promise<void>
  Validation (BEFORE any GHL call):
    1. Formato: formatoOptionsMap.get(Number(orderindex)) → mapFormato(label)
       - null/missing orderindex → throws 'Formato vazio'
       - Stories → throws 'Formato Stories não suportado'
       - Unknown → throws 'Formato X não suportado'
    2. Date: scheduleDateMs < Date.now() → throws 'Data no passado'
    3. resolveContent: throws if legenda/link missing after fallback (existing behavior)
    4. downloadAndExtract: throws if zip inaccessible/invalid (existing security guards)
  
  Media (D-10):
    - mediaCount='multiple' (Carrossel): upload ALL files in numeric order → media[] = N items
    - mediaCount='single' (Reels/Feed): upload first file only → media[0..0]
    - payload.type: 'post' | 'reel' — NEVER 'carousel' (Pitfall 1/A1)

runSchedulerBatch() — catch block (per-task isolation D-18):
  err instanceof AppError ? err.message : String(err?.message ?? 'Erro desconhecido')
  truncated to MAX_ERRO_MSG_LEN (200 chars)
  → clickup.setCustomField(task.id, config.CF_ERRO_PUBLICACAO, mensagem)
  → NO updateTask — status stays STATUS_A_AGENDAR for retry (D-14/SCH-07)
  → if setCustomField itself fails → warn log only, batch continues
```

### `mapFormato(name)` — updated signature

```
mapFormato(null|'') → throws 'Formato vazio'
mapFormato('Stories') → throws 'Formato Stories não suportado'
mapFormato('Unknown') → throws 'Formato Unknown não suportado'
mapFormato('Reels')   → {ghlType:'reel', mediaCount:'single'}
mapFormato('Carrossel') → {ghlType:'post', mediaCount:'multiple'}
mapFormato('Feed estático') → {ghlType:'post', mediaCount:'single'}
```

## TDD Gate Compliance

| Gate | Commit | Type | Description |
|------|--------|------|-------------|
| RED (Task 1) | ef371cd | test(02-03) | Carousel tests: Test 9 fails (media[1] != 3) — proven RED |
| GREEN (Task 1) | bd2ff77 | feat(02-03) | Carousel + validation + error write-back implemented; 59/59 pass |
| RED (Task 2) | 8ae10ac | test(02-03) | Validation/isolation/security tests added; all pass immediately |
| GREEN (Task 2) | bd2ff77 | feat(02-03) | Pre-implemented in Task 1 GREEN (same file) — see deviation below |

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as specified.

### TDD Deviation: Task 2 RED tests passed immediately

**1. [TDD - Pre-implemented] Task 2 RED tests GREEN from the start**
- **Found during:** Task 2 RED phase
- **Issue:** Task 2's validation tests (Formato/Stories/date/legenda/link/isolation/security) all passed GREEN immediately after being written
- **Root cause:** Task 1's GREEN implementation of `pipeline.js` already included all validation behaviors (mapFormato throws, date check, write-back in catch) because they're in the same file and logically intertwined with the carousel feature
- **Resolution:** Documented as TDD deviation — tests still serve as behavioral specification and regression protection; behaviors are correctly implemented and verified
- **TDD compliance:** RED gate proven for Task 1 (carousel test), and Task 1 GREEN commit covers Task 2 behaviors — all 67 tests GREEN on final run

## Task Commits

1. **Task 1 (RED):** `ef371cd` — `test(02-03): RED — carousel multi-media + regressão single-media`
2. **Task 1 (GREEN):** `bd2ff77` — `feat(02-03): carousel multi-media support — todos os arquivos em ordem numérica (SCH-04/D-10)`
3. **Task 2 (RED):** `8ae10ac` — `test(02-03): RED — validação completa + write-back Erro de publicação + isolamento (SCH-07)`

## Security (D-15 / T-02-03)

All threat model items mitigated:

| Threat ID | Status |
|-----------|--------|
| T-02-03 (Info Disclosure via CF_ERRO_PUBLICACAO) | Mitigated: message from AppError.message (no raw body); truncated 200 chars; zipUrl never flows into message; Test 19 asserts no http/pit-/pk_ |
| T-02-09 (Tampering via invalid Formato/Date) | Mitigated: Formato validated before any GHL call; Stories/empty/unknown rejected; date past rejected; Test 12-14 verify |
| T-02-10 (DoS: 1 task breaks batch) | Mitigated: per-task try/catch; failure → write-back + continue; Test 18 proves 3-task batch with failing first task |

## Known Stubs

None — this plan completes the full pipeline including all validation cases and error write-back.

## Threat Flags

None — no new trust boundaries or network endpoints introduced beyond what the threat model covers.

## Self-Check

- [x] `src/scheduler/pipeline.js` exists and has CF_ERRO_PUBLICACAO write-back (grep confirmed at lines 26, 290, 371, 374)
- [x] `test/pipeline.test.js` exists with 23 pipeline tests
- [x] All 67 tests GREEN (`node --test`: 67 pass, 0 fail)
- [x] Commits ef371cd, bd2ff77, 8ae10ac exist in git log
- [x] No regression in 02-02 tests (56 original tests still pass)

## Self-Check: PASSED
