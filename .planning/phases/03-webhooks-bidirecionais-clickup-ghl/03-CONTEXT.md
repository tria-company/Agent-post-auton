# Phase 3: Webhooks Bidirecionais (ClickUp ⇄ GHL) - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Construir UM servidor HTTP público (hospedado no VPS próprio da Auton) que atende DOIS webhooks no mesmo serviço:

1. **ClickUp → GHL (gatilho, TRIG-01..05):** quando o humano move uma task da lista de agendamentos (`901327135553`, team Auton `90132819023`) para o status `agendado`, o ClickUp dispara um webhook → o servidor valida a assinatura, filtra o evento e chama `processTask` (reusa 100% do pipeline da Phase 2) para agendar no GHL em tempo real — sem `npm start` manual.

2. **GHL → ClickUp (sync, SYNC-01..06):** quando o GHL publica ou falha um post, o webhook do GHL → o servidor mapeia o evento de volta para a task (via GHL Post ID salvo) e atualiza status/campos.

O batch `npm start` (runSchedulerBatch) permanece como **fallback manual** de varredura/reprocessamento (TRIG-05). Endurecimento operacional completo (autostart, monitoring, runbook) é Phase 4.

**Em escopo:** servidor HTTP nativo, 2 rotas de webhook, validação HMAC, handler ClickUp→processTask, handler GHL→write-back de status, idempotência, script de registro de webhooks, ingress via **smee.io** (smee-client no VPS encaminhando pro servidor local), deploy básico funcional no VPS.
**Fora de escopo (Phase 4):** PM2/systemd autostart, monitoring/alertas, runbook completo de deploy, resiliência avançada (retries/backoff no nível de processo), loop contínuo configurável.
</domain>

<decisions>
## Implementation Decisions

### Arquitetura do servidor
- **L-01:** Gatilho por **webhook** (tempo real), não polling. (Decisão do usuário — ver memória `webhook-trigger-decision`.)
- **L-02:** Hospedagem em **VPS próprio** da Auton (usuário cuida de domínio/TLS de borda; nós preparamos servidor + docs de deploy).
- **D-05:** Framework = **node:http nativo (zero deps)** — alinha com o projeto standalone/sem-framework (já usa fetch nativo, zod, Bottleneck, p-retry). Vantagem decisiva: controle total do **raw body**, necessário para verificar assinatura HMAC byte-a-byte. NÃO usar Express/Fastify.
- **D-06:** Um único processo/servidor, **duas rotas**: `/webhook/clickup` e `/webhook/ghl`. (+ um health check simples, ex.: `GET /health`.)

### Segurança
- **L-05:** Validação de **assinatura HMAC** obrigatória em AMBOS os webhooks, ANTES de processar qualquer payload. Requests sem assinatura válida → 401, sem efeito colateral. Segredos de assinatura vivem no `.env` (fail-fast via zod, padrão CFG-01), nunca hardcoded, nunca logados.

### Gatilho ClickUp → GHL
- **L-04:** O handler do ClickUp **reusa `processTask`** do `src/scheduler/pipeline.js` (não reimplementa nada do agendamento).
- **D-07:** Handler filtra o evento de mudança de status (ClickUp `taskStatusUpdated`); só age quando o status novo == `agendado` (config.STATUS_AGENDADO). Eventos de outros status são ignorados (200 OK, no-op).
- **TRIG-04:** Idempotência reusa a guarda existente do **GHL Post ID** (task já com post id → `processTask` pula). Reentrega do webhook não reagenda.

### Sync GHL → ClickUp (sucesso e falha)
- **D-02 (sucesso):** GHL publica no IG → task vai para `publicado` + preenche `IG Media ID` + `Link publicado` (SYNC-04).
- **D-01 (falha):** quando o GHL/IG FALHA ao publicar um post já agendado → a task **volta para `a agendar`** + preenche `Erro de publicação` + **limpa o `GHL Post ID`** (para permitir re-tentativa: o humano corrige e move de novo para `agendado`). Consistente com o state machine invertido da Phase 2 (`a agendar` = precisa ajuste). Adicionar comentário de erro na task, no mesmo padrão `❌` já usado no pipeline.
- **SYNC-03:** mapeia o evento do GHL de volta para a task via o GHL Post ID salvo na task.
- **SYNC-06:** idempotência GHL→ClickUp — dedup de reentrega do mesmo evento (estratégia a definir na pesquisa; ver RQ4).

### Setup / operação
- **D-04:** Registro dos webhooks via **script automatizado idempotente** (ex.: `npm run setup:webhooks`) que chama as APIs (ClickUp `POST /team/{team_id}/webhook`, GHL) para criar/atualizar os endpoints. Reexecutável sem duplicar. Os segredos retornados (signature secrets) vão pro `.env`.
- **D-03:** Deploy **básico incluído na Phase 3** — o serviço fica rodando no VPS e recebendo webhooks de verdade ao fim da fase. Endurecimento (autostart, monitoring, runbook completo) é Phase 4.
- **D-08 (ingress via smee.io):** O ingress dos webhooks usa **smee.io** (relay/proxy de webhooks). A URL pública registrada no ClickUp/GHL é um canal `https://smee.io/<id>`; no VPS roda um **smee-client** que conecta para FORA até o smee.io e encaminha os POSTs para o servidor `node:http` local (`http://localhost:PORT`). Vantagem: **dispensa** configurar HTTPS/domínio/TLS/porta pública inbound no VPS — o smee-client é só saída. Verificar na pesquisa que o smee-client **preserva os headers** (a assinatura HMAC precisa sobreviver ao relay — ver RQ5). Nova dependência provável: `smee-client`.
  - ⚠️ **Caveat de produção:** o smee.io é oficialmente "dev/best-effort" (canal público, sem SLA). Decisão atual = usar smee.io pela simplicidade; a Phase 4 pode reavaliar um reverse proxy próprio (nginx/caddy) se precisar de robustez/SLA. A assinatura HMAC mitiga o canal ser público (payloads forjados são rejeitados).
- **TRIG-05:** `npm start` (runSchedulerBatch) permanece funcional como fallback manual.

### Claude's Discretion
- Estrutura de arquivos do servidor (ex.: `src/server/index.js`, `src/server/routes/`, `src/server/verifySignature.js`), nomes de rotas internas, formato do health check.
- Como expor TLS no VPS (reverse proxy nginx/caddy na frente vs TLS direto no node) — recomendar na pesquisa; provável reverse proxy.
- Store de dedup de eventos (memória vs arquivo) conforme RQ4.
- Porta do servidor via config (`.env`), com default sensato.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Escopo e requisitos
- `.planning/ROADMAP.md` (seção "Phase 3: Webhooks Bidirecionais") — goal, success criteria, requisitos SYNC-01..06 + TRIG-01..05
- `.planning/REQUIREMENTS.md` — definições de SYNC-* e TRIG-* (grupos "Sincronização GHL → ClickUp" e "Gatilho ClickUp → GHL por Webhook")
- `CLAUDE.md` — constraints do projeto (Node standalone, sem framework de UI; tokens só via `.env`; webhook exige endpoint público HTTPS; gatilho atual = humano move para `agendado`)

### Código a reusar (Phase 2 — já implementado e validado ao vivo)
- `src/scheduler/pipeline.js` — `processTask(task, formatoOptionsMap)` e `runSchedulerBatch()`; o handler ClickUp deve chamar `processTask` para a task única do evento. State machine: sucesso mantém `agendado`+GHL Post ID+comentário; falha volta para `a agendar`+Erro de publicação+comentário.
- `src/clients/clickup.js` — `getTask`, `updateTask`, `setCustomField`, `addComment`, `getListFields` (o handler GHL→ClickUp usa esses para o write-back de `publicado`/erro)
- `src/clients/ghl.js` — `uploadMedia`, `createPost`, `listAccounts`
- `src/config/index.js` — padrão zod fail-fast + aliases CF_*; estender com segredos de webhook + porta
- `src/lib/logger.js` (`withContext`) — logging estruturado, nunca logar segredos/assinaturas
- `src/lib/errors.js` (`AppError`) — normalização de erro

### Decisões de produto (memória do projeto)
- Decisão de webhook + VPS + batch fallback: memória `webhook-trigger-decision`
- State machine do gatilho (invertido na Phase 2): memória `scheduler-trigger-state-machine`
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `processTask` (pipeline.js): núcleo do agendamento — o webhook ClickUp é só uma nova forma de DISPARAR o mesmo processamento, para 1 task. Reuso total.
- ClickUp client write-back helpers (`updateTask`/`setCustomField`/`addComment`): o handler GHL→ClickUp reusa para mover status e preencher campos.
- Config zod fail-fast (CFG-01): estender com `WEBHOOK_PORT`, `CLICKUP_WEBHOOK_SECRET`, `GHL_WEBHOOK_SECRET` (nomes a confirmar) seguindo o padrão exato dos 6+ campos existentes.
- Logger `withContext({ module: 'webhook' })`: padrão de logging já estabelecido; T-01-02 (nunca logar auth/segredos) se aplica às assinaturas.

### Established Patterns
- Sem framework: fetch nativo, Bottleneck (rate limit), p-retry (backoff), zod (validação), adm-zip. node:http nativo mantém a linha.
- Idempotência por GHL Post ID já existe no pipeline — base da idempotência do gatilho.
- Custom field UUIDs reais da lista Auton validados na Phase 2 (Erro de publicação `1137de68-...`, IG Media ID `cde1cd79-...`, Link publicado `e98e36fe-...`, GHL Post ID `5e02e9dc-...`).

### Integration Points
- `/webhook/clickup` → verifica assinatura → parse → filtra `agendado` → `processTask`.
- `/webhook/ghl` → verifica assinatura → parse → mapeia post id → write-back (`publicado`+campos OU `a agendar`+erro).
- `package.json`: novo script `setup:webhooks` e provável novo entrypoint do servidor (`src/server/index.js` via `npm run serve` ou similar), preservando `npm start` (batch).
</code_context>

<specifics>
## Specific Ideas

- Servidor único, node:http nativo, raw body capturado para HMAC.
- Script `setup:webhooks` idempotente (cria ou atualiza, não duplica).
- Falha de publicação devolve a task para `a agendar` e limpa o GHL Post ID (re-tentável).
- Team ClickUp do registro de webhook: Auton `90132819023`; lista `901327135553`.
</specifics>

<deferred>
## Deferred Ideas

- **Phase 4 (Operação & Robustez):** PM2/systemd autostart, monitoring/alertas, runbook completo de deploy, resiliência de processo (restart, retries/backoff de longo prazo), loop contínuo configurável. (D-03 deixa só o deploy MÍNIMO funcional na Phase 3.)
- **Verificação ao vivo da capa de Reels** (`type:'reel'` + campo do thumbnail no GHL) — pendente da Phase 2, independente; não bloqueia a Phase 3.

## Open Research Questions (para o gsd-phase-researcher)

- **RQ1 (GHL webhooks):** O GHL Social Planner envia webhooks para eventos de post (publicado/falha)? Como registrar (workflow/automation webhook vs evento nativo)? Qual o shape do payload e como extrair o post id para mapear de volta à task? Como o GHL assina o webhook (header/segredo)?
- **RQ2 (ClickUp webhooks):** Esquema de assinatura (header `X-Signature`, HMAC-SHA256 com o secret retornado na criação?). Eventos disponíveis (confirmar `taskStatusUpdated`), shape do payload (traz o status novo? ou precisa `getTask`?). Endpoint de registro `POST /team/{team_id}/webhook` — parâmetros, escopo por lista, e como tornar idempotente.
- **RQ3 (filtro de status):** `taskStatusUpdated` dispara em qualquer mudança — confirmar como filtrar para `agendado` a partir do payload.
- **RQ4 (idempotência/dedup):** Estratégia de dedup de reentrega para o lado GHL→ClickUp (event id store em memória vs arquivo, dado VPS single-instance; impacto de restart).
- **RQ5 (smee.io ingress):** Confirmar que o **smee-client** encaminha os **headers** (a assinatura HMAC do ClickUp/GHL precisa chegar intacta ao servidor local). Setup do smee-client no VPS (rodar como processo junto do servidor; reconexão automática). Criar canal smee.io (URL fixa? como gerar/persistir o id). Limitações conhecidas (best-effort, tamanho de payload). Fallback se o canal cair. Como isto convive com `npm run setup:webhooks` (a URL registrada no ClickUp/GHL passa a ser o canal smee.io).
</deferred>

---

*Phase: 3-Webhooks Bidirecionais (ClickUp ⇄ GHL)*
*Context gathered: 2026-06-22*
