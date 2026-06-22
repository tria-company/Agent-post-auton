# Walking Skeleton — Agent Posts Auton (ClickUp ↔ GHL Instagram Scheduler)

**Phase:** 1
**Generated:** 2026-06-22

## Capability Proven End-to-End

> Uma frase: a menor capacidade visível que exercita toda a stack.

Rodar `npm start` (ou `npm run smoke`) sobe o processo, carrega e valida 100% da config do `.env` (falha cedo se faltar algo), autentica no ClickUp e lê a lista real "Agendamentos & Publicações", autentica no GHL e lista as contas do Social Planner (encontrando `auton.app`), e registra cada passo em log estruturado — provando ponta-a-ponta que a fundação (config + 2 clients autenticados + logging) funciona contra as APIs reais.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Runtime | Node.js 24.x LTS | Já instalado (`v24.14.0`); ativo LTS em jun/2026; traz `fetch` global e `--env-file` nativos. (RESEARCH Standard Stack) |
| Module system | ESM (`"type":"module"`) | Padrão atual; `import` consistente, extensões `.js` explícitas. (RESEARCH Pitfall 4) |
| HTTP client | `fetch` global nativo (undici embutido) | Zero dependência; suficiente para 2 clients simples. NÃO instalar node-fetch/axios/undici. (RESEARCH State of the Art) |
| Config / validação de env | `dotenv` + `zod` (fail-fast) | Centraliza toda config em um módulo; crash imediato com mensagem clara se faltar variável. (RESEARCH Pattern 1, CFG-01) |
| Logging | `pino` (+ `pino-pretty` em dev) | JSON estruturado, child loggers com `{taskId, ghlPostId, action}`, redaction de segredos. (RESEARCH Pattern 3, CFG-04) |
| Rate limiting | `bottleneck` (reservoir 100/60s) no client ClickUp | Limite é por token → pertence ao client que detém o token. (RESEARCH Pattern 2, CFG-02) |
| Retry / backoff | `p-retry` (429 + 5xx + rede) em ambos os clients | Backoff exponencial, honra `Retry-After`; não retenta 4xx não-429. (RESEARCH Anti-Patterns) |
| Gestão de segredos | Tudo em `.env` gitignored; só `.env.example` versionado | Nenhum segredo no código; tokens nunca logados (redaction). (PROJECT Constraints, CFG-01) |
| Directory layout | `src/config`, `src/clients`, `src/lib`, `src/index.js` | Separa bootstrap (roda 1x) de clients (cross-cutting, reusados nas Phases 2-4). (RESEARCH Architectural Responsibility Map) |

## Stack Touched in Phase 1

- [x] Project scaffold — `package.json` ESM, deps instaladas, scripts `start`/`smoke`, lockfile commitado
- [x] Config layer — carrega `.env`, valida com zod, exporta `config` congelado (fail-fast)
- [x] HTTP client real (leitura) — ClickUp `GET /list/{id}` autenticado contra a API real
- [x] HTTP client real (leitura) — GHL `GET /social-media-posting/{loc}/accounts` autenticado contra a API real
- [x] Logging estruturado — pino root + child loggers com campos de domínio + redaction de `authorization`
- [x] Comando full-stack executável — `npm start` exercita config → ambos os clients → logs ponta-a-ponta

## Out of Scope (Deferred to Later Slices)

> Explicitamente fora do esqueleto. Esta lista evita que fases futuras re-litiguem o minimalismo da Phase 1.

- Detecção de tasks `a agendar` / lógica de agendamento → Phase 2 (SCH-01..07)
- Criação de post no GHL (`POST /social-media-posting/{loc}/posts`) e resolução de mídia/legenda → Phase 2
- Escrita de custom fields no ClickUp (`PUT /task`, `POST /task/{id}/field/{fid}`) → Phase 2 (apenas leitura de fields no smoke test desta fase)
- Endpoint HTTP / servidor webbook GHL→ClickUp → Phase 3 (SYNC-01..06)
- Loop contínuo / scheduler em intervalo configurável → Phase 4 (OPS-01)
- README completo de deploy do webhook → Phase 4 (OPS-03; um README mínimo de setup nasce nesta fase)
- Rotação das keys vazadas → pré-produção (blocker rastreado no STATE.md)

## Subsequent Slice Plan

Cada fase posterior adiciona uma fatia vertical sobre este esqueleto, sem alterar as decisões arquiteturais acima:

- **Phase 2 — Agendamento ClickUp → GHL:** usa `clickup` (getList/getTask/setCustomField/updateTask) e adiciona `ghl.createPost`; detecta `a agendar`, resolve legenda+mídia, agenda no GHL, devolve `agendado` + post id.
- **Phase 3 — Sincronização GHL → ClickUp (Webhook):** adiciona servidor HTTP que recebe webhook do GHL, valida autenticidade, mapeia post→task e atualiza status no ClickUp (idempotente).
- **Phase 4 — Operação & Robustez:** loop contínuo configurável, resiliência de rede em escala de fila, README completo de deploy.
