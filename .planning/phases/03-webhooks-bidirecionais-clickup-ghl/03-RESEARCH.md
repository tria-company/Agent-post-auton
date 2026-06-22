# Phase 3: Webhooks Bidirecionais (ClickUp ⇄ GHL) - Research

**Researched:** 2026-06-22
**Domain:** Node.js HTTP server, ClickUp Webhooks API, GHL Social Planner API, smee.io relay, HMAC signature verification
**Confidence:** MEDIUM — ClickUp webhook behavior is HIGH (official docs confirmed); GHL Social Planner webhook gap is HIGH (confirmed absent); smee-client body/HMAC issue is HIGH (open issue confirmed); GHL polling shape is MEDIUM (docs render-gated).

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **L-01:** Gatilho por webhook (tempo real), não polling.
- **L-02:** Hospedagem em VPS próprio da Auton.
- **D-05:** Framework = node:http nativo (zero deps) — sem Express/Fastify.
- **D-06:** Servidor único, duas rotas: `/webhook/clickup` e `/webhook/ghl`. + `GET /health`.
- **L-05:** Validação HMAC obrigatória em AMBOS os webhooks antes de processar. 401 sem assinatura válida.
- **L-04:** Handler ClickUp reusa `processTask` — nenhum código de agendamento novo.
- **D-07:** Filtra só `taskStatusUpdated` onde `after.status === config.STATUS_AGENDADO`.
- **TRIG-04:** Idempotência pelo GHL Post ID já existente — reentrega não reprocessa.
- **D-02 (sucesso):** GHL publica → task vai para `publicado` + `IG Media ID` + `Link publicado`.
- **D-01 (falha):** GHL falha → task volta para `a agendar` + `Erro de publicação` + limpa `GHL Post ID`.
- **SYNC-03:** Mapeamento GHL evento → task via GHL Post ID salvo na task.
- **SYNC-06:** Dedup de reentrega GHL→ClickUp (estratégia = Claude's Discretion).
- **D-04:** Script `npm run setup:webhooks` idempotente.
- **D-03:** Deploy básico funcional no VPS ao fim da Phase 3. Endurecimento na Phase 4.
- **D-08:** Ingress via smee.io — smee-client no VPS encaminha para servidor local. Caveat: best-effort, sem SLA.
- **TRIG-05:** `npm start` (runSchedulerBatch) permanece como fallback manual.

### Claude's Discretion
- Estrutura de arquivos do servidor (ex.: `src/server/index.js`, `src/server/routes/`, etc.).
- Como expor TLS no VPS (reverse proxy nginx/caddy vs TLS direto no node).
- Store de dedup de eventos (memória vs arquivo).
- Porta do servidor via `.env`, com default sensato.

### Deferred Ideas (OUT OF SCOPE)
- PM2/systemd autostart, monitoring/alertas, runbook completo de deploy.
- Resiliência de processo (restart, retries/backoff de longo prazo).
- Loop contínuo configurável.
- Verificação ao vivo da capa de Reels.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SYNC-01 | Endpoint HTTP público recebe webhook do GHL para eventos de post (publicado/erro) | CRITICAL BLOCKER: GHL não emite webhooks nativos de Social Planner — ver RQ1. Fallback = polling periódico obrigatório. |
| SYNC-02 | Validar autenticidade do webhook GHL (segredo/assinatura) antes de processar | GHL usa Ed25519 (header `X-GHL-Signature`). Verificação com `crypto.verify(null, ...)`. Chave pública hardcoded. |
| SYNC-03 | Mapear post GHL de volta para task ClickUp via id do post salvo | Campo `_id` (ou `id`) no payload GHL. Buscar tasks com CF_GHL_POST_ID === postId via `getListTasks` + filter. |
| SYNC-04 | Ao publicar, mover task para `publicado` e preencher `IG Media ID` e `Link publicado` | `updateTask` + `setCustomField` x2 + `addComment`. Campos já têm UUIDs validados na Phase 2. |
| SYNC-05 | Ao falhar publicação no GHL, preencher `Erro de publicação` na task | `updateTask(STATUS_A_AGENDAR)` + `setCustomField(CF_ERRO_PUBLICACAO)` + `setCustomField(CF_GHL_POST_ID, '')` + `addComment`. |
| SYNC-06 | Webhook idempotente — reentrega do mesmo evento não duplica atualização | Dedup key: `webhookId:eventId` (ou equivalente GHL). In-memory Map com TTL suficiente. |
| TRIG-01 | Endpoint HTTP público recebe webhook ClickUp para mudança de status na lista 901327135553 | `POST /webhook/clickup` com raw body capturado. Registro via `POST /api/v2/team/90132819023/webhook` com `list_id: 901327135553`. |
| TRIG-02 | Validar autenticidade do webhook ClickUp (assinatura HMAC/segredo) | `X-Signature` header, HMAC-SHA256, secret = `webhook.secret` retornado na criação. Verificar sobre raw body exato. |
| TRIG-03 | Ao receber task que mudou para `agendado`, disparar agendamento via `processTask` | Filtrar `history_items[0].after.status === config.STATUS_AGENDADO`. Então `getTask(task_id)` + `processTask`. |
| TRIG-04 | Idempotência — reentrega não reagenda | `processTask` já tem guarda por CF_GHL_POST_ID. Sem lógica adicional necessária. |
| TRIG-05 | `npm start` (runSchedulerBatch) permanece disponível como fallback manual | Não há mudança necessária; `npm start` já funciona. Apenas garantir que `serve` não conflite. |
</phase_requirements>

---

## Summary

Esta fase implementa um servidor HTTP bidirecional que conecta ClickUp e GHL em tempo real. A pesquisa revelou **um bloqueador crítico e dois riscos técnicos importantes:**

**Bloqueador crítico (RQ1):** O GHL Social Planner NÃO emite webhooks nativos para eventos de post (publicado/falha). O mecanismo de webhook da GHL cobre Contact Events, Opportunity Events, Task Events, Appointment Events, etc. — mas não há trigger de workflow/automation para "post publicado no Social Planner". O SYNC-01 portanto não pode ser implementado com webhook GHL real. A solução é **polling periódico** do endpoint `GET /social-media-posting/:locationId/posts/:id` para tasks em estado `agendado` que já têm GHL Post ID.

**Risco técnico 1 (RQ5 — smee-client):** smee-client RECONSTRÓI o body HTTP fazendo `JSON.stringify(parsedData)` antes de enviar ao servidor local. Isso quebra HMAC sobre raw body. Há um issue aberto (probot/smee-client#325, out. 2024) confirmando que verificação de assinatura Stripe falha por esta razão. Para ClickUp (HMAC-SHA256 sobre raw body), **a verificação de assinatura vai falhar através do smee.io com a implementação padrão.** Dois caminhos: (a) desabilitar a verificação de assinatura no smee.io e habilitá-la só em produção; ou (b) em produção usar proxy direto (nginx/caddy) sem smee.io — que a Phase 4 revisará de qualquer forma. Recomendação: implementar a verificação HMAC corretamente mas acrescentar uma variável de ambiente `SKIP_SIGNATURE_VERIFY=true` para desenvolvimento local via smee.

**Risco técnico 2 (RQ1 — GHL Ed25519):** A rota `/webhook/ghl` receberá payloads do mecanismo de polling interno, não de um webhook real do GHL. O caminho mais limpo é: a rota `/webhook/ghl` é um endpoint interno acionado pelo job de polling (ou simplesmente o polling chama os handlers de write-back diretamente sem passar por HTTP). Ver Pattern recomendado abaixo.

**Primary recommendation:** Implementar `/webhook/clickup` para o gatilho em tempo real (ClickUp → GHL via processTask) e substituir SYNC (GHL → ClickUp) por um **polling periódico leve** sobre as tasks em estado `agendado` que tenham GHL Post ID — checkando o status do post via `GET /social-media-posting/:locationId/posts/:id`. O polling roda no mesmo processo do servidor.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Receber webhook ClickUp | HTTP Server (node:http) | — | Raw body capture necessário para HMAC |
| Verificar assinatura HMAC ClickUp | HTTP Server (pre-handler) | — | Deve rodar antes de qualquer efeito colateral |
| Filtrar evento taskStatusUpdated para `agendado` | HTTP Server handler | — | Lógica de filtragem simples inline |
| Agendar post no GHL | pipeline.processTask (Phase 2) | — | Reuso 100% conforme L-04 |
| Detectar post publicado/falha no GHL | Polling job (mesmo processo) | — | GHL não emite webhook nativo |
| Write-back ClickUp (publicado/erro) | ClickUp client (Phase 2) | — | updateTask + setCustomField + addComment já existem |
| Dedup de eventos | In-memory Map com TTL | — | Single-instance VPS; restart risk aceitável |
| Registro de webhooks | setup:webhooks script | — | Idempotente; cria ou reutiliza existente |
| Ingress público (dev/VPS simples) | smee.io channel | — | Decisão travada D-08 |
| TLS/HTTPS no VPS | nginx/caddy reverse proxy | — | Fora do código Node; configuração de infra |

---

## RQ1: GHL Webhooks para Social Planner

### Resultado: GHL NÃO emite webhooks nativos para eventos de post do Social Planner

**Confidence: HIGH** [VERIFIED: marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide + help.gohighlevel.com/support/solutions/articles/155000002292-a-list-of-workflow-triggers]

O GHL Webhook Integration Guide lista categorias de eventos: Contact Events, Opportunity Events, Task Events, Appointment Events, Invoice Events, Product Events, Association Events, Location Events, User Events. Sem categoria "Social Planner" ou "Post".

A lista completa de Workflow Triggers do GHL (80+ triggers em 13 categorias) inclui triggers sociais SOMENTE para comentários em posts (`Facebook – Comment(s) On A Post`, `Instagram – Comment(s) On A Post`, `TikTok – Comment(s) On A Video`). Não há trigger de "post publicado" ou "post falhou".

#### Mecanismo GHL de Assinatura (para referência futura)

O GHL assina webhooks que emite com **Ed25519** (substituindo RSA-SHA256, deprecated em 01/07/2026):

- **Header atual:** `X-GHL-Signature` (valor em Base64)
- **Header legado (deprecated):** `X-WH-Signature` (RSA-SHA256)
- **Chave pública Ed25519 (hardcoded na doc):**
  ```
  -----BEGIN PUBLIC KEY-----
  MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
  -----END PUBLIC KEY-----
  ```
- **Verificação Node.js:**
  ```javascript
  function verifyGhlSignature(rawBody, signature, publicKeyPem) {
    if (!signature || signature === 'N/A') return false;
    try {
      const payloadBuffer = Buffer.from(rawBody, 'utf8');
      const sigBuffer = Buffer.from(signature, 'base64');
      return crypto.verify(null, payloadBuffer, publicKeyPem, sigBuffer);
    } catch {
      return false;
    }
  }
  ```
- **Payload exemplo (genérico):**
  ```json
  {
    "type": "ContactCreate",
    "timestamp": "2025-01-28T14:35:00.000Z",
    "webhookId": "test-123",
    "data": { ... }
  }
  ```

[CITED: marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide]

#### Fallback obrigatório para SYNC-01..06: Polling periódico

Como o GHL não emite webhook de post publicado, o handler `/webhook/ghl` vira **um polling job interno** (não um endpoint HTTP externo receptor de webhook). Implementação:

1. No mesmo processo do servidor, `setInterval(pollGhlPosts, POLL_INTERVAL_MS)` onde `POLL_INTERVAL_MS` é configurável via `.env` (default recomendado: 5 minutos = 300000ms).
2. O polling busca tasks ClickUp em status `agendado` que possuam CF_GHL_POST_ID preenchido (via `getListTasks`).
3. Para cada task, chama `GET /social-media-posting/:locationId/posts/:postId`.
4. Se o status do post for `published` → write-back `publicado` + campos.
5. Se o status for `failed` → write-back `a agendar` + `Erro de publicação` + limpa CF_GHL_POST_ID.
6. Dedup: registrar o `postId` processado em um Map com TTL de 1 hora para não reprocessar.

**Status de post GHL conhecidos:** `scheduled`, `published`, `failed` [ASSUMED — não confirmado via docs JSON, mas consistente com a UI e comportamento da API Phase 2]

**Campo de ID do post GHL:** `_id` (confirmado empiricamente na Phase 2: `res.results.post._id`). No GET por id, o campo é provavelmente `post._id` ou `_id` no objeto de resposta. **SMOKE TEST obrigatório:** verificar shape de `GET /social-media-posting/:locationId/posts/:postId` com um post real.

#### Implicações para o plano

- A rota `/webhook/ghl` pode não existir como endpoint HTTP externo. Ou pode existir como endpoint interno que inicia o polling manualmente (para testes). Recomendação: implementar como `GET /admin/poll-ghl` (apenas para debug) e o polling automático via `setInterval`.
- SYNC-02 (validar autenticidade webhook GHL) torna-se N/A para o polling; o polling usa o próprio token GHL da aplicação.
- SYNC-06 (idempotência) é garantida pelo Map de dedup no polling.

---

## RQ2: ClickUp Webhooks — Esquema de Assinatura, Payload e Registro

**Confidence: HIGH** [VERIFIED: developer.clickup.com/docs/webhooksignature + developer.clickup.com/docs/webhooktaskpayloads + developer.clickup.com/docs/webhooks]

### Assinatura (TRIG-02)

- **Header:** `X-Signature`
- **Algoritmo:** HMAC-SHA256
- **Secret:** Campo `webhook.secret` retornado no body do `POST /team/{team_id}/webhook`
- **Input do HMAC:** raw body exato (string UTF-8) — sem parse, sem re-serialização
- **Output:** hex digest
- **Verificação Node.js (node:http nativo):**

```javascript
import crypto from 'crypto';

/**
 * @param {Buffer} rawBody   — chunks concatenados ANTES de JSON.parse
 * @param {string} header    — valor de req.headers['x-signature']
 * @param {string} secret    — config.CLICKUP_WEBHOOK_SECRET
 * @returns {boolean}
 */
export function verifyClickUpSignature(rawBody, header, secret) {
  if (!header) return false;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)      // Buffer ou string — não JSON.stringify(parsed)
    .digest('hex');
  // timing-safe compare
  return crypto.timingSafeEqual(
    Buffer.from(computed, 'hex'),
    Buffer.from(header, 'hex'),
  );
}
```

[CITED: developer.clickup.com/docs/webhooksignature]

### Payload taskStatusUpdated (RQ3)

O payload inclui o status novo INLINE — não é necessário chamar `getTask` apenas para saber o novo status. O `task_id` está disponível para buscar a task completa (necessário para `processTask`).

```json
{
  "event": "taskStatusUpdated",
  "task_id": "1vj38vv",
  "webhook_id": "7fa3ec74-69a8-4530-a251-8a13730bd204",
  "history_items": [
    {
      "id": "2800787326392370170",
      "type": 1,
      "date": "1642736073330",
      "field": "status",
      "parent_id": "162641062",
      "data": { "status_type": "custom" },
      "user": { "id": 183, "username": "John", "email": "john@example.com" },
      "before": { "status": "a agendar", "color": "#f9d900" },
      "after":  { "status": "agendado",  "color": "#7C4DFF" }
    }
  ]
}
```

[CITED: developer.clickup.com/docs/webhooktaskpayloads]

**Chave de idempotência:** `{{webhook_id}}:{{history_items[0].id}}` — documentado explicitamente pelo ClickUp.

### Filtro de Status (RQ3)

Para detectar mudança para `agendado`:
```javascript
const item = payload.history_items?.[0];
const newStatus = item?.after?.status;
if (newStatus !== config.STATUS_AGENDADO) {
  // No-op — responder 200 OK sem efeito colateral
  return;
}
```

`config.STATUS_AGENDADO` já existe (default: `'agendado'`). Sem hardcoding.

### Registro do Webhook (TRIG-01)

**Criar:**
```
POST https://api.clickup.com/api/v2/team/{team_id}/webhook
Authorization: {CLICKUP_TOKEN}
Content-Type: application/json

{
  "endpoint": "https://smee.io/<CHANNEL_ID>",
  "events": ["taskStatusUpdated"],
  "list_id": 901327135553
}
```

**Response:**
```json
{
  "id": "7689a169-a000-4985-8676-6902b96d6627",
  "webhook": {
    "id": "7689a169-...",
    "userid": 183,
    "team_id": 90132819023,
    "endpoint": "https://smee.io/<CHANNEL_ID>",
    "client_id": "...",
    "events": ["taskStatusUpdated"],
    "task_id": null,
    "list_id": 901327135553,
    "folder_id": null,
    "space_id": null,
    "health": { "status": "active", "fail_count": 0 },
    "secret": "SECRET_VALUE_SALVAR_NO_ENV"
  }
}
```

O `secret` é retornado **somente uma vez** na criação. Deve ser salvo imediatamente em `.env` como `CLICKUP_WEBHOOK_SECRET`.

**Listar existentes:**
```
GET https://api.clickup.com/api/v2/team/{team_id}/webhook
Authorization: {CLICKUP_TOKEN}
```

**Atualizar (idempotência):**
```
PUT https://api.clickup.com/api/v2/webhook/{webhook_id}
Body: { "endpoint": "...", "events": ["taskStatusUpdated"], "status": "active" }
```

**Deletar:**
```
DELETE https://api.clickup.com/api/v2/webhook/{webhook_id}
```

**Estratégia idempotente para `setup:webhooks`:**
1. `GET /team/{team_id}/webhook` → listar webhooks existentes.
2. Buscar webhook cujo `endpoint` contém a URL smee.io e `list_id === 901327135553`.
3. Se encontrado: `PUT /webhook/{id}` para garantir `status: active` e eventos corretos. NÃO cria novo.
4. Se não encontrado: `POST /team/{team_id}/webhook` → salvar secret retornado no `.env`.
5. Se não encontrado e `CLICKUP_WEBHOOK_SECRET` já existe no `.env`, avisar o usuário (secret não é recuperável).

[CITED: developer.clickup.com/reference/createwebhook + developer.clickup.com/reference/getwebhooks + developer.clickup.com/reference/updatewebhook]

---

## RQ4: Idempotência / Dedup

**Confidence: HIGH** (raciocínio de engenharia com base em VPS single-instance)

### ClickUp lado (TRIG-04)
- A guarda de `CF_GHL_POST_ID` em `processTask` cobre reentrega: se a task já tem Post ID, `processTask` pula.
- Dedup adicional recomendado: Map em memória `{webhook_id}:{history_items[0].id}` com TTL de 10 minutos. Evita dupla chamada a `processTask` em caso de reentrega rápida antes do write-back de CF_GHL_POST_ID.

### GHL polling lado (SYNC-06)
- Chave de dedup: `{postId}:{status}` — quando detectamos `published` ou `failed`, registramos no Map para não re-processar na próxima varredura.
- TTL: 2 horas (suficiente para cobertura de reinicializações acidentais serem visíveis).

### In-Memory Map com TTL — implementação mínima
```javascript
class DedupeStore {
  constructor(ttlMs = 10 * 60 * 1000) {
    this._map = new Map();
    this._ttl = ttlMs;
  }
  has(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) { this._map.delete(key); return false; }
    return true;
  }
  set(key) {
    this._map.set(key, { expiresAt: Date.now() + this._ttl });
  }
  /** Limpeza periódica opcional — evitar memory leak em runs longas */
  gc() {
    const now = Date.now();
    for (const [k, v] of this._map) {
      if (now > v.expiresAt) this._map.delete(k);
    }
  }
}
```

### Trade-off de restart
- In-memory: na reinicialização do processo, o store é zerado.
- Consequência para TRIG: reentrega de webhook após restart pode chamar `processTask` novamente — mas a guarda de CF_GHL_POST_ID no ClickUp ainda protege contra duplo agendamento.
- Consequência para SYNC (polling): na reinicialização, um post `published` pode ser re-notificado ao ClickUp. O ClickUp `updateTask` é idempotente (sobrescrever status `publicado` com `publicado` não causa dano). Aceitável para single-instance VPS.
- **Não usar SQLite/arquivo JSON**: overhead desnecessário para single-instance sem multi-processo; complica Phase 4 sem benefício real dado que CF_GHL_POST_ID já é a âncora de estado duradoura.

---

## RQ5: smee.io Ingress

**Confidence: MEDIUM** — smee-client é o canal correto, mas há um bug crítico de HMAC que requer workaround.

### smee-client v5.0.0 (npm)

- **Versão:** 5.0.0 (publicada 2025-11-13)
- **Dependências:** `eventsource ^4.0.0`, `undici ^7.0.0`
- **Maintainers:** probot organization (GitHub-backed, confiável)
- **Package:** `smee-client` no npm [VERIFIED: npm registry]

### Headers: SIM, são encaminhados

smee-client encaminha todos os headers `x-*` originais ao servidor local, incluindo:
- `x-signature` (ClickUp HMAC)
- `x-github-delivery`, `x-hub-signature`, `x-github-event` (confirmados em GitHub Probot)
- `x-forwarded-for`, `x-forwarded-proto`, `x-forwarded-port`

Issue #153 (AWS Lambda 403) confirma que os headers são todos encaminhados — o problema era conflito de headers de infra com o Lambda, não falta de headers.

[CITED: github.com/probot/smee-client/issues/153]

### BUG CRÍTICO: Body reconstruído via JSON.stringify (HMAC QUEBRA)

smee.io recebe o POST do webhook, faz `JSON.parse` do body, e serializa o evento via SSE. O smee-client, ao receber o SSE, faz `JSON.stringify(parsedData)` para reconstruir o body HTTP enviado ao servidor local.

**Efeito:** o body reconstruído pode diferir do body original (whitespace, ordenação de chaves, `1.0` → `1`). HMAC-SHA256 do ClickUp é calculado sobre o raw body exato. Portanto **a verificação de assinatura ClickUp falha ao usar smee.io no meio**.

Issue aberto: `probot/smee-client#325` (outubro 2024) — "Signature verification failing for Stripe events" — confirma o problema e cita o mesmo `JSON.stringify` em `index.ts#L59`.

[CITED: github.com/probot/smee-client/issues/325 + github.com/probot/smee.io/issues/5]

### Workaround recomendado

Adicionar variável de ambiente `SKIP_SIGNATURE_VERIFY` ao config:

```javascript
// src/config/index.js — novo campo opcional
SKIP_SIGNATURE_VERIFY: z.string().optional().transform(v => v === 'true'),
```

No handler `/webhook/clickup`:
```javascript
if (!config.SKIP_SIGNATURE_VERIFY) {
  if (!verifyClickUpSignature(rawBody, req.headers['x-signature'], config.CLICKUP_WEBHOOK_SECRET)) {
    res.writeHead(401); res.end('Unauthorized');
    return;
  }
}
```

- **Dev local via smee.io:** `.env` com `SKIP_SIGNATURE_VERIFY=true`
- **VPS produção (sem smee, com nginx):** `SKIP_SIGNATURE_VERIFY=false` ou ausente → verificação ativa

Esta separação permite que o servidor rode corretamente em produção (onde o nginx passa o raw body diretamente sem reserialização) enquanto possibilita desenvolvimento local.

### Criação do canal smee.io

```bash
# Criar canal (idempotente por URL única)
curl https://smee.io/new
# Retorna redirect para https://smee.io/<random_id>
# Salvar o <random_id> como SMEE_CHANNEL no .env ou hardcoded no setup:webhooks

# Alternativa: gerar no código
# fetch('https://smee.io/new', { redirect: 'manual' }) → Location header
```

O channel ID é permanente — usar a mesma URL registrada no webhook ClickUp.

### Executar smee-client no VPS

```javascript
// scripts/smee-forwarder.js (novo arquivo)
import SmeeClient from 'smee-client';
import { config } from '../src/config/index.js';

const smee = new SmeeClient({
  source: `https://smee.io/${config.SMEE_CHANNEL_ID}`,
  target: `http://localhost:${config.WEBHOOK_PORT}/webhook/clickup`,
  logger: console,
});

const events = smee.start();
// smee-client reconnecta automaticamente via EventSource (eventsource lib)
```

Para GHL polling (não tem webhook externo real): o smee-client é necessário apenas para ClickUp. A rota `/webhook/ghl` pode ser omitida ou servida localmente para testes manuais.

### Limitações smee.io conhecidas
- **Best-effort, sem SLA** — aceito na decisão D-08.
- **Payload size:** smee.io não documenta limite; na prática comporta payloads de webhooks típicos (<100KB).
- **Reconexão:** EventSource reconecta automaticamente em falha de conexão. Não requer lógica adicional.
- **HMAC quebrado com smee:** documentado acima. Workaround = `SKIP_SIGNATURE_VERIFY`.
- **Phase 4 revisão:** a decisão D-08 já prevê substituir smee por nginx/caddy em produção.

---

## Standard Stack

### Core (Phase 3)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:http | nativo | Servidor HTTP raw body | Decisão D-05; sem deps; controle total do stream |
| node:crypto | nativo | HMAC-SHA256 ClickUp + Ed25519 GHL | Sem deps; `timingSafeEqual` para comparação |
| smee-client | 5.0.0 | Relay webhook smee.io → localhost | Decisão D-08; probot org; eventsource+undici |
| zod | ^4.4.3 | Validação de config (já instalado) | Padrão do projeto CFG-01 |

### Já instalados (reuso)
| Library | Versão | Reuso Phase 3 |
|---------|--------|---------------|
| bottleneck | ^2.19.5 | Rate limit ClickUp client (getListTasks no polling) |
| p-retry | ^8.0.0 | Retry GHL/ClickUp nas chamadas do polling |
| pino | ^10.3.1 | Logger — withContext para módulo 'webhook' e 'poller' |
| dotenv | ^17.4.2 | Config via .env |

### Nova dependência
```bash
npm install smee-client@5.0.0
```

Nenhuma outra dependência nova necessária. O servidor HTTP, crypto e stream são todos `node:*` nativo.

**Installation:**
```bash
npm install smee-client@5.0.0
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| smee-client | npm | ~7 anos (v1: 2018) | Alto (probot org) | github.com/probot/smee-client | OK | Approved |

**Packages removed due to SLOP verdict:** none

**Packages flagged as suspicious SUS:** none

smee-client é mantido pela organização probot (GitHub/Octokit ecosystem). v5.0.0 publicada em 2025-11-13. Dependências: `eventsource` (npm top-500) e `undici` (Node.js official fetch). Sem scripts `postinstall`.

[VERIFIED: npm registry — `npm view smee-client@5.0.0`]

---

## Architecture Patterns

### System Architecture Diagram

```
ClickUp (webhook) ──POST──► smee.io channel ──SSE──► smee-client (VPS)
                                                              │
                                                    HTTP POST /webhook/clickup
                                                              │
                                                    node:http server (PORT)
                                                     ├── verifyClickUpSignature()
                                                     ├── filter: status === 'agendado'
                                                     ├── getTask(task_id)     [ClickUp API]
                                                     └── processTask(task, formatoOptionsMap)
                                                              │
                                                        [Phase 2 pipeline]
                                                              │
                                                         GHL Social Planner

                              setInterval(pollGhlPosts, POLL_INTERVAL_MS)
                                              │
                              getListTasks('agendado') [ClickUp API]
                                              │
                              filter: CF_GHL_POST_ID preenchido
                                              │
                              GET /social-media-posting/:locationId/posts/:postId [GHL API]
                                              │
                           ┌────────────────────────────────────┐
                       published                              failed
                           │                                    │
               updateTask('publicado')              updateTask('a agendar')
               setCustomField(CF_IG_MEDIA_ID)       setCustomField(CF_ERRO_PUBLICACAO)
               setCustomField(CF_LINK_PUBLICADO)     setCustomField(CF_GHL_POST_ID, '')
               addComment('✅ Publicado...')          addComment('❌ Falha...')
```

### Recommended Project Structure

```
src/
├── server/
│   ├── index.js          # Cria node:http server, registra rotas, inicia polling job
│   ├── routes/
│   │   ├── clickup.js    # Handler /webhook/clickup (TRIG-01..04)
│   │   └── health.js     # Handler GET /health
│   ├── verifySignature.js # verifyClickUpSignature() + verifyGhlSignature() (para futuro)
│   └── dedupe.js         # DedupeStore class (in-memory Map com TTL)
├── poller/
│   └── ghlStatusPoller.js # pollGhlPosts() + write-back handlers (SYNC-01..06)
├── clients/
│   ├── clickup.js        # Existente — adicionar findTaskByGhlPostId helper
│   └── ghl.js            # Existente — adicionar getPost(postId) method
├── config/
│   └── index.js          # Estender com WEBHOOK_PORT, CLICKUP_WEBHOOK_SECRET,
│                         #   GHL_WEBHOOK_SECRET (reserva), SMEE_CHANNEL_ID,
│                         #   POLL_INTERVAL_MS, STATUS_PUBLICADO, SKIP_SIGNATURE_VERIFY
├── scheduler/
│   └── pipeline.js       # Existente — não modificar
└── lib/
    ├── logger.js         # Existente
    └── errors.js         # Existente

scripts/
└── setup-webhooks.js     # npm run setup:webhooks — idempotente
```

### Pattern 1: Raw Body Capture em node:http

```javascript
// src/server/index.js
import http from 'node:http';

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    handleRequest(req, res, rawBody);
  });
  req.on('error', (err) => {
    log.error({ err: err.message }, 'Request stream error');
    res.writeHead(400); res.end();
  });
});

server.listen(config.WEBHOOK_PORT, () => {
  log.info({ port: config.WEBHOOK_PORT }, 'Webhook server listening');
});
```

### Pattern 2: Handler ClickUp → processTask

```javascript
// src/server/routes/clickup.js
export async function handleClickUp(req, res, rawBody) {
  // 1. Verificar assinatura (antes de tudo)
  if (!config.SKIP_SIGNATURE_VERIFY) {
    const sig = req.headers['x-signature'];
    if (!verifyClickUpSignature(rawBody, sig, config.CLICKUP_WEBHOOK_SECRET)) {
      log.warn({ step: 'hmac.fail' }, 'ClickUp webhook assinatura inválida — 401');
      res.writeHead(401); res.end('Unauthorized'); return;
    }
  }

  // 2. Parse JSON (só APÓS verificar assinatura)
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { res.writeHead(400); res.end(); return; }

  // 3. Responder 200 imediatamente (ClickUp tem timeout curto)
  res.writeHead(200); res.end('OK');

  // 4. Processar de forma assíncrona (fire-and-forget com erro isolado)
  setImmediate(async () => {
    try {
      if (payload.event !== 'taskStatusUpdated') return;

      const item = payload.history_items?.[0];
      const newStatus = item?.after?.status;
      if (newStatus !== config.STATUS_AGENDADO) return; // No-op

      const taskId = payload.task_id;
      if (!taskId) return;

      // Dedup key: webhook_id:history_item_id
      const dedupKey = `${payload.webhook_id}:${item.id}`;
      if (clickupDedup.has(dedupKey)) {
        log.info({ dedupKey }, 'ClickUp webhook reentrega ignorada (dedup)');
        return;
      }
      clickupDedup.set(dedupKey);

      // Buscar task completa (processTask precisa de custom_fields)
      const task = await clickup.getTask(taskId);

      // Buscar formatoOptionsMap (necessário para processTask)
      // Opção: cache do mapa em memória; recarregar periodicamente ou a cada chamada
      const formatoOptionsMap = await loadFormatoOptionsMap();

      await processTask(task, formatoOptionsMap);
    } catch (err) {
      log.error({ err: err.message }, 'Erro no handler ClickUp webhook');
    }
  });
}
```

### Pattern 3: Polling GHL Post Status

```javascript
// src/poller/ghlStatusPoller.js
export async function pollGhlPosts() {
  const pollLog = withContext({ module: 'poller' });
  try {
    // Buscar tasks em 'agendado' com CF_GHL_POST_ID preenchido
    const tasks = await clickup.getListTasks(config.CLICKUP_LIST_ID, config.STATUS_AGENDADO);
    const eligible = tasks.filter(t => readCF(t, config.CF_GHL_POST_ID));

    for (const task of eligible) {
      const postId = readCF(task, config.CF_GHL_POST_ID);
      const dedupKey = `${postId}:checked`;
      if (ghlDedup.has(dedupKey)) continue;

      try {
        const post = await ghl.getPost(postId); // NOVO método a adicionar
        // SMOKE: confirmar shape. Estimativa: post.status ∈ ['scheduled','published','failed']
        const status = post?.status ?? post?.post?.status;

        if (status === 'published') {
          ghlDedup.set(`${postId}:published`);
          await writeBackPublicado(task, post);
        } else if (status === 'failed') {
          ghlDedup.set(`${postId}:failed`);
          await writeBackFalha(task, post);
        }
        // 'scheduled' → sem ação, verificar na próxima rodada
      } catch (err) {
        pollLog.warn({ taskId: task.id, postId, err: err.message }, 'Erro ao verificar post GHL');
      }
    }
  } catch (err) {
    pollLog.error({ err: err.message }, 'Erro na varredura de polling GHL');
  }
}

// Write-back de sucesso (SYNC-04)
async function writeBackPublicado(task, post) {
  const igMediaId = post?.igMediaId ?? post?.instagramMediaId ?? null; // SMOKE: confirmar campo
  const permalink  = post?.permalink ?? post?.postUrl ?? null;          // SMOKE: confirmar campo
  await clickup.updateTask(task.id, { status: config.STATUS_PUBLICADO });
  if (igMediaId) await clickup.setCustomField(task.id, config.CF_IG_MEDIA_ID, igMediaId);
  if (permalink)  await clickup.setCustomField(task.id, config.CF_LINK_PUBLICADO, permalink);
  await clickup.addComment(task.id, `✅ Publicado no Instagram — media id: ${igMediaId ?? 'n/a'}`);
}

// Write-back de falha (SYNC-05, D-01)
async function writeBackFalha(task, post) {
  const mensagem = String(post?.failureReason ?? post?.error ?? 'Falha ao publicar').slice(0, 200);
  await clickup.updateTask(task.id, { status: config.STATUS_A_AGENDAR });
  await clickup.setCustomField(task.id, config.CF_ERRO_PUBLICACAO, mensagem);
  await clickup.setCustomField(task.id, config.CF_GHL_POST_ID, ''); // limpa para retry
  await clickup.addComment(task.id, `❌ Falha ao publicar no GHL: ${mensagem}`);
}
```

### Pattern 4: Config Extensions (src/config/index.js)

Adicionar ao `EnvSchema`:
```javascript
// Phase 3 — servidor webhook
WEBHOOK_PORT:              z.string().default('3000').transform(Number),
CLICKUP_WEBHOOK_SECRET:    z.string().min(1, 'CLICKUP_WEBHOOK_SECRET é obrigatório'),
// GHL não emite webhooks reais; campo reservado para futuro
GHL_WEBHOOK_SECRET:        z.string().optional().default(''),
SMEE_CHANNEL_ID:           z.string().min(1, 'SMEE_CHANNEL_ID é obrigatório para ingress'),
POLL_INTERVAL_MS:          z.string().default('300000').transform(Number), // 5 min
STATUS_PUBLICADO:          z.string().min(1).default('publicado'),
SKIP_SIGNATURE_VERIFY:     z.string().optional().transform(v => v === 'true'),
```

Adicionar ao objeto `config` exportado:
```javascript
WEBHOOK_PORT:           env.WEBHOOK_PORT,
CLICKUP_WEBHOOK_SECRET: env.CLICKUP_WEBHOOK_SECRET,
GHL_WEBHOOK_SECRET:     env.GHL_WEBHOOK_SECRET,
SMEE_CHANNEL_ID:        env.SMEE_CHANNEL_ID,
POLL_INTERVAL_MS:       env.POLL_INTERVAL_MS,
STATUS_PUBLICADO:       env.STATUS_PUBLICADO,
SKIP_SIGNATURE_VERIFY:  env.SKIP_SIGNATURE_VERIFY,
```

### Pattern 5: Script setup:webhooks Idempotente

```javascript
// scripts/setup-webhooks.js
import 'dotenv/config';
import { config } from '../src/config/index.js';

const BASE = 'https://api.clickup.com/api/v2';
const TEAM_ID = '90132819023';
const LIST_ID = 901327135553;
const SMEE_URL = `https://smee.io/${config.SMEE_CHANNEL_ID}`;

async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: config.CLICKUP_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function main() {
  // 1. Listar webhooks existentes
  const data = await req('GET', `/team/${TEAM_ID}/webhook`);
  const webhooks = data?.webhooks ?? [];

  const existing = webhooks.find(
    w => w.endpoint === SMEE_URL && Number(w.list_id) === LIST_ID
  );

  if (existing) {
    console.log('Webhook já existe:', existing.id, '— atualizando para garantir status active');
    await req('PUT', `/webhook/${existing.id}`, {
      endpoint: SMEE_URL,
      events: ['taskStatusUpdated'],
      status: 'active',
    });
    console.log('Webhook atualizado. Secret NÃO é retornado no update — usar o salvo no .env');
  } else {
    console.log('Criando novo webhook para', SMEE_URL);
    const result = await req('POST', `/team/${TEAM_ID}/webhook`, {
      endpoint: SMEE_URL,
      events: ['taskStatusUpdated'],
      list_id: LIST_ID,
    });
    console.log('Webhook criado:', result.webhook.id);
    console.log('⚠️  SALVAR NO .env AGORA:');
    console.log(`CLICKUP_WEBHOOK_SECRET=${result.webhook.secret}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

### Pattern 6: package.json scripts

```json
{
  "scripts": {
    "start":           "node src/index.js",
    "serve":           "node src/server/index.js",
    "smee":            "node scripts/smee-forwarder.js",
    "setup:webhooks":  "node scripts/setup-webhooks.js",
    "test":            "node --test"
  }
}
```

`npm run serve` inicia o servidor HTTP (rotas de webhook + polling job).
`npm run smee` inicia o relay smee-client (separado ou no mesmo processo do `serve`).
`npm start` continua sendo o batch — sem mudança (TRIG-05).

### Anti-Patterns to Avoid

- **Não parsear JSON antes de calcular HMAC:** o `rawBody` deve ir direto para `crypto.createHmac`. Nunca `JSON.stringify(JSON.parse(rawBody))`.
- **Não responder 200 depois de processar:** responder imediatamente e processar em `setImmediate`. ClickUp tem timeout de webhook; um processamento lento levaria a reentrega.
- **Não criar múltiplos webhooks:** o `setup:webhooks` deve verificar existência antes de criar — ClickUp não tem constraint de unicidade.
- **Não logar `CLICKUP_WEBHOOK_SECRET` nem `X-Signature` header value:** segue T-01-02 do projeto.
- **Não usar `express` ou `fastify`:** decisão D-05. Framework captura o body antes de dar acesso raw.
- **Não usar `==` para comparar HMACs:** usar `crypto.timingSafeEqual` para prevenir timing attack.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Raw body capture | Nada | node:http `req.on('data')` concat | É o padrão; sem middleware para não perder raw |
| HMAC verification | Comparação manual de strings | `crypto.timingSafeEqual` | Previne timing attacks |
| Rate limiting ClickUp (polling) | Sleep/delay próprio | `bottleneck` já instalado | Já cobre 100 req/min |
| Ed25519 verification | Implementação própria | `crypto.verify(null, ...)` nativo | Node.js tem suporte nativo a Ed25519 |
| Reconexão smee | Loop próprio | `smee-client` via `eventsource` | EventSource reconecta automaticamente |
| In-memory TTL store | Redis | DedupeStore simples (ver Pattern acima) | VPS single-instance; Redis é overhead |

---

## Common Pitfalls

### Pitfall 1: Verificação HMAC ClickUp falha via smee.io
**O que vai errado:** smee-client reconstrói o body HTTP via `JSON.stringify(parsedData)`, produzindo bytes diferentes do body original. O HMAC-SHA256 calculado sobre o body reconstituído não bate com `X-Signature`.
**Por que ocorre:** smee.io faz `JSON.parse` no servidor para encapsular em SSE; smee-client faz `JSON.stringify` de volta. Whitespace/formato muda.
**Como evitar:** `SKIP_SIGNATURE_VERIFY=true` em desenvolvimento com smee.io. Habilitar verificação em produção (sem smee, com nginx direto).
**Warning signs:** Response 401 em todos os webhooks do smee.io em dev.

### Pitfall 2: processTask precisa da task COMPLETA com custom_fields
**O que vai errado:** o payload ClickUp contém apenas `task_id`. Se chamar `processTask(payloadMínimo, map)` sem `custom_fields`, todos os `readCF()` retornam null e a task falha.
**Por que ocorre:** o webhook payload não inclui a task completa.
**Como evitar:** sempre chamar `clickup.getTask(task_id)` depois do filtro de status, antes de chamar `processTask`.
**Warning signs:** `Conteúdo incompleto na task filha` ou `Formato vazio` para tasks que parecem corretas.

### Pitfall 3: formatoOptionsMap deve ser carregado pelo handler (não só pelo batch)
**O que vai errado:** `processTask` requer `formatoOptionsMap`. O batch chama `getListFields` no início. O handler de webhook deve fazer o mesmo, mas pode esquecer.
**Por que ocorre:** `processTask` não chama `getListFields` internamente — depende do caller.
**Como evitar:** Cachear o `formatoOptionsMap` em memória no servidor (refresh a cada N minutos ou a cada chamada se o cache tiver expirado). Alternativa simples: recarregar a cada chamada (1 req extra ClickUp por webhook, dentro do rate limit).
**Warning signs:** `Formato vazio` para tasks com Formato correto.

### Pitfall 4: secret do ClickUp retornado SOMENTE na criação do webhook
**O que vai errado:** se o `setup:webhooks` for rodado de novo sem o secret no `.env`, e o webhook existir mas o secret tiver sido perdido, não há como recuperá-lo via API.
**Por que ocorre:** ClickUp retorna o `secret` apenas no response de `POST /team/{team_id}/webhook`. O `PUT` não retorna.
**Como evitar:** `setup:webhooks` deve avisar explicitamente quando criar um webhook novo e instrui o usuário a salvar o secret imediatamente.
**Warning signs:** Todos os webhooks chegam e são rejeitados com 401 sem razão aparente.

### Pitfall 5: GHL Post status — shape não documentado para polling
**O que vai errado:** o campo de status e os campos `igMediaId`/`permalink` do response de `GET /social-media-posting/:locationId/posts/:id` não estão documentados em HTML renderizável (docs JS-rendered).
**Por que ocorre:** mesma causa da Phase 2 (GHL docs requerem JS para renderizar schema).
**Como evitar:** SMOKE TEST obrigatório: com um post agendado real, chamar `GET /social-media-posting/:locationId/posts/:postId` e inspecionar o response completo antes de implementar o polling write-back.
**Warning signs:** Polling rodando mas `status` sempre `undefined`; campos de IG Media ID nunca preenchidos.

### Pitfall 6: Resposta lenta ao webhook ClickUp causa reentrega
**O que vai errado:** ClickUp tem timeout curto para o endpoint de webhook (~5s estimado). Se o handler demorar (ex: `getTask` + `processTask` numa request longa), ClickUp marca como falha e reentrega.
**Por que ocorre:** `processTask` é uma operação I/O-bound longa (upload de mídia, etc.).
**Como evitar:** Responder 200 imediatamente (`res.writeHead(200); res.end('OK')`) e processar em `setImmediate` ou `Promise.resolve().then(...)`.
**Warning signs:** Tasks sendo processadas em duplicata; logs de "processTask" repetidos para o mesmo `task_id`.

### Pitfall 7: Webhook ClickUp escopado pela list_id — mas list_id pode ser number vs string
**O que vai errado:** o ClickUp aceita `list_id` como número no body do POST de criação, mas pode retornar string no GET. A comparação de idempotência (`w.list_id === LIST_ID`) falha se os tipos diferem.
**Como evitar:** usar `Number(w.list_id) === LIST_ID` na comparação de idempotência do `setup:webhooks`.

---

## Don't Hand-Roll (Security Critical)

**NUNCA implementar HMAC ou Ed25519 do zero.** Usar exclusivamente:
- `crypto.createHmac('sha256', secret).update(rawBody).digest('hex')` (ClickUp)
- `crypto.verify(null, payloadBuffer, publicKeyPem, sigBuffer)` (GHL, Ed25519)
- `crypto.timingSafeEqual(a, b)` para comparar digests

---

## Runtime State Inventory

> Renome/refactor não se aplica a esta fase. Seção omitida.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >=24 | Servidor HTTP | ✓ | 24.14.0 | — |
| npm | Instalar smee-client | ✓ | presente | — |
| ClickUp API (`api.clickup.com`) | TRIG-01..04, polling | ✓ (tokens existem) | v2 | — |
| GHL API (`services.leadconnectorhq.com`) | Polling SYNC | ✓ (token existente) | 2021-07-28 | — |
| smee.io (internet) | Ingress webhook dev | ✓ (serviço público) | — | nginx/caddy direto no VPS |
| nginx/caddy (VPS) | TLS + proxy em produção | [ASSUMED] existente | — | Configurar na Phase 4 |

**Missing dependencies com no fallback:** nenhum bloqueante — todos os críticos disponíveis.

---

## Validation Architecture

> `workflow.nyquist_validation` não explicitamente false — incluindo seção.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (nativo, já configurado) |
| Config file | none (usa `node --test`) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRIG-02 | verifyClickUpSignature() aceita assinatura válida | unit | `npm test -- --test-name-pattern="verifyClickUpSignature"` | ❌ Wave 0 |
| TRIG-02 | verifyClickUpSignature() rejeita assinatura inválida (401) | unit | `npm test -- --test-name-pattern="verifyClickUpSignature"` | ❌ Wave 0 |
| TRIG-03 | Handler filtra eventos que não são taskStatusUpdated | unit | `npm test -- --test-name-pattern="clickup handler"` | ❌ Wave 0 |
| TRIG-03 | Handler filtra status != 'agendado' | unit | `npm test -- --test-name-pattern="clickup handler"` | ❌ Wave 0 |
| TRIG-04 | Reentrega com dedup key já registrada → no-op | unit | `npm test -- --test-name-pattern="dedup"` | ❌ Wave 0 |
| SYNC-06 | DedupeStore: has() false para nova key, true após set() | unit | `npm test -- --test-name-pattern="DedupeStore"` | ❌ Wave 0 |
| SYNC-06 | DedupeStore: expiração após TTL | unit | `npm test -- --test-name-pattern="DedupeStore"` | ❌ Wave 0 |
| SYNC-01 | Polling detecta status 'published' e chama writeBackPublicado | smoke manual | N/A — requer post real no GHL | — |
| SYNC-05 | Polling detecta status 'failed' e chama writeBackFalha | smoke manual | N/A — requer post que falhe no GHL | — |

### Wave 0 Gaps
- [ ] `src/tests/verifySignature.test.js` — cobre TRIG-02 com body/secret/signature gerados programaticamente
- [ ] `src/tests/dedupe.test.js` — cobre SYNC-06 (DedupeStore TTL)
- [ ] `src/tests/clickupHandler.test.js` — cobre TRIG-03 (filtros de evento/status)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | sim | Webhook secrets via `.env` + zod fail-fast |
| V3 Session Management | não | Servidor stateless (sem sessões) |
| V4 Access Control | sim | Validação HMAC antes de qualquer efeito colateral |
| V5 Input Validation | sim | Verificar `event` e `history_items` antes de usar |
| V6 Cryptography | sim | `crypto.timingSafeEqual` + `crypto.createHmac` nativo |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Webhook forjado (sem HMAC) | Spoofing | Verificar `X-Signature` antes de qualquer ação |
| Replay attack (reentrega repetida) | Elevation | DedupeStore com TTL por `webhook_id:history_item_id` |
| SSRF via smee channel público | Tampering | HMAC valida payload real; canal público é inócuo se assinatura inválida rejeitar |
| Secret em log | Info Disclosure | Nunca logar `X-Signature` header, `CLICKUP_WEBHOOK_SECRET`; redact já no pino |
| Timing attack em HMAC compare | Spoofing | `crypto.timingSafeEqual` obrigatório |
| SKIP_SIGNATURE_VERIFY em produção | Elevation | Garantir `SKIP_SIGNATURE_VERIFY` ausente/false no env de produção |

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| GHL RSA-SHA256 (`X-WH-Signature`) | Ed25519 (`X-GHL-Signature`) | deprecated julho 2026 | Se GHL emitir webhooks no futuro, usar Ed25519 |
| smee-client v4.x (eventsource v2) | smee-client v5.0.0 (eventsource v4, undici v7) | nov. 2025 | API de programmatic use é a mesma; instalar v5 explícita |

**Deprecated:**
- `X-WH-Signature` (GHL): deprecated. Se GHL introduzir webhooks de Social Planner no futuro, usar `X-GHL-Signature` + Ed25519.

---

## Smoke Tests Obrigatórios

Antes de confiar nas implementações, estes testes empíricos devem ser executados (analogia com o catch de Phase 1 que corrigiu `userId` e `results.post._id`):

1. **[SMOKE-GHL-GET-POST]** Chamar `GET /social-media-posting/:locationId/posts/:postId` com um post agendado real e inspecionar o response completo. Confirmar: campo de status (`status`? `state`?), campo de ID do post, campos de `igMediaId`/`permalink` após publicação.

2. **[SMOKE-CLICKUP-WEBHOOK]** Criar o webhook via `setup:webhooks`, mover uma task para `agendado` no ClickUp, verificar no log do servidor que: (a) o webhook chegou; (b) `X-Signature` está presente; (c) o filtro de status funciona; (d) `processTask` foi chamado.

3. **[SMOKE-SMEE-HEADERS]** Verificar que `X-Signature` chega ao servidor local (log do header antes da verificação). Se `SKIP_SIGNATURE_VERIFY=false` e smee está no caminho, confirmar que assinatura falha (esperado — documentado no Pitfall 1).

4. **[SMOKE-GHL-POST-FAILED]** Agendar um post com data no passado ou mídia inválida para forçar status `failed` no GHL, e verificar que o polling detecta e faz write-back correto.

5. **[SMOKE-IDEMPOTENCIA]** Reenviar o mesmo payload de webhook ClickUp duas vezes e verificar que apenas um `processTask` é executado (dedup por `webhook_id:history_item_id`).

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Status de post GHL são `scheduled`, `published`, `failed` | RQ1 / Polling | Write-back nunca dispara; tasks ficam em `agendado` para sempre |
| A2 | Response de `GET /posts/:id` tem campo `status` no nível raiz ou em `post.status` | Pattern 3 | Polling não detecta publicação/falha |
| A3 | Campos de IG Media ID e Link publicado estão em `igMediaId`/`permalink` ou similares | Pattern 3 | Campos ficam vazios mesmo após publicação |
| A4 | nginx/caddy estão disponíveis no VPS da Auton para proxy reverso | Environment | TLS/HTTPS precisaria ser configurado de outra forma |
| A5 | ClickUp retorna `webhook.secret` apenas na criação (não no update) | RQ2 | Pode ser possível recuperar o secret — verificar na prática |
| A6 | `formatoOptionsMap` pode ser carregado a cada chamada sem problema de rate limit | Pattern 2 | Pode atingir 100 req/min se muitos webhooks chegarem simultaneamente |
| A7 | GHL Social Planner não terá webhooks nativos no curto prazo | RQ1 | Se GHL lançar evento de post publicado, o polling pode ser substituído |

---

## Open Questions

1. **[OQ1] Shape exato do response `GET /social-media-posting/:locationId/posts/:id`**
   - O que sabemos: o endpoint existe; post id é `_id` no createPost response
   - O que está unclear: campo de `status`, campos de IG data, campo de erro em caso de falha
   - Recomendação: SMOKE-GHL-GET-POST antes de implementar polling write-back

2. **[OQ2] Timeout do ClickUp para webhook endpoint**
   - O que sabemos: resposta imediata + `setImmediate` é o padrão recomendado
   - O que está unclear: o timeout exato do ClickUp (estimado: 5–30s)
   - Recomendação: implementar o padrão de resposta imediata desde Wave 0; documentar no runbook (Phase 4)

3. **[OQ3] VPS: nginx/caddy já instalado?**
   - O que sabemos: VPS é próprio da Auton; TLS é responsabilidade da infra
   - O que está unclear: se o VPS já tem reverse proxy configurado ou se precisa setup
   - Recomendação: incluir no checklist de deploy do Phase 3 uma verificação do proxy

4. **[OQ4] STATUS_PUBLICADO no ClickUp — nome exato do status**
   - O que sabemos: `STATUS_A_AGENDAR = 'a agendar'`, `STATUS_AGENDADO = 'agendado'`; `STATUS_PUBLICADO` não está no config atual
   - O que está unclear: o nome exato do status `publicado` na lista 901327135553
   - Recomendação: adicionar `STATUS_PUBLICADO` ao `.env` com default `'publicado'`; verificar empiricamente

---

## Sources

### Primary (HIGH confidence)
- [developer.clickup.com/docs/webhooksignature](https://developer.clickup.com/docs/webhooksignature) — esquema HMAC-SHA256, header `X-Signature`, código de verificação
- [developer.clickup.com/docs/webhooktaskpayloads](https://developer.clickup.com/docs/webhooktaskpayloads) — payload exato de `taskStatusUpdated`, `history_items`, `before`/`after`
- [developer.clickup.com/docs/webhooks](https://developer.clickup.com/docs/webhooks) — lista de eventos, escopo por `list_id`, chave de idempotência
- [developer.clickup.com/reference/createwebhook](https://developer.clickup.com/reference/createwebhook) — parâmetros, response com secret
- [developer.clickup.com/reference/getwebhooks](https://developer.clickup.com/reference/getwebhooks) — listar webhooks existentes
- [developer.clickup.com/reference/updatewebhook](https://developer.clickup.com/reference/updatewebhook) — PUT webhook/{id}
- [marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide/) — Ed25519 public key, lista de categorias de eventos GHL
- [help.gohighlevel.com/support/solutions/articles/155000002292](https://help.gohighlevel.com/support/solutions/articles/155000002292-a-list-of-workflow-triggers) — lista completa de workflow triggers; confirma ausência de trigger de post publicado

### Secondary (MEDIUM confidence)
- [github.com/probot/smee-client/issues/153](https://github.com/probot/smee-client/issues/153) — confirma que headers `x-*` são encaminhados pelo smee-client
- [github.com/probot/smee-client/issues/325](https://github.com/probot/smee-client/issues/325) — confirma bug JSON.stringify que quebra HMAC via smee

### Tertiary (LOW confidence)
- GHL post status values (`scheduled`, `published`, `failed`) — [ASSUMED] com base em comportamento UI e empirismo Phase 2
- Response shape de `GET /posts/:id` para campos `igMediaId`/`permalink` — [ASSUMED] aguarda SMOKE-GHL-GET-POST

---

## Metadata

**Confidence breakdown:**
- RQ2 (ClickUp webhooks): HIGH — confirmado em docs oficiais com código de exemplo
- RQ3 (filtro de status): HIGH — payload completo documentado
- RQ1 (GHL webhooks): HIGH — ausência confirmada em docs oficiais (lista de 80+ triggers, nenhum Social Planner)
- RQ4 (dedup): HIGH — chave de idempotência documentada pelo ClickUp; estratégia in-memory é raciocínio de engenharia
- RQ5 (smee-client): MEDIUM — headers confirmados (issue #153); bug JSON.stringify confirmado (issue #325); workaround é raciocínio próprio
- GHL polling shape: LOW — campos específicos de resposta não documentados; SMOKE obrigatório

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (ClickUp/GHL APIs estáveis; smee-client bug pode ser corrigido antes disso — checar issue #325)
