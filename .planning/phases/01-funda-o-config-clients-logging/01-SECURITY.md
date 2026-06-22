---
phase: 01
slug: funda-o-config-clients-logging
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-22
---

# Phase 01 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time (both 01-01-PLAN.md and 01-02-PLAN.md carry `<threat_model>` blocks).
> Closures recorded from this session's evidence (verifier + UAT + code review + orchestrator scans). User elected "accept all without audit" — gsd-security-auditor not spawned.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| processo → `.env` | Segredos entram via `process.env`; nunca vão para código, git ou logs | tokens `pk_…`/`pit-…`, locationId, ids de campos/status (alta sensibilidade) |
| processo → API ClickUp / GHL | Saída autenticada via HTTPS; body de resposta/erro é dado externo não confiável | header `Authorization`/`Version` (saída); status+code+body (entrada) |
| repositório git → segredos | `.env` jamais entra no histórico; só `.env.example` (placeholders) é versionado | credenciais |
| logs → operador/ingest | Linhas de log lidas por humanos/ingest; sem tokens nem headers de auth | mensagens estruturadas (status, code, ids) |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-01-01 | Information Disclosure | Token hardcoded no código/commit | mitigate | Config 100% via `process.env` (`src/config/index.js`); `Object.freeze`; grep por `pk_`/`pit-` em `src/` retorna zero (verifier) | closed |
| T-01-02 | Information Disclosure | Token/header vazado em log | mitigate | pino `redact` em `authorization`/`token` (`src/lib/logger.js`); scan do `npm start` contra valores reais do `.env` → NO_LEAK (UAT Teste 1) | closed |
| T-01-03 | Denial of Service | Variável de config faltando em runtime | mitigate | Fail-fast com zod + `process.exit(1)` antes de qualquer I/O; 5 testes em `test/config.test.js` | closed |
| T-01-04 | Denial of Service | Estouro do rate limit (429) do ClickUp | mitigate | Bottleneck reservoir 100/60s + p-retry honrando Retry-After (`src/clients/clickup.js`); bug WR-03 (epoch vs delta) corrigido (commit 918aba0); retry coberto por `test/clients.test.js` | closed |
| T-01-05 | Information Disclosure | Body de erro logado com PII/segredo | mitigate | `AppError.fromClickUp/fromGHL` extraem só status+code (`src/lib/errors.js`); 10 testes em `test/errors.test.js` confirmam não-vazamento | closed |
| T-01-SC | Tampering | Supply chain (zod/dotenv/pino/bottleneck/p-retry/pino-pretty) | mitigate | Package Legitimacy Audit no 01-RESEARCH (todos aprovados, sem SLOP); `undici` SUS é built-in e NÃO foi instalado; lockfile commitado | closed |
| T-01-06 | Information Disclosure | `.env` commitado no histórico git | mitigate | `.gitignore` cobre `.env`/`.env.*`; `git log --all -p -- .env` vazio (UAT Teste 2) | closed |
| T-01-07 | Information Disclosure | Token impresso no boot/smoke estendido | mitigate | Redaction do logger + scan do output do `npm start`: nenhuma string `pk_`/`pit-`/`Authorization` (UAT Teste 1) | closed |
| T-01-08 | Tampering / Information Disclosure | Config inválida aceita silenciosamente | mitigate | `test/config.test.js` prova fail-fast com env incompleto (subprocesso, exit != 0) | closed |
| T-01-09 | Information Disclosure | Erro de API logado com corpo/headers sensíveis | mitigate | `test/errors.test.js` prova que `AppError` serializa só status+code, nunca `authorization`/token | closed |
| T-01-10 | Repudiation | Rotação das keys vazadas (expostas em chat) esquecida | accept | Risco aceito explicitamente pelo usuário — ver Accepted Risks Log (R-01) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| R-01 | T-01-10 | Os tokens ClickUp (`pk_…`) e GHL (`pit-…`) foram expostos em chat durante o desenvolvimento e o usuário decidiu **não rotacioná-los** ("eu não vou rotacionar a chave"). Consequência: as credenciais expostas permanecem válidas em produção e qualquer pessoa com acesso ao chat pode usá-las. Sem mitigação técnica possível no código — é uma ação operacional. **Reavaliar antes de qualquer deploy de produção.** | usuário (ferramentas@autonhealth.com.br) | 2026-06-22 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-22 | 11 | 11 | 0 | orquestrador (accept-all, sem auditor — escolha do usuário) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-22 (com risco aceito R-01 pendente para pré-produção)
