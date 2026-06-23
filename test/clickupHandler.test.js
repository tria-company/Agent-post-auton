/**
 * test/clickupHandler.test.js
 *
 * RED até Plano 02 — test-first contract
 *
 * Fixa o contrato do handler /webhook/clickup (TRIG-01..04):
 *   - Filtro de evento: só processa 'taskStatusUpdated' (TRIG-03)
 *   - Filtro de status: só processa tasks que mudaram para STATUS_AGENDADO (TRIG-03)
 *   - Gate HMAC: 401 se assinatura inválida quando HMAC ativo (TRIG-02)
 *   - Resposta imediata 200 + processamento assíncrono (Pitfall 6)
 *
 * O módulo alvo `src/server/routes/clickup.js` ainda não existe — este arquivo
 * ficará RED até o Plano 03-02 implementar o módulo.
 *
 * Copiado de test/clients.test.js: helper fakeResponse + padrão mock.method
 */

import 'dotenv/config';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Módulo alvo (ainda não existe — RED até Plano 02)
import { handleClickUp } from '../src/server/routes/clickup.js';

// ---------------------------------------------------------------------------
// Helper: resposta HTTP fake (copiado de test/clients.test.js linhas 34-48)
// ---------------------------------------------------------------------------

function fakeResponse(status, body = {}, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? null,
    },
    async json() {
      return body;
    },
    async text() {
      return JSON.stringify(body);
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: cria objetos req/res fake para o handler
// ---------------------------------------------------------------------------

function makeReqRes({ headers = {}, body = '{}' } = {}) {
  const req = { headers };
  const res = {
    _status: null,
    _body: null,
    writeHead(status) { this._status = status; },
    end(body = '') { this._body = body; },
  };
  return { req, res, rawBody: Buffer.from(body, 'utf8') };
}

// ---------------------------------------------------------------------------
// Helper: gera uma assinatura HMAC-SHA256 válida para um body/secret
// ---------------------------------------------------------------------------

function makeHmacSig(rawBody, secret) {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

// ---------------------------------------------------------------------------
// Payload de teste para taskStatusUpdated
// ---------------------------------------------------------------------------

const AGENDADO_STATUS = 'agendado'; // config.STATUS_AGENDADO default

const taskStatusPayload = JSON.stringify({
  event: 'taskStatusUpdated',
  task_id: 'TASK001',
  webhook_id: 'WH001',
  history_items: [
    {
      id: 'HIST001',
      field: 'status',
      before: { status: 'a agendar' },
      after:  { status: AGENDADO_STATUS },
    },
  ],
});

// ---------------------------------------------------------------------------
// Test 1: Evento != 'taskStatusUpdated' é no-op (200, sem chamar processTask)
// ---------------------------------------------------------------------------

test('handleClickUp: evento taskCreated e no-op (200, sem processTask)', async (t) => {
  const body = JSON.stringify({ event: 'taskCreated', task_id: 'TASK001' });
  const rawBody = Buffer.from(body, 'utf8');

  // Mock de processTask — não deve ser chamado
  let processTaskCalled = false;

  const { req, res } = makeReqRes({
    headers: {
      'x-signature': makeHmacSig(rawBody, 'test-secret'),
    },
    body,
  });

  // Injetar deps fake para contornar ausência do módulo de produção
  const deps = {
    clickupDedup: { has: () => false, set: () => {} },
    loadFormatoOptionsMap: async () => ({}),
    processTaskOverride: async () => { processTaskCalled = true; },
  };

  await handleClickUp(req, res, rawBody, deps);

  // Deve responder 200 (no-op)
  assert.strictEqual(res._status, 200, 'Deve responder 200 mesmo para evento ignorado');
  assert.strictEqual(processTaskCalled, false, 'processTask NÃO deve ser chamado para evento diferente');
});

// ---------------------------------------------------------------------------
// Test 2: Status != STATUS_AGENDADO é no-op (200, sem processTask)
// ---------------------------------------------------------------------------

test('handleClickUp: status diferente de agendado e no-op', async (t) => {
  const outroStatusPayload = JSON.stringify({
    event: 'taskStatusUpdated',
    task_id: 'TASK002',
    webhook_id: 'WH002',
    history_items: [
      {
        id: 'HIST002',
        field: 'status',
        before: { status: 'agendado' },
        after:  { status: 'em revisao' },
      },
    ],
  });

  const rawBody = Buffer.from(outroStatusPayload, 'utf8');
  let processTaskCalled = false;

  const { req, res } = makeReqRes({
    headers: {
      'x-signature': makeHmacSig(rawBody, 'test-secret'),
    },
    body: outroStatusPayload,
  });

  const deps = {
    clickupDedup: { has: () => false, set: () => {} },
    loadFormatoOptionsMap: async () => ({}),
    processTaskOverride: async () => { processTaskCalled = true; },
  };

  await handleClickUp(req, res, rawBody, deps);

  assert.strictEqual(res._status, 200, 'Deve responder 200 para status ignorado');
  assert.strictEqual(processTaskCalled, false, 'processTask NÃO deve ser chamado para status diferente');
});

// ---------------------------------------------------------------------------
// Test 3: HMAC inválido → 401, sem processTask
// ---------------------------------------------------------------------------

test('handleClickUp: HMAC invalido retorna 401 e nao chama processTask', async (t) => {
  const rawBody = Buffer.from(taskStatusPayload, 'utf8');
  let processTaskCalled = false;

  const { req, res } = makeReqRes({
    headers: {
      // Assinatura completamente errada
      'x-signature': 'deadbeef'.repeat(8),
    },
    body: taskStatusPayload,
  });

  const deps = {
    clickupDedup: { has: () => false, set: () => {} },
    loadFormatoOptionsMap: async () => ({}),
    processTaskOverride: async () => { processTaskCalled = true; },
    // Forçar verificação HMAC ativa (SKIP_SIGNATURE_VERIFY=false)
    skipSignatureVerify: false,
    webhookSecret: 'secret-correto',
  };

  await handleClickUp(req, res, rawBody, deps);

  assert.strictEqual(res._status, 401, 'HMAC inválido deve retornar 401');
  assert.strictEqual(processTaskCalled, false, 'processTask NÃO deve ser chamado após 401');
});

// ---------------------------------------------------------------------------
// Test 4: processTask FALHA → write-back de erro (regressão do bug 03-02)
//   O handler deve replicar o write-back do batch: updateTask(a agendar) +
//   setCustomField(Erro de publicação) + addComment(❌). Antes só logava.
// ---------------------------------------------------------------------------

test('handleClickUp: processTask falha → chama writeBackFailure com a task e o erro', async (t) => {
  const rawBody = Buffer.from(taskStatusPayload, 'utf8');

  // getTask é a única chamada real → mockar fetch só para devolver a task.
  t.mock.method(globalThis, 'fetch', async (url, opts = {}) => {
    if (/\/task\/TASK001$/.test(String(url)) && (opts.method || 'GET') === 'GET') {
      return fakeResponse(200, { id: 'TASK001', custom_fields: [] });
    }
    return fakeResponse(200, {});
  });

  // Spy do write-back (injetado) — determinístico, sem fetch/Bottleneck.
  let wbTask = null;
  let wbErr = null;
  const { req, res } = makeReqRes({
    headers: { 'x-signature': makeHmacSig(rawBody, 'secret-correto') },
    body: taskStatusPayload,
  });

  const deps = {
    clickupDedup: { has: () => false, set: () => {} },
    loadFormatoOptionsMap: async () => ({}),
    processTaskOverride: async () => { throw new Error('Data no passado'); },
    writeBackFailureOverride: async (task, err) => { wbTask = task; wbErr = err; },
    skipSignatureVerify: false,
    webhookSecret: 'secret-correto',
  };

  await handleClickUp(req, res, rawBody, deps);
  assert.strictEqual(res._status, 200, 'Deve responder 200 imediatamente (Pitfall 6)');

  // Aguardar o setImmediate concluir — poll robusto (getTask passa pelo rate limiter,
  // que pode atrasar sob carga paralela; espera até 2s, sai assim que o spy roda).
  for (let i = 0; i < 100 && !wbTask; i++) await new Promise((r) => setTimeout(r, 20));

  assert.ok(wbTask, 'writeBackFailure deve ser chamado quando processTask falha');
  assert.strictEqual(wbTask.id, 'TASK001', 'deve passar a task buscada para o write-back');
  assert.match(wbErr?.message ?? '', /Data no passado/, 'deve passar o erro original para o write-back');
});
