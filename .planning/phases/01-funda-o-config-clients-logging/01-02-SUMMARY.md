---
phase: 01-funda-o-config-clients-logging
plan: 02
subsystem: infra
tags: [node, esm, testing, security, clickup-fields, readme]

# Dependency graph
requires:
  - "01-01: config/logger/clients/errors walking skeleton"
provides:
  - "test/config.test.js: 5 testes provam fail-fast do env (subprocesso isolado, Windows-safe)"
  - "test/errors.test.js: 10 testes provam normalizacao de AppError + ausencia de segredos em serialization"
  - "src/index.js extendido: boot() le custom fields e loga mapeamento Formato label->id (confirma RESEARCH A2)"
  - "README.md: setup minimo (prereqs, variaveis, como rodar smoke/tests, nota de rotacao de keys)"
  - "RESEARCH [ASSUMED] A2 confirmado ao vivo: shape type_config.options verificado com 4 opcoes do Formato"
affects: [02-agendamento, 03-webhook-sync, 04-operacao]

# Tech tracking
tech-stack:
  added:
    - "node:test (nativo Node 24) — framework de testes unitarios, sem dependencia adicional"
    - "node:child_process spawnSync — subprocesso isolado para testar fail-fast do config"
    - "pathToFileURL (node:url) — conversao de caminho Windows para file:// URL em import() ESM"
  patterns:
    - "Subprocesso isolado com env sintetico para testar fail-fast sem depender do .env real"
    - "Arquivo .mjs temporario para import ESM no Windows (evita ERR_UNSUPPORTED_ESM_URL_SCHEME)"
    - "Response-like fake objects para testar AppError sem chamadas de rede"
    - "boot() nao-bloqueante para descoberta de custom fields: warn e continua se campo nao encontrado"

key-files:
  created:
    - "test/config.test.js"
    - "test/errors.test.js"
    - "README.md"
  modified:
    - "src/index.js (boot() extendido com getListFields + mapeamento Formato)"

key-decisions:
  - "Subprocesso com arquivo .mjs temporario (pathToFileURL) em vez de --input-type=module: necessario no Windows por ERR_UNSUPPORTED_ESM_URL_SCHEME com caminhos drive-letter (C:)"
  - "boot() getListFields nao-bloqueante: objetivo e descoberta/confirmacao de shape, nao prerequisito do boot — warn e continua se campo ausente"
  - "RESEARCH [ASSUMED] A2 confirmado ao vivo: Formato e drop_down com type_config.options contendo 4 opcoes (Reels/Carrossel/Stories/Feed estatico) — mapeamento label->id disponivel para Phase 2"

requirements-completed: [CFG-01, CFG-02, CFG-04]

# Metrics
duration: 4min
completed: 2026-06-22
---

# Phase 1 Plan 02: Hardening — Testes de Seguranca/Resiliencia + ClickUp Custom Fields + README Summary

**Testes provam fail-fast do config (CFG-01) e normalizacao segura de AppError (CFG-04); smoke estendido confirma ao vivo o shape de custom fields do ClickUp (RESEARCH [ASSUMED] A2 → VERIFIED); README de setup criado**

## Performance

- **Duration:** 4 min
- **Started:** 2026-06-22T15:30:35Z
- **Completed:** 2026-06-22T15:34:52Z
- **Tasks:** 3 (2 auto + 1 checkpoint auto-approved)
- **Files modified:** 4

## Accomplishments

- `test/config.test.js` (5 testes): subprocesso isolado prova que env incompleto → exit !=0 com mensagem de erro; env completo → exit 0; Windows-safe via arquivo .mjs temporario com file:// URL (CFG-01)
- `test/errors.test.js` (10 testes): Response-like fakes provam fromClickUp/fromGHL sem rede; confirma que serialization nunca contem "authorization" nem tokens (T-01-09/T-01-05; CFG-04)
- `src/index.js` extendido: boot() chama getListFields apos auth, localiza campo "Formato" (drop_down), loga mapeamento label->id das 4 opcoes — confirma RESEARCH [ASSUMED] A2 ao vivo
- RESEARCH A2 confirmado ao vivo: `type_config.options` com Reels/Carrossel/Stories/Feed estatico e UUIDs de opcao — Phase 2 pode usar diretamente
- `README.md` (100 linhas): prereqs (Node 24), tabela de todas as variaveis de env, como rodar smoke/tests, nota de seguranca sobre rotacao das keys vazadas
- 18/18 testes GREEN (5 config + 10 errors + 3 smoke)
- Checkpoint Task 3 (human-verify): auto-aprovado em modo automatico; verificacoes confirmadas: .env nao esta no git, nenhum token/Authorization nos logs do boot

## Task Commits

1. **Task 1: Testes fail-fast config + normalizacao AppError** - `1837299` (test)
2. **Task 2: boot() getListFields + README** - `0a1f222` (feat)

## Files Created/Modified

- `test/config.test.js` - 5 testes de fail-fast (subprocesso isolado, Windows-safe, sem .env real)
- `test/errors.test.js` - 10 testes de AppError normalization + security (Response-like fakes)
- `src/index.js` - boot() extendido com getListFields + mapeamento Formato label->id
- `README.md` - Setup minimo: prereqs, variaveis, como rodar, nota de rotacao de keys

## Decisions Made

- **Subprocesso Windows-safe**: `--input-type=module` com caminho Windows `C:\...` lanca `ERR_UNSUPPORTED_ESM_URL_SCHEME`. Solucao: arquivo .mjs temporario criado com `pathToFileURL()` para gerar file:// URL correto. Alternativa (passar string com `data:` URL) tambem funciona mas menos legivel.
- **boot() nao-bloqueante para getListFields**: o objetivo da chamada e confirmar o shape de custom fields (pesquisa/descoberta), nao prerequisites de operacao. Wrap em try/catch com log.warn permite que o boot continue mesmo se a lista de fields nao retornar — reduz risco de regressao no entrypoint.
- **RESEARCH [ASSUMED] A2 → VERIFIED**: confirmado ao vivo que GET /list/{id}/field retorna `type_config.options` com `id` e `label` para dropdowns. Phase 2 pode usar `option.id` diretamente para `setCustomField`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Windows ESM path incompatibility in config test**
- **Found during:** Task 1 (first test run)
- **Issue:** `--input-type=module` com `import 'C:/path/...'` lanca `ERR_UNSUPPORTED_ESM_URL_SCHEME` no Node 24 no Windows — caminhos com drive letter (C:) nao sao URL ESM validas
- **Fix:** Substituido abordagem inline por arquivo .mjs temporario criado com `writeFileSync`, usando `pathToFileURL()` para converter o caminho Windows em `file:///C:/...` URL valida
- **Files modified:** `test/config.test.js`
- **Verification:** 5/5 testes passam apos fix
- **Committed in:** `1837299` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 - Bug)
**Impact:** Fix necessario para corretude no ambiente Windows; nenhum escopo adicional.

## RESEARCH [ASSUMED] A2 — Verificado ao Vivo

Assumpcao A2 do RESEARCH (Pitfall 2 — formato de custom field ClickUp) confirmada:

| Campo | Tipo | Options |
|-------|------|---------|
| Formato | drop_down | Reels, Carrossel, Stories, Feed estatico |

Mapeamento label->id confirmado:
- Reels: `27b272ae-357c-40b3-9f14-ae37c1e59f8f`
- Carrossel: `45600c93-f66e-4e77-84ee-bd9821b0c082`
- Stories: `b1165f06-ca49-4907-8585-632e638c195d`
- Feed estatico: `744b231e-d080-4515-80b1-1b679510bfdd`

Phase 2 deve usar `option.id` (nao o label) ao escrever o campo Formato via `setCustomField`.

## Authentication Gates

None — todos os tokens ja estavam configurados no .env.

## Issues Encountered

None. Todos os testes passaram apos o fix de compatibilidade Windows (Task 1).

## Threat Surface Scan

Nenhuma nova superficie de ataque introduzida neste plano:
- `test/config.test.js`: apenas leitura de comportamento de saida — sem I/O de rede
- `test/errors.test.js`: objetos fake locais — sem rede
- `src/index.js` (extensao): chamada de leitura (GET) ja dentro do client existente — sem nova superficie
- `README.md`: documentacao estatica — sem codigo executavel

## Known Stubs

None — todos os componentes produzem saida real:
- boot() loga o mapeamento real de Formato (live API call)
- Testes provam comportamentos reais com subprocessos/fakes

## Next Phase Readiness

Phase 2 (agendamento ClickUp→GHL) pode comecar com:
- Config validada e testada (CFG-01)
- Clients ClickUp e GHL autenticados ao vivo (CFG-02/03)
- Logger com redaction (CFG-04)
- Mapeamento label->id do campo Formato confirmado (A2 VERIFIED)
- AppError normalization testada para ambas as APIs

**Blocker de producao ativo:** rotacionar tokens CLICKUP_TOKEN e GHL_TOKEN antes de qualquer deploy (rastreado no STATE.md).

---

## Self-Check: PASSED

- [x] `test/config.test.js` existe: FOUND
- [x] `test/errors.test.js` existe: FOUND
- [x] `README.md` existe: FOUND
- [x] `src/index.js` modificado com getListFields: FOUND
- [x] Commits 01-02 existem: 1837299 (Task 1), 0a1f222 (Task 2)
- [x] `node --test test/config.test.js test/errors.test.js`: 15/15 PASSED
- [x] `node --test` (all tests): 18/18 PASSED
- [x] `npm start` roda ponta-a-ponta com mapeamento Formato nos logs
- [x] Nenhum token/Authorization nos logs do `npm start`
- [x] `.env` nao aparece em `git status`
- [x] `.env` nao commitado em nenhum momento no historico
- [x] README.md >= 20 linhas: 100 linhas FOUND
- [x] README.md contem CLICKUP_TOKEN, GHL_TOKEN, rotacao de keys

*Phase: 01-funda-o-config-clients-logging*
*Completed: 2026-06-22*
