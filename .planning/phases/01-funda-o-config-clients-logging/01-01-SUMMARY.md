---
phase: 01-funda-o-config-clients-logging
plan: 01
subsystem: infra
tags: [node, esm, zod, dotenv, pino, bottleneck, p-retry, clickup, ghl, instagram]

# Dependency graph
requires: []
provides:
  - "package.json ESM scaffold com Node 24, scripts start/smoke/test e lockfile"
  - "src/config/index.js: config validada com zod, fail-fast, exportada congelada"
  - "src/lib/logger.js: pino com redaction de authorization/token + withContext(fields)"
  - "src/lib/errors.js: AppError normalizado com fromClickUp/fromGHL"
  - "src/clients/clickup.js: client autenticado pk_, bottleneck 100/60s, p-retry"
  - "src/clients/ghl.js: client autenticado Bearer pit- + Version header, p-retry"
  - "src/index.js: boot() exportado e testável; entrypoint direto funcionando"
  - "test/smoke.test.js: 3 testes de integração ponta-a-ponta (node:test nativo)"
affects: [02-agendamento, 03-webhook-sync, 04-operacao]

# Tech tracking
tech-stack:
  added:
    - "Node.js 24 LTS (fetch nativo — sem axios/undici/node-fetch)"
    - "zod 4.4.3 (validação de schema do env)"
    - "dotenv 17.4.2 (carregamento de .env)"
    - "pino 10.3.1 (logging estruturado JSON)"
    - "pino-pretty 13.1.3 (devDep — pretty-print em dev)"
    - "bottleneck 2.19.5 (rate limit 100/min no client ClickUp)"
    - "p-retry 8.0.0 (retry exponencial em 429/5xx)"
  patterns:
    - "Config fail-fast: dotenv → zod.safeParse → process.exit(1) com mensagem clara antes de qualquer I/O"
    - "Config freeze: Object.freeze(parsed.data) para imutabilidade em runtime"
    - "Env var mapping: CU_FIELD_* do .env → CF_* aliases no objeto config exportado"
    - "Client wrapper: request() centraliza auth headers, throttle (ClickUp), retry e erro normalizado"
    - "pRetry.AbortError para erros 4xx não-retentáveis (sem retry cego)"
    - "withContext(fields) para child loggers com {taskId, ghlPostId, action}"
    - "Redaction pino em authorization/token — tokens nunca vazam em log"
    - "fileURLToPath(import.meta.url) para detecção confiável de entrypoint no Windows/Linux"

key-files:
  created:
    - "package.json"
    - "package-lock.json"
    - ".nvmrc"
    - "src/config/index.js"
    - "src/lib/logger.js"
    - "src/lib/errors.js"
    - "src/clients/clickup.js"
    - "src/clients/ghl.js"
    - "src/index.js"
    - "test/smoke.test.js"
  modified: []

key-decisions:
  - "fetch nativo do Node 24 em vez de axios/node-fetch/undici — zero dependência adicional"
  - "ESM (type: module) consistente em todo o projeto — extensões .js explícitas nos imports"
  - "CU_FIELD_* no .env mapeados para CF_* no config exportado — compatibilidade com .env.example existente"
  - "GHL response shape: { results: { accounts: [...] } } — diferente do assumido no plano"
  - "pino-pretty apenas em dev (NODE_ENV !== production) — JSON puro em prod"
  - "AppError.AbortError evita retry em 4xx (400/401/422) — só retentar 429/5xx"

patterns-established:
  - "Pattern Config: único módulo valida o env inteiro; todo o resto importa config, nunca process.env diretamente"
  - "Pattern Client: request() privado injeta auth, throttle e retry; callers só veem métodos de domínio"
  - "Pattern Logger: logger raiz + withContext para child loggers de operação"
  - "Pattern Error: AppError normalizado com status/code/api — nunca loga headers nem body bruto"

requirements-completed: [CFG-01, CFG-02, CFG-03, CFG-04]

# Metrics
duration: 8min
completed: 2026-06-22
---

# Phase 1 Plan 01: Walking Skeleton — Config + Clients + Logging Summary

**Node ESM scaffold com zod fail-fast, pino redaction, clients ClickUp (bottleneck 100/min) e GHL (Bearer+Version) autenticados ao vivo, smoke test 3/3 GREEN contra as APIs reais**

## Performance

- **Duration:** 8 min
- **Started:** 2026-06-22T15:17:36Z
- **Completed:** 2026-06-22T15:25:49Z
- **Tasks:** 3 (+ 1 fix commit)
- **Files modified:** 10

## Accomplishments

- Walking skeleton ponta-a-ponta: `npm start` carrega config, autentica no ClickUp (lista "Agendamentos & Publicações") e no GHL (conta auton.app instagram), emite logs estruturados JSON em cada passo
- Config fail-fast com zod: variável faltando = process.exit(1) com mensagem clara antes de qualquer I/O; objeto exportado congelado sem nenhum valor hardcoded (CFG-01)
- Dois clients HTTP autenticados contra APIs reais, provados ao vivo no smoke test: ClickUp com bottleneck 100 req/min e p-retry em 429/5xx (CFG-02); GHL com Bearer + Version header (CFG-03)
- Logger pino com redaction de authorization/token — tokens nunca vazam em log; child loggers com action='boot' em cada passo (CFG-04)
- Smoke test 3/3 GREEN (node:test nativo) contra as APIs reais: boot(), getList, listAccounts

## Task Commits

1. **Task 1: Scaffold ESM + smoke test RED** - `2df367d` (test)
2. **Task 2: Config fail-fast + logger pino** - `0634d01` (feat)
3. **Task 3: Clients + entrypoint GREEN** - `ce64862` (feat)
4. **Fix: entrypoint Windows fileURLToPath** - `4028a98` (fix)

## Files Created/Modified

- `package.json` - ESM scaffold, deps, scripts start/smoke/test
- `package-lock.json` - lockfile determinístico
- `.nvmrc` - pino Node 24
- `src/config/index.js` - zod schema, fail-fast, config congelada, mapeamento CU_FIELD_*→CF_*
- `src/lib/logger.js` - pino raiz, redaction, pino-pretty dev, withContext()
- `src/lib/errors.js` - AppError, fromClickUp, fromGHL
- `src/clients/clickup.js` - auth pk_, bottleneck 100/60s, p-retry, getList/getListFields/getTask/updateTask/setCustomField
- `src/clients/ghl.js` - auth Bearer pit- + Version, p-retry, listAccounts/createPost (stub Phase 2)
- `src/index.js` - boot() exportado + entrypoint direto via fileURLToPath
- `test/smoke.test.js` - 3 testes node:test com dotenv/config, skip gracioso sem .env

## Decisions Made

- **CU_FIELD_* → CF_* mapping**: o .env.example existente usa `CU_FIELD_LEGENDA` etc.; o plano especifica aliases `CF_*`. Mapeamento feito no config para honrar ambos sem alterar o .env.example versionado.
- **fetch nativo Node 24**: confirmado que undici é built-in; zero dep adicional para HTTP.
- **fileURLToPath** para detecção de entrypoint: substitui comparação de string frágil no Windows.
- **GHL response parsing**: shape real é `{ results: { accounts: [...] } }`, não `{ accounts: [...] }` como assumido no plano (confirmado ao vivo).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] GHL listAccounts: shape de resposta diverge do assumido**
- **Found during:** Task 3 (execução do smoke test GREEN)
- **Issue:** O plano assumia `result.accounts`; a API real retorna `result.results.accounts`
- **Fix:** Adicionado parsing em cascata `result?.results?.accounts ?? result?.accounts ?? []` em `src/index.js` e `test/smoke.test.js`
- **Files modified:** `src/index.js`, `test/smoke.test.js`
- **Verification:** `npm test` 3/3 GREEN após fix
- **Committed in:** `ce64862` (Task 3 commit)

**2. [Rule 1 - Bug] Entrypoint detection falhava no Windows**
- **Found during:** Task 3 (verificação `npm start`)
- **Issue:** A comparação de string para detectar execução direta não funcionava no Windows (backslashes vs forward-slashes, drive letter `C:`)
- **Fix:** Substituído por `fileURLToPath(import.meta.url) === process.argv[1]`
- **Files modified:** `src/index.js`
- **Verification:** `npm start` emite logs corretos no Windows
- **Committed in:** `4028a98` (fix commit)

---

**Total deviations:** 2 auto-fixed (2x Rule 1 - Bug)
**Impact on plan:** Ambas as correções necessárias para corretude. Nenhum escopo adicional.

## Issues Encountered

- GHL API response shape difere da documentação assumida no RESEARCH — detectado e corrigido no smoke test GREEN

## User Setup Required

Os tokens já estão no `.env` (existente, gitignored). Antes de produção, rotacionar ambos (blocker rastreado no STATE.md):
- `CLICKUP_TOKEN` (pk_…) — exposto em chat
- `GHL_TOKEN` (pit-…) — exposto em chat

## Next Phase Readiness

A fundação está completa e provada ao vivo:
- `config` congelado com todas as chaves do contrato de interfaces
- `clickup.getList` autenticado (lista real retornada)
- `ghl.listAccounts` autenticado (conta auton.app instagram confirmada)
- `logger` estruturado com redaction funcionando

**Phase 2 pode começar:** adicionar `clickup.getTask/updateTask/setCustomField` (métodos já no client mas sem smoke) e `ghl.createPost` para implementar o agendamento ClickUp→GHL.

**Blocker de produção ativo:** rotacionar tokens antes de qualquer deploy.

---

## Self-Check: PASSED

- [x] `package.json` existe: FOUND
- [x] `src/config/index.js` existe: FOUND
- [x] `src/lib/logger.js` existe: FOUND
- [x] `src/lib/errors.js` existe: FOUND
- [x] `src/clients/clickup.js` existe: FOUND
- [x] `src/clients/ghl.js` existe: FOUND
- [x] `src/index.js` existe: FOUND
- [x] `test/smoke.test.js` existe: FOUND
- [x] Commits 01-01 existem: 2df367d, 0634d01, ce64862, 4028a98
- [x] `npm test` 3/3 PASSED (GREEN)
- [x] `npm start` emite logs estruturados com action (CFG-04)
- [x] `.env` não aparece em `git status`
- [x] Sem tokens hardcoded em src/

*Phase: 01-funda-o-config-clients-logging*
*Completed: 2026-06-22*
