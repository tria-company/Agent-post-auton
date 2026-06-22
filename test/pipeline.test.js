/**
 * test/pipeline.test.js
 *
 * Testes TDD para o scheduler pipeline (02-02-PLAN.md).
 *
 * Abordagem:
 *   - Mock de globalThis.fetch (padrão de test/clients.test.js)
 *   - Stub de módulos via substituição de globalThis.fetch para os clients
 *   - Import dinâmico do pipeline após stubs (módulos são cacheados — os clients
 *     usam globalThis.fetch em call-time, então o mock funciona mesmo com cache)
 *
 * RED → GREEN:
 *   - Test E2E (runSchedulerBatch happy-path): RED até Task 3 criar pipeline.js
 *   - Test idempotência: RED até Task 3
 *   - Test getListTasks paginação: passa imediatamente (getListTasks implementado na Task 1)
 */

import 'dotenv/config';
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: resposta fake de fetch
// ---------------------------------------------------------------------------

/**
 * @param {number} status
 * @param {object} [body]
 * @param {Record<string,string>} [headers]
 */
function fakeResponse(status, body = {}, headers = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

// ---------------------------------------------------------------------------
// UUIDs de custom fields (reais, conforme real_clickup_field_ids na instrução)
// ---------------------------------------------------------------------------
const CF_GHL_POST_ID     = process.env.CU_FIELD_GHL_POST_ID    ?? 'a1b2c3d4-1234-4abc-8def-000000000001';
const CF_LINK_DO_POST    = process.env.CU_FIELD_LINK_DO_POST   ?? 'a1b2c3d4-1234-4abc-8def-000000000002';
const CF_FORMATO         = process.env.CU_FIELD_FORMATO        ?? '24e0f126-589f-400c-a602-0e4abe19b809';
const CF_LEGENDA         = process.env.CU_FIELD_LEGENDA        ?? '91c07244-6ce6-42c7-bea2-ec49dba12fd3';
const CF_DATA_PUBLICACAO = process.env.CU_FIELD_DATA_PUBLICACAO ?? 'd5107244-d044-4bd0-ae5c-c07f8a4f194e';
const CF_ID_TASK_MAE     = process.env.CU_FIELD_ID_TASK_MAE    ?? '3f37fbaa-93d0-4344-9fe2-f7c2c7320383';

// Timestamp futuro de publicação (epoch ms como string — padrão ClickUp)
const FUTURE_EPOCH_MS = String(Date.now() + 7 * 24 * 60 * 60 * 1000);

// Ordem esperada dos orderindexes do dropdown Formato para 'Feed estático'
// O ClickUp retorna orderindex (0, 1, 2, ...) para o valor de campos dropdown.
// Reels=0, Carrossel=1, Stories=2, Feed estático=3 (ordem confirmada nos testes live).
// O pipeline lê orderindex e mapeia via o mapa de opções do campo.
const FORMATO_FEED_ESTATICO_ORDERINDEX = 3; // posição no dropdown

// ---------------------------------------------------------------------------
// Task elegível de mídia única (Feed estático) — stub base
// ---------------------------------------------------------------------------
function makeEligibleTask(overrides = {}) {
  return {
    id: 'TASK001',
    name: 'Post de teste',
    status: { status: 'a agendar' },
    custom_fields: [
      { id: CF_GHL_POST_ID,     value: null },          // vazio → elegível
      { id: CF_LEGENDA,         value: 'Legenda teste' },
      { id: CF_LINK_DO_POST,    value: 'https://minio.example.com/media.zip' },
      { id: CF_FORMATO,         value: FORMATO_FEED_ESTATICO_ORDERINDEX },
      { id: CF_DATA_PUBLICACAO, value: FUTURE_EPOCH_MS },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// TEST 1: getListTasks — paginação automática (VERDE desde Task 1)
// ---------------------------------------------------------------------------

test('clickup.getListTasks: pagina até tasks[] vazio — fetch chamado N+1 vezes', async (t) => {
  // Página 0: 2 tasks; página 1: 0 tasks (encerra loop)
  let callCount = 0;
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    callCount++;
    const urlStr = String(url);
    // Bottleneck usa GET /list/{id}/task?statuses[]=...&page=N
    const u = new URL(urlStr);
    const page = Number(u.searchParams.get('page') ?? '0');
    if (page === 0) {
      return fakeResponse(200, { tasks: [{ id: 'T1' }, { id: 'T2' }] });
    }
    // Página 1 em diante → vazio → encerra
    return fakeResponse(200, { tasks: [] });
  });

  const { clickup } = await import('../src/clients/clickup.js');
  const tasks = await clickup.getListTasks('901327135553', 'a agendar');

  assert.strictEqual(tasks.length, 2, 'Deve retornar 2 tasks da página 0');
  assert.strictEqual(callCount, 2, 'fetch chamado 2x: página 0 (com tasks) + página 1 (vazia, encerra)');

  fetchMock.mock.restore();
});

test('clickup.getListTasks: monta statuses[]= na query string', async (t) => {
  let capturedUrl = '';
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url) => {
    capturedUrl = String(url);
    return fakeResponse(200, { tasks: [] }); // encerra imediatamente
  });

  const { clickup } = await import('../src/clients/clickup.js');
  await clickup.getListTasks('901327135553', 'meu status');

  assert.ok(
    capturedUrl.includes('statuses%5B%5D=meu+status') || capturedUrl.includes('statuses[]=meu+status'),
    `URL deve conter statuses[]=meu status. URL capturada: ${capturedUrl}`,
  );

  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// TEST 2: E2E happy-path (RED — vai falhar até Task 3 criar pipeline.js)
// ---------------------------------------------------------------------------

test('runSchedulerBatch: happy-path de mídia única → updateTask(agendado) + setCustomField(GHL_POST_ID)', async (t) => {
  // ---- Stubs de fetch por URL ----
  const calls = [];

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    calls.push({ url: urlStr, method: opts?.method ?? 'GET', body: opts?.body });

    // ClickUp: getListTasks → 1 task elegível na página 0, vazia na 1
    if (urlStr.includes('/list/') && urlStr.includes('/task?') && (opts?.method ?? 'GET') === 'GET') {
      const u = new URL(urlStr);
      const page = Number(u.searchParams.get('page') ?? '0');
      if (page === 0) {
        return fakeResponse(200, { tasks: [makeEligibleTask()] });
      }
      return fakeResponse(200, { tasks: [] });
    }

    // ClickUp: getListFields (bootstrap Formato options map)
    if (urlStr.includes('/field') && (opts?.method ?? 'GET') === 'GET') {
      return fakeResponse(200, {
        fields: [
          {
            id: CF_FORMATO,
            name: 'Formato',
            type: 'drop_down',
            type_config: {
              options: [
                { orderindex: 0, name: 'Reels' },
                { orderindex: 1, name: 'Carrossel' },
                { orderindex: 2, name: 'Stories' },
                { orderindex: 3, name: 'Feed estático' },
              ],
            },
          },
        ],
      });
    }

    // GHL: upload de mídia
    if (urlStr.includes('/medias/upload-file')) {
      return fakeResponse(200, { url: 'https://cdn.ghl.com/media/test.jpg', fileId: 'FID001' });
    }

    // GHL: createPost (resposta REAL — results.post._id, não post._id)
    if (urlStr.includes('/social-media-posting/') && urlStr.includes('/posts') && opts?.method === 'POST') {
      return fakeResponse(201, {
        success: true,
        statusCode: 201,
        message: 'Post created successfully',
        results: { post: { _id: 'PID123', status: 'scheduled' } },
        traceId: 'trace-001',
      });
    }

    // ClickUp: updateTask (status → agendado)
    if (urlStr.includes('/task/TASK001') && opts?.method === 'PUT') {
      return fakeResponse(200, { id: 'TASK001', status: { status: 'agendado' } });
    }

    // ClickUp: setCustomField (CF_GHL_POST_ID)
    if (urlStr.includes(`/task/TASK001/field/${CF_GHL_POST_ID}`) && opts?.method === 'POST') {
      return fakeResponse(200, {});
    }

    // downloadAndExtract: download do zip do MinIO
    // O pipeline chama fetch diretamente para baixar o zip
    if (urlStr.includes('minio.example.com')) {
      // Zip mínimo válido com 1 arquivo (1.jpg)
      const { createValidZipBuffer } = await import('./helpers/zip-fixture.js').catch(() => ({ createValidZipBuffer: null }));
      if (createValidZipBuffer) {
        return fakeResponse(200, {}, {});  // será sobrescrito com arrayBuffer
      }
      // Retorno mínimo — simulação do download do zip
      const minZipBuffer = Buffer.from([
        0x50, 0x4B, 0x05, 0x06, // End of central directory signature
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00,
      ]);
      return {
        status: 200,
        ok: true,
        headers: { get: () => null },
        async arrayBuffer() { return minZipBuffer.buffer; },
        async json() { return {}; },
        async text() { return ''; },
      };
    }

    // Fallback
    return fakeResponse(404, { err: `Unexpected URL: ${urlStr}` });
  });

  // Import dinâmico do pipeline (ainda não existe → vai lançar MODULE_NOT_FOUND em RED)
  let runSchedulerBatch;
  try {
    const mod = await import('../src/scheduler/pipeline.js');
    runSchedulerBatch = mod.runSchedulerBatch;
  } catch (err) {
    // RED phase: módulo não existe ainda — teste confirma ausência e falha intencionalmente
    fetchMock.mock.restore();
    assert.fail(`[RED] src/scheduler/pipeline.js não existe ainda — isso é esperado na fase RED. Erro: ${err.message}`);
    return;
  }

  // Executar batch
  await runSchedulerBatch();

  // Verificar que updateTask foi chamado com status 'agendado'
  const updateCall = calls.find(
    (c) => c.url.includes('/task/TASK001') && c.method === 'PUT',
  );
  assert.ok(updateCall, 'clickup.updateTask deve ter sido chamado para a task TASK001');
  const updateBody = typeof updateCall.body === 'string' ? JSON.parse(updateCall.body) : (updateCall.body ?? {});
  assert.strictEqual(updateBody.status, 'agendado', 'status deve ser "agendado"');

  // Verificar que setCustomField foi chamado com CF_GHL_POST_ID = 'PID123'
  const setFieldCall = calls.find(
    (c) => c.url.includes(`/task/TASK001/field/${CF_GHL_POST_ID}`) && c.method === 'POST',
  );
  assert.ok(setFieldCall, 'clickup.setCustomField deve ter sido chamado com CF_GHL_POST_ID');
  const fieldBody = typeof setFieldCall.body === 'string' ? JSON.parse(setFieldCall.body) : (setFieldCall.body ?? {});
  assert.strictEqual(fieldBody.value, 'PID123', 'GHL Post ID gravado deve ser PID123 (de results.post._id)');

  // Verificar ordem: createPost antes de updateTask (Pitfall anti-pattern)
  const createPostCall = calls.find((c) => c.url.includes('/posts') && c.method === 'POST');
  assert.ok(createPostCall, 'ghl.createPost deve ter sido chamado');
  const createPostIdx = calls.indexOf(createPostCall);
  const updateIdx = calls.indexOf(updateCall);
  assert.ok(createPostIdx < updateIdx, 'createPost deve ocorrer ANTES de updateTask (write-back de sucesso)');

  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// TEST 3: Idempotência (RED — vai falhar até Task 3 criar pipeline.js)
// ---------------------------------------------------------------------------

test('runSchedulerBatch: task com CF_GHL_POST_ID preenchido é PULADA (idempotência SCH-06)', async (t) => {
  let uploadCalled = false;
  let createPostCalled = false;

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);

    // getListTasks — task com GHL Post ID JÁ preenchido
    if (urlStr.includes('/list/') && urlStr.includes('/task?') && (opts?.method ?? 'GET') === 'GET') {
      const u = new URL(urlStr);
      const page = Number(u.searchParams.get('page') ?? '0');
      if (page === 0) {
        return fakeResponse(200, {
          tasks: [makeEligibleTask({
            custom_fields: [
              { id: CF_GHL_POST_ID,     value: 'EXISTING_POST_ID' }, // já preenchido!
              { id: CF_LEGENDA,         value: 'Legenda' },
              { id: CF_LINK_DO_POST,    value: 'https://minio.example.com/media.zip' },
              { id: CF_FORMATO,         value: FORMATO_FEED_ESTATICO_ORDERINDEX },
              { id: CF_DATA_PUBLICACAO, value: FUTURE_EPOCH_MS },
            ],
          })],
        });
      }
      return fakeResponse(200, { tasks: [] });
    }

    // getListFields
    if (urlStr.includes('/field') && (opts?.method ?? 'GET') === 'GET') {
      return fakeResponse(200, {
        fields: [{
          id: CF_FORMATO,
          name: 'Formato',
          type: 'drop_down',
          type_config: { options: [
            { orderindex: 0, name: 'Reels' },
            { orderindex: 1, name: 'Carrossel' },
            { orderindex: 2, name: 'Stories' },
            { orderindex: 3, name: 'Feed estático' },
          ]},
        }],
      });
    }

    // Upload — NÃO deve ser chamado
    if (urlStr.includes('/medias/upload-file')) {
      uploadCalled = true;
      return fakeResponse(200, { url: 'https://cdn.ghl.com/test.jpg', fileId: 'X' });
    }

    // createPost — NÃO deve ser chamado
    if (urlStr.includes('/posts') && opts?.method === 'POST') {
      createPostCalled = true;
      return fakeResponse(201, { results: { post: { _id: 'NEWID' } } });
    }

    return fakeResponse(404, {});
  });

  let runSchedulerBatch;
  try {
    const mod = await import('../src/scheduler/pipeline.js');
    runSchedulerBatch = mod.runSchedulerBatch;
  } catch (err) {
    fetchMock.mock.restore();
    assert.fail(`[RED] src/scheduler/pipeline.js não existe ainda — isso é esperado na fase RED. Erro: ${err.message}`);
    return;
  }

  await runSchedulerBatch();

  assert.strictEqual(uploadCalled,     false, 'ghl.uploadMedia NÃO deve ser chamado para task idempotente');
  assert.strictEqual(createPostCalled, false, 'ghl.createPost NÃO deve ser chamado para task idempotente');

  fetchMock.mock.restore();
});
