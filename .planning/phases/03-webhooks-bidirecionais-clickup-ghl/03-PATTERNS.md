# Phase 3: Webhooks Bidirecionais (ClickUp ⇄ GHL) - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 10 new/modified files
**Analogs found:** 10 / 10

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/server/index.js` | server/entrypoint | request-response | `src/index.js` | role-match (same entrypoint + boot pattern) |
| `src/server/verifySignature.js` | utility | transform | `src/lib/errors.js` | partial (utility module, pure functions) |
| `src/server/routes/clickup.js` | handler/controller | request-response | `src/scheduler/pipeline.js` (processTask caller) | role-match |
| `src/server/routes/health.js` | handler | request-response | `src/index.js` (boot step log pattern) | partial |
| `src/server/dedupe.js` | utility/store | transform | `src/lib/errors.js` | partial (standalone utility class) |
| `src/poller/ghlStatusPoller.js` | service | batch + CRUD | `src/scheduler/pipeline.js` | exact (batch loop + write-back pattern) |
| `src/clients/ghl.js` | client | CRUD | `src/clients/ghl.js` itself | exact (add `getPost` method) |
| `src/clients/clickup.js` | client | CRUD | `src/clients/clickup.js` itself | exact (no change needed; `getListTasks` already covers polling) |
| `src/config/index.js` | config | — | `src/config/index.js` itself | exact (extend EnvSchema + freeze aliases) |
| `scripts/setup-webhooks.js` | script/utility | request-response | `src/clients/clickup.js` (`request` pattern) | role-match |

---

## Pattern Assignments

### `src/server/index.js` (server entrypoint, request-response)

**Analog:** `src/index.js` (boot pattern) + `src/clients/ghl.js` (log module pattern)

**Imports pattern** — copy from `src/index.js` lines 14–18 and `src/clients/ghl.js` lines 12–16:
```javascript
import http from 'node:http';
import { config } from '../config/index.js';
import { withContext } from '../lib/logger.js';
import { handleClickUp } from './routes/clickup.js';
import { handleHealth } from './routes/health.js';
import { pollGhlPosts } from '../poller/ghlStatusPoller.js';
```

**Module-level logger pattern** — copy from `src/clients/clickup.js` line 18:
```javascript
const log = withContext({ module: 'server' });
```

**Raw body capture pattern** — from RESEARCH.md Pattern 1:
```javascript
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', chunk => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    handleRequest(req, res, rawBody).catch(err => {
      log.error({ err: err.message }, 'Unhandled error in request handler');
      if (!res.writableEnded) { res.writeHead(500); res.end(); }
    });
  });
  req.on('error', err => {
    log.error({ err: err.message }, 'Request stream error');
    res.writeHead(400); res.end();
  });
});
```

**Server listen + polling start pattern** — modeled on `src/index.js` lines 28–32 (structured log on each step):
```javascript
server.listen(config.WEBHOOK_PORT, () => {
  log.info({ port: config.WEBHOOK_PORT }, 'Webhook server listening');
});

// Start GHL polling loop in same process (D-06)
setInterval(() => {
  pollGhlPosts().catch(err =>
    log.error({ err: err.message }, 'Polling GHL falhou — próxima rodada em breve'),
  );
}, config.POLL_INTERVAL_MS);
log.info({ intervalMs: config.POLL_INTERVAL_MS }, 'GHL status poller iniciado');
```

**Entrypoint guard pattern** — copy from `src/index.js` lines 97–116:
```javascript
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] === __filename;

if (isEntrypoint) {
  // start server
}
```

---

### `src/server/verifySignature.js` (utility, transform)

**Analog:** `src/lib/errors.js` (pure-function utility module)

**Module structure** — copy module header comment style from `src/lib/errors.js` lines 1–7:
```javascript
/**
 * src/server/verifySignature.js
 *
 * Verifica a assinatura HMAC-SHA256 do webhook ClickUp.
 * Input: rawBody (Buffer), header x-signature (hex string), secret.
 * NUNCA logar o valor do header nem do secret (T-01-02).
 */
import crypto from 'node:crypto';
```

**Core HMAC pattern** — from RESEARCH.md RQ2 (HIGH confidence, official ClickUp docs):
```javascript
/**
 * @param {Buffer} rawBody   — Buffer.concat(chunks) ANTES de JSON.parse
 * @param {string} header    — req.headers['x-signature']
 * @param {string} secret    — config.CLICKUP_WEBHOOK_SECRET
 * @returns {boolean}
 */
export function verifyClickUpSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody)       // Buffer direto — NUNCA JSON.stringify(JSON.parse(...))
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(header, 'hex'),
    );
  } catch {
    return false; // tamanhos diferentes → timingSafeEqual lança
  }
}
```

**No analog for GHL Ed25519 in codebase** — use RESEARCH.md pattern:
```javascript
// Reservado para futuro (GHL não emite webhook de Social Planner atualmente)
const GHL_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;

export function verifyGhlSignature(rawBody, signature) {
  if (!signature || signature === 'N/A') return false;
  try {
    return crypto.verify(null, Buffer.from(rawBody, 'utf8'), GHL_PUBLIC_KEY_PEM,
      Buffer.from(signature, 'base64'));
  } catch { return false; }
}
```

---

### `src/server/routes/clickup.js` (handler, request-response)

**Analog:** `src/scheduler/pipeline.js` (caller of processTask; log + error isolation pattern)

**Imports pattern** — modeled on `src/scheduler/pipeline.js` lines 49–56:
```javascript
import { config } from '../../config/index.js';
import { withContext } from '../../lib/logger.js';
import { verifyClickUpSignature } from '../verifySignature.js';
import { clickup } from '../../clients/clickup.js';
import { processTask } from '../../scheduler/pipeline.js';
```

**Module-level logger** — from `src/clients/clickup.js` line 18:
```javascript
const log = withContext({ module: 'webhook.clickup' });
```

**HMAC gate + immediate 200 + async processing** — from RESEARCH.md Pattern 2:
```javascript
export async function handleClickUp(req, res, rawBody, { clickupDedup, loadFormatoOptionsMap }) {
  // 1. HMAC verification BEFORE any side-effects (L-05)
  if (!config.SKIP_SIGNATURE_VERIFY) {
    const sig = req.headers['x-signature'];
    // NUNCA logar o valor de sig (T-01-02)
    if (!verifyClickUpSignature(rawBody, sig, config.CLICKUP_WEBHOOK_SECRET)) {
      log.warn({ step: 'hmac.fail' }, 'ClickUp webhook assinatura inválida — 401');
      res.writeHead(401); res.end('Unauthorized'); return;
    }
  }

  // 2. Parse JSON only AFTER HMAC passes
  let payload;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { res.writeHead(400); res.end(); return; }

  // 3. Respond 200 IMMEDIATELY — ClickUp has short timeout (Pitfall 6)
  res.writeHead(200); res.end('OK');

  // 4. Process asynchronously, isolated (pattern from pipeline.js D-18)
  setImmediate(async () => {
    try {
      if (payload.event !== 'taskStatusUpdated') return;
      const item = payload.history_items?.[0];
      if (item?.after?.status !== config.STATUS_AGENDADO) return;

      const dedupKey = `${payload.webhook_id}:${item.id}`;
      if (clickupDedup.has(dedupKey)) {
        log.info({ dedupKey }, 'Reentrega ignorada (dedup)'); return;
      }
      clickupDedup.set(dedupKey);

      // getTask required: webhook payload has no custom_fields (Pitfall 2)
      const task = await clickup.getTask(payload.task_id);
      const formatoOptionsMap = await loadFormatoOptionsMap();
      await processTask(task, formatoOptionsMap);
    } catch (err) {
      log.error({ err: err.message }, 'Erro no handler ClickUp webhook');
    }
  });
}
```

---

### `src/server/routes/health.js` (handler, request-response)

**Analog:** `src/index.js` lines 31–34 (step log pattern)

**Pattern:**
```javascript
import { withContext } from '../../lib/logger.js';
const log = withContext({ module: 'server.health' });

export function handleHealth(req, res) {
  log.info({ step: 'health.check' }, 'Health check OK');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }));
}
```

---

### `src/server/dedupe.js` (utility/store, in-memory)

**Analog:** `src/lib/errors.js` (standalone class in its own module)

**Module structure** — follow the JSDoc + class pattern from `src/lib/errors.js` lines 9–70:
```javascript
/**
 * src/server/dedupe.js
 *
 * In-memory Map com TTL para idempotência de webhook (TRIG-04, SYNC-06).
 * Single-instance VPS: restart zera o store — aceitável (CF_GHL_POST_ID é âncora duradoura).
 */
export class DedupeStore {
  /**
   * @param {number} ttlMs - Time-to-live em ms (default: 10 minutos)
   */
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

  /** Limpeza periódica — evitar memory leak em runs longas */
  gc() {
    const now = Date.now();
    for (const [k, v] of this._map) {
      if (now > v.expiresAt) this._map.delete(k);
    }
  }
}
```

---

### `src/poller/ghlStatusPoller.js` (service, batch + CRUD)

**Analog:** `src/scheduler/pipeline.js` — exact match: batch loop over tasks + write-back helpers

**Imports pattern** — copy from `src/scheduler/pipeline.js` lines 49–56:
```javascript
import { config } from '../config/index.js';
import { withContext } from '../lib/logger.js';
import { clickup } from '../clients/clickup.js';
import { ghl } from '../clients/ghl.js';
```

**Module-level logger** — same as pipeline.js line 56:
```javascript
const log = withContext({ module: 'poller' });
```

**Loop + per-item isolation** — copy the `try/catch` per-item isolation pattern from `src/scheduler/pipeline.js` (D-18): each task in its own try/catch; a single failure does not abort the loop.

**readCF reuse** — import `readCF` from `src/scheduler/pipeline.js` (already exported):
```javascript
import { readCF } from '../scheduler/pipeline.js';
```

**Write-back pattern** — mirrors `processTask` write-back at bottom of pipeline.js (setCustomField + addComment with ✅/❌ prefix):
```javascript
async function writeBackPublicado(task, post) {
  // SMOKE-GHL-GET-POST required to confirm igMediaId/permalink field names
  const igMediaId = post?.igMediaId ?? post?.instagramMediaId ?? null;
  const permalink  = post?.permalink ?? post?.postUrl ?? null;
  await clickup.updateTask(task.id, { status: config.STATUS_PUBLICADO });
  if (igMediaId) await clickup.setCustomField(task.id, config.CF_IG_MEDIA_ID, igMediaId);
  if (permalink)  await clickup.setCustomField(task.id, config.CF_LINK_PUBLICADO, permalink);
  await clickup.addComment(task.id, `✅ Publicado no Instagram — media id: ${igMediaId ?? 'n/a'}`);
}

async function writeBackFalha(task, post) {
  const mensagem = String(post?.failureReason ?? post?.error ?? 'Falha ao publicar').slice(0, 200);
  await clickup.updateTask(task.id, { status: config.STATUS_A_AGENDAR });
  await clickup.setCustomField(task.id, config.CF_ERRO_PUBLICACAO, mensagem);
  await clickup.setCustomField(task.id, config.CF_GHL_POST_ID, ''); // limpa para retry (D-01)
  await clickup.addComment(task.id, `❌ Falha ao publicar no GHL: ${mensagem}`);
}
```

**Dedup key for polling** — `${postId}:${status}` with 2-hour TTL (RESEARCH.md RQ4).

---

### `src/clients/ghl.js` — add `getPost` method (client, CRUD)

**Analog:** `src/clients/ghl.js` itself — copy exactly the `listAccounts` method shape (lines 107–109):

```javascript
// Existing pattern (lines 107-109):
listAccounts: () =>
  request('GET', `/social-media-posting/${config.GHL_LOCATION_ID}/accounts`),

// New method — same pattern:
/**
 * Busca um post do Social Planner pelo id.
 * GET /social-media-posting/{locationId}/posts/{postId}
 *
 * Shape de resposta: SMOKE-GHL-GET-POST obrigatório antes de confiar nos campos.
 * Estimativa: { status: 'scheduled'|'published'|'failed', igMediaId, permalink, ... }
 *
 * @param {string} postId
 * @returns {Promise<object>}
 */
getPost: (postId) =>
  request('GET', `/social-media-posting/${config.GHL_LOCATION_ID}/posts/${postId}`),
```

**No other changes to ghl.js needed.**

---

### `src/config/index.js` — extend with Phase 3 fields (config)

**Analog:** `src/config/index.js` itself — extend the existing `EnvSchema` and `Object.freeze` export.

**EnvSchema addition pattern** — follow the Phase 2 block style at lines 45–54 exactly (comment header + grouped fields):

```javascript
// Phase 3 — servidor webhook + polling (CFG-01)
WEBHOOK_PORT:           z.string().default('3000').transform(Number),
CLICKUP_WEBHOOK_SECRET: z.string().min(1, { message: 'CLICKUP_WEBHOOK_SECRET é obrigatório' }),
GHL_WEBHOOK_SECRET:     z.string().optional().default(''),  // reservado — GHL não emite webhooks nativos
SMEE_CHANNEL_ID:        z.string().min(1, { message: 'SMEE_CHANNEL_ID é obrigatório para ingress' }),
POLL_INTERVAL_MS:       z.string().default('300000').transform(Number),
STATUS_PUBLICADO:       z.string().min(1).default('publicado'),
SKIP_SIGNATURE_VERIFY:  z.string().optional().transform(v => v === 'true'),
```

**Object.freeze additions** — follow the alias pattern at lines 99–122 (same grouping comment style):
```javascript
// Phase 3 — servidor webhook + polling
WEBHOOK_PORT:           env.WEBHOOK_PORT,
CLICKUP_WEBHOOK_SECRET: env.CLICKUP_WEBHOOK_SECRET,
GHL_WEBHOOK_SECRET:     env.GHL_WEBHOOK_SECRET,
SMEE_CHANNEL_ID:        env.SMEE_CHANNEL_ID,
POLL_INTERVAL_MS:       env.POLL_INTERVAL_MS,
STATUS_PUBLICADO:       env.STATUS_PUBLICADO,
SKIP_SIGNATURE_VERIFY:  env.SKIP_SIGNATURE_VERIFY,
```

**JSDoc @type block** — add the 7 new fields following the existing format (lines 77–97).

---

### `scripts/setup-webhooks.js` (script, request-response)

**Analog:** `src/clients/clickup.js` — copy the raw `fetch` + auth header pattern (lines 48–55); the script uses its own minimal `req()` wrapper instead of the client (no Bottleneck needed for a one-shot script).

**Imports pattern:**
```javascript
import 'dotenv/config';
import { config } from '../src/config/index.js';
```

**Minimal fetch wrapper** — same shape as `clickup.js` request() but without Bottleneck/pRetry (one-shot script):
```javascript
async function req(method, path, body) {
  const res = await fetch(`https://api.clickup.com/api/v2${path}`, {
    method,
    headers: { Authorization: config.CLICKUP_TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`ClickUp ${res.status}: ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
```

**Idempotency pattern** — list → find by endpoint+list_id → PUT if exists / POST if not:
```javascript
// Number(w.list_id) === LIST_ID because ClickUp may return string (Pitfall 7)
const existing = webhooks.find(
  w => w.endpoint === SMEE_URL && Number(w.list_id) === LIST_ID
);
```

**Secret warning pattern** — console.log to stdout (script context, not pino):
```javascript
console.log('⚠️  SALVAR NO .env AGORA — secret não é recuperável via API:');
console.log(`CLICKUP_WEBHOOK_SECRET=${result.webhook.secret}`);
```

---

### Test files (3 new files)

**Analog:** `test/clients.test.js` — exact match: node:test, `mock.method` on `globalThis.fetch`, `fakeResponse` helper, `assert/strict`.

**Test file structure** — copy from `test/clients.test.js` lines 1–48:
```javascript
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
```

**`test/verifySignature.test.js`** — no fetch mock needed; use `crypto.createHmac` inline to generate valid/invalid signatures:
```javascript
import crypto from 'node:crypto';
import { verifyClickUpSignature } from '../src/server/verifySignature.js';

test('verifyClickUpSignature: valid signature returns true', () => {
  const secret = 'test-secret';
  const body = Buffer.from('{"event":"taskStatusUpdated"}');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('hex');
  assert.strictEqual(verifyClickUpSignature(body, sig, secret), true);
});

test('verifyClickUpSignature: invalid signature returns false (401 gate)', () => {
  const body = Buffer.from('{}');
  assert.strictEqual(verifyClickUpSignature(body, 'deadbeef'.repeat(8), 'secret'), false);
});
```

**`test/dedupe.test.js`** — no mocks needed; pure in-memory test:
```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DedupeStore } from '../src/server/dedupe.js';

test('DedupeStore: has() false for new key, true after set()', () => {
  const store = new DedupeStore(1000);
  assert.strictEqual(store.has('k1'), false);
  store.set('k1');
  assert.strictEqual(store.has('k1'), true);
});

test('DedupeStore: expires after TTL', async () => {
  const store = new DedupeStore(10); // 10ms TTL
  store.set('k2');
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(store.has('k2'), false);
});
```

**`test/clickupHandler.test.js`** — mock `clickup.getTask` and `processTask` via `mock.method`:
```javascript
// Copy fakeResponse helper from test/clients.test.js lines 33-48
// Then:
test('handleClickUp: non-taskStatusUpdated event is no-op (200, no processTask)', async (t) => { ... });
test('handleClickUp: status != STATUS_AGENDADO is no-op', async (t) => { ... });
test('handleClickUp: invalid HMAC returns 401 when SKIP_SIGNATURE_VERIFY is false', async (t) => { ... });
```

---

## Shared Patterns

### Module-level logger (apply to ALL new src/ files)

**Source:** `src/clients/clickup.js` line 18 / `src/clients/ghl.js` line 16

```javascript
const log = withContext({ module: 'REPLACE_WITH_MODULE_NAME' });
```

Use `module` values: `'server'`, `'webhook.clickup'`, `'poller'`, `'server.health'`.

### Never log auth headers / secrets (apply to ALL new files)

**Source:** `src/clients/clickup.js` line 47 comment + `src/clients/ghl.js` lines 25–33

Rule: NEVER pass `req.headers['x-signature']`, `config.CLICKUP_WEBHOOK_SECRET`, or any token value to a log call. Log only structural metadata (`step`, `dedupKey`, `taskId`, `err.message`).

### pRetry + AbortError for non-retryable errors (apply to any new API call wrappers)

**Source:** `src/clients/clickup.js` lines 83–88 / `src/clients/ghl.js` lines 68–73

```javascript
// 4xx non-429: convert to AppError, AbortError to stop retries
if (!res.ok) {
  const appErr = await AppError.fromGHL(res);   // or fromClickUp
  log.warn({ status: appErr.status, code: appErr.code }, '...');
  throw new AbortError(appErr);
}
```

### Error isolation per item (apply to poller loop and any batch)

**Source:** `src/scheduler/pipeline.js` D-18 pattern — each item in its own try/catch, failure does not abort the loop.

### Fail-fast config via zod (apply to config extension)

**Source:** `src/config/index.js` lines 62–69

```javascript
const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Config inválida — verifique o arquivo .env:\n');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}
```

### Write-back comment style (apply to poller write-backs)

**Source:** `src/scheduler/pipeline.js` (processTask write-back section)

Prefix: `✅` for success comments, `❌` for failure comments. Short message, no stack trace, no URLs, no tokens. Max 200 chars (`MAX_ERRO_MSG_LEN`).

---

## No Analog Found

All target files have analogs in this codebase. No files fall into this category.

---

## Metadata

**Analog search scope:** `src/clients/`, `src/config/`, `src/lib/`, `src/scheduler/`, `src/index.js`, `test/`
**Files scanned:** 8 source files + 6 test files
**Pattern extraction date:** 2026-06-22
