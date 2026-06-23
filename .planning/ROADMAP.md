# Roadmap: Agent Posts Auton — ClickUp ↔ GHL Instagram Scheduler

## Overview

O projeto entrega a "cola" entre o ClickUp (painel de produção de conteúdo) e o GHL Social Planner (publicador do Instagram `auton.app`). Começa estabelecendo a fundação — configuração via `.env`, clients autenticados de ClickUp e GHL, e logging — sobre a qual tudo se apoia. Em seguida entrega o fluxo de valor principal de ponta a ponta: detectar tasks `a agendar` no ClickUp, resolver legenda+mídia, agendar no GHL e devolver o status `agendado` com o id do post salvo. Depois fecha o laço inverso com o webhook GHL→ClickUp, que reflete publicação/erro de volta na task em tempo real. Por fim, torna o serviço operável e robusto: loop contínuo, retries com backoff e documentação de deploy. Cada fase entrega uma capacidade observável e verificável por uma pessoa usando o ClickUp e o GHL.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Fundação (Config + Clients + Logging)** - `.env`, clients autenticados de ClickUp e GHL e logging estruturado prontos para uso (completed 2026-06-22)
- [x] **Phase 2: Agendamento ClickUp → GHL** - Task `a agendar` vira post agendado no GHL e volta como `agendado` no ClickUp (completed 2026-06-22)
- [ ] **Phase 3: Webhooks Bidirecionais (ClickUp ⇄ GHL)** - Um servidor público (VPS) atende dois webhooks: ClickUp→GHL dispara o agendamento ao mover para `agendado`; GHL→ClickUp reflete publicação/erro na task. Batch `npm start` mantido como fallback
- [ ] **Phase 4: Operação & Robustez** - Serviço roda continuamente, sobrevive a falhas de rede e é deployável via README

## Phase Details

### Phase 1: Fundação (Config + Clients + Logging)

**Goal**: Estabelecer a base do serviço: toda configuração vem do `.env`, os clients de ClickUp e GHL autenticam e respondem, e cada ação gera log estruturado.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04
**Success Criteria** (what must be TRUE):

  1. O serviço sobe lendo tokens, locationId, list id e ids de campos/status exclusivamente do `.env` — não há nenhum segredo hardcoded no código
  2. Uma chamada de teste ao ClickUp com o token configurado retorna dados da lista "Agendamentos & Publicações" e respeita o rate limit (100 req/min)
  3. Uma chamada de teste ao GHL (`GET /social-media-posting/{locationId}/accounts`) com `Authorization: Bearer` + header `Version` retorna 200 e lista a conta Instagram `auton.app`
  4. Cada ação executada produz um log estruturado contendo id da task e (quando aplicável) id do post GHL

**Plans**: 2 plans

  - [x] 01-01-PLAN.md — Walking Skeleton: scaffold ESM + config fail-fast + clients ClickUp/GHL autenticados + logging + smoke test ponta-a-ponta (CFG-01..04)
  - [x] 01-02-PLAN.md — Hardening: testes de fail-fast/redaction/erro normalizado, smoke estendido (formato de custom field), README de setup + checkpoint de higiene de segredos (CFG-01, CFG-02, CFG-04)

### Phase 2: Agendamento ClickUp → GHL

**Goal**: Entregar o fluxo de valor principal de ponta a ponta — uma task marcada `a agendar` com `Data de publicação` preenchida vira um post agendado no GHL Social Planner para o Instagram, e a task retorna como `agendado` com o id do post salvo.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: SCH-01, SCH-02, SCH-03, SCH-04, SCH-05, SCH-06, SCH-07
**Success Criteria** (what must be TRUE):

  1. O serviço detecta tasks da lista com status `a agendar` e `Data de publicação` preenchida e ignora as demais
  2. Para cada task elegível, a legenda é resolvida do campo `Legenda` (com fallback para a task mãe via `id da task mãe`) e a mídia é disponibilizada ao GHL (URL pública ou upload na media library)
  3. Um post agendado aparece no GHL Social Planner para a conta `auton.app` no horário de `Data de publicação`, respeitando o `Formato` (Reels/Carrossel/Stories/Feed)
  4. Ao agendar com sucesso, a task passa para `agendado` e o id do post GHL fica persistido nela; uma task que já tem id de post salvo nunca é reagendada
  5. Em caso de falha ao agendar, a task permanece em `a agendar` e o campo `Erro de publicação` é preenchido com a causa, permitindo retry
**Plans**: 3 plans
**Wave 1**

  - [x] 02-01-PLAN.md — Wave 0 (setup): custom fields no ClickUp + config das 6 vars (CFG-01) + adm-zip + smoke empírico upload/createPost (SCH-01,03,04,05,06,07) — COMPLETE (2026-06-22): A1/A2/A4/A7 confirmed; 3 critical findings documented (userId required, results.post._id, token scopes)
  - [x] 02-02-PLAN.md — Wave 1 (slice principal): detecção+idempotência+resolução com fallback+download/unzip seguro+upload GHL+createPost mídia única+write-back de sucesso (SCH-01..06) — COMPLETE (2026-06-22): pipeline ponta-a-ponta; 56/56 tests GREEN; GHL_USER_ID added to config

**Wave 2** *(blocked on Wave 1 completion)*

  - [x] 02-03-PLAN.md — Wave 2 (refinamento): carrossel multi-mídia ordenado + validação completa (Formato/Stories/data/conteúdo) + write-back de Erro de publicação + isolamento de falha (SCH-04, SCH-07) — COMPLETE (2026-06-22): 67/67 tests GREEN; carousel type='post'+media[N] in order; Stories/empty rejected; write-back CF_ERRO_PUBLICACAO safe+truncated; D-18 isolation proven

### Phase 3: Webhooks Bidirecionais (ClickUp ⇄ GHL)

**Goal**: Construir UM servidor HTTP público (hospedado no VPS próprio) que atende dois webhooks: (a) ClickUp→GHL — quando o humano move uma task para `agendado`, o agendamento dispara em tempo real (sem `npm start` manual); (b) GHL→ClickUp — quando o GHL publica ou falha um post, a task reflete `publicado`/erro automaticamente. O batch `npm start` permanece como fallback manual.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, TRIG-01, TRIG-02, TRIG-03, TRIG-04, TRIG-05
**Success Criteria** (what must be TRUE):

  1. Um endpoint HTTP público (atrás do Caddy/TLS no VPS) recebe o webhook do ClickUp e só processa eventos cuja assinatura HMAC (`X-Signature`) foi validada. (O GHL NÃO emite webhook de post — confirmado na pesquisa; o lado GHL é polling, não webhook.)
  2. (Gatilho) Quando uma task da lista de agendamentos muda para `agendado`, o webhook do ClickUp dispara `processTask` em tempo real, reusando o pipeline da Phase 2 (upload+createPost+write-back)
  3. (Sync via polling) Um loop periódico consulta o GHL pelos posts agendados via id salvo; ao publicar, a task vai para `publicado` com `IG Media ID` e `Link publicado`; ao falhar, volta para `a agendar` com `Erro de publicação`
  4. Reentrega/duplicação de qualquer webhook não reagenda nem corrompe a task (idempotência — reusa a guarda do GHL Post ID e dedup de evento)
  5. O batch `npm start` continua funcionando como fallback manual de varredura/reprocessamento

**Plans**: 4 plans (3 waves)

**Wave 1**

  - [x] 03-01-PLAN.md — Wave 0 (fundação + smoke empírico): config Phase 3 + ghl.getPost + smoke OQ1 (shape do GET /posts/:id) + OQ4 (status publicado) + scaffolds de teste RED (SYNC-01) — COMPLETE (2026-06-22): OQ1 resolved (results.post.status + publishedAt confirmed); OQ4 resolved ('publicado' default correct); 81/84 tests passing (3 RED scaffolds expected)

**Wave 2** *(paralelo — sem overlap de arquivos; depende do Plano 01)*

  - [x] 03-02-PLAN.md — Slice ClickUp→GHL (TDD): servidor node:http + HMAC verify + DedupeStore + handler taskStatusUpdated→processTask + /health; npm start mantido (TRIG-01..05) — COMPLETE (2026-06-22): 3 RED→GREEN; 92/92 tests passing; HMAC timingSafeEqual; 200-then-setImmediate; serve script added
  - [x] 03-03-PLAN.md — Slice GHL→ClickUp polling (TDD): ghlStatusPoller write-back publicado/falha + dedup + isolamento por task (SYNC-01..06) — COMPLETE (2026-06-22): 8 RED→GREEN; 100/100 tests passing; pollGhlPosts() exports ready for Plan 03-04 setInterval wiring

**Wave 3** *(depende dos Planos 02 e 03)*

  - [ ] 03-04-PLAN.md — Operacionalização: poller embutido no servidor (setInterval) + setup:webhooks idempotente + Caddyfile + deploy README + smoke ao vivo (TRIG-01, SYNC-01)

### Phase 4: Operação & Robustez

**Goal**: Tornar o serviço confiável e deployável para uso real — loop contínuo configurável, resiliência a falhas de rede/API e documentação completa de setup e deploy do webhook.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: OPS-01, OPS-02, OPS-03
**Success Criteria** (what must be TRUE):

  1. O agendador roda continuamente em intervalo configurável (via `.env`), processando novas tasks elegíveis sem intervenção manual
  2. Erros transitórios de rede/API são re-tentados com backoff e uma falha isolada não trava o processamento das demais tasks da fila
  3. O README permite a uma pessoa configurar o `.env`, subir o serviço e expor o endpoint do webhook do GHL seguindo apenas as instruções escritas

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Fundação (Config + Clients + Logging) | 2/2 | Complete   | 2026-06-22 |
| 2. Agendamento ClickUp → GHL | 3/3 | Complete | 2026-06-22 |
| 3. Webhooks Bidirecionais (ClickUp ⇄ GHL) | 3/4 | Executing | - |
| 4. Operação & Robustez | 0/TBD | Not started | - |
