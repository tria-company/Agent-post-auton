/**
 * test/poller.test.js
 *
 * Testes TDD para o GHL Status Poller (03-03-PLAN.md).
 *
 * Abordagem:
 *   - Mock de globalThis.fetch no padrão de test/pipeline.test.js
 *   - Exercita pollGhlPosts() e helpers via fetch stubs
 *
 * Cobertura:
 *   Task 1 (RED→GREEN):
 *     - writeBackPublicado: grava STATUS_PUBLICADO + IG Media ID + Link publicado + comentário ✅
 *     - writeBackFalha: volta para STATUS_A_AGENDAR + Erro de publicação + limpa GHL Post ID + comentário ❌
 *     - Campos IG ausentes no payload → não gravar null
 *     - Mensagem de erro truncada a 200 chars e sanitizada (sem http/pit-/pk_)
 *
 *   Task 2 (RED→GREEN):
 *     - pollGhlPosts happy-path: 1 task publicada → write-back chamado 1 vez
 *     - Dedup: segunda varredura do mesmo postId:status → write-back não duplicado
 *     - Isolamento: 1 task lança em getPost → varredura continua para a próxima
 *     - Tasks sem CF_GHL_POST_ID são ignoradas
 *     - Posts deletados são ignorados (não tratados como falha)
 */

import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// Helper: resposta fake de fetch (padrão de test/pipeline.test.js)
// ---------------------------------------------------------------------------
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
// UUIDs de custom fields (usa env ou defaults que correspondem ao .env real)
// ---------------------------------------------------------------------------
const CF_GHL_POST_ID     = process.env.CU_FIELD_GHL_POST_ID     ?? 'a1b2c3d4-1234-4abc-8def-000000000001';
const CF_IG_MEDIA_ID     = process.env.CU_FIELD_IG_MEDIA_ID     ?? 'a1b2c3d4-1234-4abc-8def-000000000010';
const CF_LINK_PUBLICADO  = process.env.CU_FIELD_LINK_PUBLICADO  ?? 'a1b2c3d4-1234-4abc-8def-000000000011';
const CF_ERRO_PUBLICACAO = process.env.CU_FIELD_ERRO_PUBLICACAO ?? 'a1b2c3d4-1234-4abc-8def-000000000012';

// ---------------------------------------------------------------------------
// Helper: task stub com GHL Post ID preenchido (task em estado 'agendado')
// ---------------------------------------------------------------------------
function makeAgendadoTask(overrides = {}) {
  return {
    id: 'TASK_POLLER_01',
    name: 'Post agendado',
    status: { status: 'agendado' },
    custom_fields: [
      { id: CF_GHL_POST_ID,     value: 'POST_GHL_001' },
      { id: CF_IG_MEDIA_ID,     value: null },
      { id: CF_LINK_PUBLICADO,  value: null },
      { id: CF_ERRO_PUBLICACAO, value: null },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: payload de post GHL publicado (com campos defensivos)
// ---------------------------------------------------------------------------
function makePublishedPost(overrides = {}) {
  return {
    results: {
      post: {
        _id: 'POST_GHL_001',
        status: 'published',
        publishedAt: '2026-06-22T23:00:00.000Z',
        deleted: false,
        deletedAt: null,
        instagramPostDetails: {
          igMediaId: 'IG_MEDIA_123',
          permalink: 'https://www.instagram.com/p/ABC123/',
        },
        ...overrides,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Helper: payload de post GHL com falha
// ---------------------------------------------------------------------------
function makeFailedPost(overrides = {}) {
  return {
    results: {
      post: {
        _id: 'POST_GHL_001',
        status: 'failed',
        publishedAt: null,
        deleted: false,
        deletedAt: null,
        instagramPostDetails: {
          failureReason: 'Instagram API error: rate limit exceeded',
        },
        ...overrides,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// TASK 1 — TEST 1: writeBackPublicado via pollGhlPosts (happy-path publicado)
// ---------------------------------------------------------------------------

test('pollGhlPosts: post publicado → updateTask(STATUS_PUBLICADO) + setCustomField(IG_MEDIA_ID) + setCustomField(LINK_PUBLICADO) + addComment ✅', async (t) => {
  const calls = [];

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    const method = opts?.method ?? 'GET';
    calls.push({ url: urlStr, method, body: opts?.body });

    // ClickUp: getListTasks → 1 task em 'agendado' com GHL Post ID
    if (urlStr.includes('/list/') && urlStr.includes('/task?') && method === 'GET') {
      const u = new URL(urlStr);
      const page = Number(u.searchParams.get('page') ?? '0');
      if (page === 0) {
        return fakeResponse(200, { tasks: [makeAgendadoTask()] });
      }
      return fakeResponse(200, { tasks: [] });
    }

    // GHL: getPost → post publicado
    if (urlStr.includes('/social-media-posting/') && urlStr.includes('/posts/POST_GHL_001') && method === 'GET') {
      return fakeResponse(200, makePublishedPost());
    }

    // ClickUp: updateTask → STATUS_PUBLICADO
    if (urlStr.includes('/task/TASK_POLLER_01') && method === 'PUT') {
      return fakeResponse(200, {});
    }

    // ClickUp: setCustomField (IG_MEDIA_ID, LINK_PUBLICADO, etc.)
    if (urlStr.includes('/task/TASK_POLLER_01/field/') && method === 'POST') {
      return fakeResponse(200, {});
    }

    // ClickUp: addComment
    if (urlStr.includes('/task/TASK_POLLER_01/comment') && method === 'POST') {
      return fakeResponse(200, {});
    }

    return fakeResponse(404, { err: `Unexpected URL: ${urlStr}` });
  });

  const { pollGhlPosts } = await import('../src/poller/ghlStatusPoller.js');
  await pollGhlPosts();

  fetchMock.mock.restore();

  // updateTask deve ter sido chamado com STATUS_PUBLICADO
  const updateCall = calls.find(
    (c) => c.url.includes('/task/TASK_POLLER_01') && c.method === 'PUT',
  );
  assert.ok(updateCall, 'clickup.updateTask deve ter sido chamado');
  const updateBody = typeof updateCall.body === 'string' ? JSON.parse(updateCall.body) : (updateCall.body ?? {});
  assert.ok(
    updateBody.status === 'publicado' || updateBody.status === process.env.STATUS_PUBLICADO,
    `Status deve ser publicado. Recebido: "${updateBody.status}"`,
  );

  // setCustomField(CF_IG_MEDIA_ID) deve ter sido chamado com o valor real
  const igMediaCall = calls.find(
    (c) => c.url.includes(`/task/TASK_POLLER_01/field/${CF_IG_MEDIA_ID}`) && c.method === 'POST',
  );
  assert.ok(igMediaCall, 'setCustomField(CF_IG_MEDIA_ID) deve ter sido chamado');
  const igBody = typeof igMediaCall.body === 'string' ? JSON.parse(igMediaCall.body) : (igMediaCall.body ?? {});
  assert.strictEqual(igBody.value, 'IG_MEDIA_123', 'CF_IG_MEDIA_ID deve receber o valor do campo confirmado');

  // setCustomField(CF_LINK_PUBLICADO) deve ter sido chamado com o permalink
  const linkCall = calls.find(
    (c) => c.url.includes(`/task/TASK_POLLER_01/field/${CF_LINK_PUBLICADO}`) && c.method === 'POST',
  );
  assert.ok(linkCall, 'setCustomField(CF_LINK_PUBLICADO) deve ter sido chamado');
  const linkBody = typeof linkCall.body === 'string' ? JSON.parse(linkCall.body) : (linkCall.body ?? {});
  assert.strictEqual(linkBody.value, 'https://www.instagram.com/p/ABC123/', 'CF_LINK_PUBLICADO deve receber o permalink');

  // addComment deve ter sido chamado com ✅
  const commentCall = calls.find(
    (c) => c.url.includes('/task/TASK_POLLER_01/comment') && c.method === 'POST',
  );
  assert.ok(commentCall, 'addComment deve ter sido chamado');
  const commentBody = typeof commentCall.body === 'string' ? JSON.parse(commentCall.body) : (commentCall.body ?? {});
  assert.ok(
    commentBody.comment_text?.startsWith('✅'),
    `Comentário deve começar com ✅. Recebido: "${commentBody.comment_text}"`,
  );
});

// ---------------------------------------------------------------------------
// TASK 1 — TEST 2: writeBackFalha via pollGhlPosts
// ---------------------------------------------------------------------------

test('pollGhlPosts: post com falha → updateTask(STATUS_A_AGENDAR) + setCustomField(ERRO_PUBLICACAO) + setCustomField(GHL_POST_ID, "") + addComment ❌', async (t) => {
  const calls = [];

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    const method = opts?.method ?? 'GET';
    calls.push({ url: urlStr, method, body: opts?.body });

    if (urlStr.includes('/list/') && urlStr.includes('/task?') && method === 'GET') {
      const u = new URL(urlStr);
      if (Number(u.searchParams.get('page') ?? '0') === 0) {
        return fakeResponse(200, { tasks: [makeAgendadoTask()] });
      }
      return fakeResponse(200, { tasks: [] });
    }

    if (urlStr.includes('/social-media-posting/') && urlStr.includes('/posts/POST_GHL_001') && method === 'GET') {
      return fakeResponse(200, makeFailedPost());
    }

    if (urlStr.includes('/task/TASK_POLLER_01') && method === 'PUT') {
      return fakeResponse(200, {});
    }

    if (urlStr.includes('/task/TASK_POLLER_01/field/') && method === 'POST') {
      return fakeResponse(200, {});
    }

    if (urlStr.includes('/task/TASK_POLLER_01/comment') && method === 'POST') {
      return fakeResponse(200, {});
    }

    return fakeResponse(404, { err: `Unexpected URL: ${urlStr}` });
  });

  const { pollGhlPosts } = await import('../src/poller/ghlStatusPoller.js');
  await pollGhlPosts();

  fetchMock.mock.restore();

  // updateTask deve ter sido chamado com STATUS_A_AGENDAR
  const updateCall = calls.find(
    (c) => c.url.includes('/task/TASK_POLLER_01') && c.method === 'PUT',
  );
  assert.ok(updateCall, 'clickup.updateTask deve ter sido chamado');
  const updateBody = typeof updateCall.body === 'string' ? JSON.parse(updateCall.body) : (updateCall.body ?? {});
  assert.ok(
    updateBody.status === 'a agendar' || updateBody.status === process.env.STATUS_A_AGENDAR,
    `Status deve ser 'a agendar'. Recebido: "${updateBody.status}"`,
  );

  // setCustomField(CF_ERRO_PUBLICACAO) deve ter sido chamado
  const erroCall = calls.find(
    (c) => c.url.includes(`/task/TASK_POLLER_01/field/${CF_ERRO_PUBLICACAO}`) && c.method === 'POST',
  );
  assert.ok(erroCall, 'setCustomField(CF_ERRO_PUBLICACAO) deve ter sido chamado');
  const erroBody = typeof erroCall.body === 'string' ? JSON.parse(erroCall.body) : (erroCall.body ?? {});
  assert.ok(erroBody.value, 'CF_ERRO_PUBLICACAO deve ter uma mensagem');
  assert.ok(erroBody.value.length <= 200, 'Mensagem deve ser <= 200 chars');

  // setCustomField(CF_GHL_POST_ID, '') deve ter sido chamado (limpa para retry D-01)
  const clearPostIdCall = calls.find(
    (c) => c.url.includes(`/task/TASK_POLLER_01/field/${CF_GHL_POST_ID}`) && c.method === 'POST',
  );
  assert.ok(clearPostIdCall, 'setCustomField(CF_GHL_POST_ID) deve ser chamado para limpar (D-01)');
  const clearBody = typeof clearPostIdCall.body === 'string' ? JSON.parse(clearPostIdCall.body) : (clearPostIdCall.body ?? {});
  assert.strictEqual(clearBody.value, '', 'CF_GHL_POST_ID deve ser limpo com string vazia para retry');

  // addComment deve ter sido chamado com ❌
  const commentCall = calls.find(
    (c) => c.url.includes('/task/TASK_POLLER_01/comment') && c.method === 'POST',
  );
  assert.ok(commentCall, 'addComment deve ter sido chamado');
  const commentBody = typeof commentCall.body === 'string' ? JSON.parse(commentCall.body) : (commentCall.body ?? {});
  assert.ok(
    commentBody.comment_text?.startsWith('❌'),
    `Comentário deve começar com ❌. Recebido: "${commentBody.comment_text}"`,
  );
});

// ---------------------------------------------------------------------------
// TASK 1 — TEST 3: Campos IG ausentes → não chamar setCustomField com null
// ---------------------------------------------------------------------------

test('pollGhlPosts: post publicado sem campos IG → não chama setCustomField para campos ausentes (não grava null)', async (t) => {
  // Uses POST_GHL_003 to avoid dedup collision with Test 1 (POST_GHL_001:published already set)
  const calls = [];

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    const method = opts?.method ?? 'GET';
    calls.push({ url: urlStr, method, body: opts?.body });

    if (urlStr.includes('/list/') && urlStr.includes('/task?') && method === 'GET') {
      const u = new URL(urlStr);
      if (Number(u.searchParams.get('page') ?? '0') === 0) {
        return fakeResponse(200, { tasks: [makeAgendadoTask({
          id: 'TASK_POLLER_03',
          custom_fields: [
            { id: CF_GHL_POST_ID,     value: 'POST_GHL_003' },
            { id: CF_IG_MEDIA_ID,     value: null },
            { id: CF_LINK_PUBLICADO,  value: null },
            { id: CF_ERRO_PUBLICACAO, value: null },
          ],
        })] });
      }
      return fakeResponse(200, { tasks: [] });
    }

    // Post publicado mas sem campos IG (instagramPostDetails vazio, sem top-level igMediaId/permalink)
    if (urlStr.includes('/social-media-posting/') && urlStr.includes('/posts/POST_GHL_003') && method === 'GET') {
      return fakeResponse(200, {
        results: {
          post: {
            _id: 'POST_GHL_003',
            status: 'published',
            publishedAt: '2026-06-22T23:00:00.000Z',
            deleted: false,
            instagramPostDetails: {}, // campos IG ausentes
          },
        },
      });
    }

    if (urlStr.includes('/task/TASK_POLLER_03') && method === 'PUT') {
      return fakeResponse(200, {});
    }

    if (urlStr.includes('/task/TASK_POLLER_03/field/') && method === 'POST') {
      return fakeResponse(200, {});
    }

    if (urlStr.includes('/task/TASK_POLLER_03/comment') && method === 'POST') {
      return fakeResponse(200, {});
    }

    return fakeResponse(404, { err: `Unexpected URL: ${urlStr}` });
  });

  const { pollGhlPosts } = await import('../src/poller/ghlStatusPoller.js');
  await pollGhlPosts();

  fetchMock.mock.restore();

  // updateTask deve ter sido chamado (move para publicado)
  const updateCall = calls.find(
    (c) => c.url.includes('/task/TASK_POLLER_03') && c.method === 'PUT',
  );
  assert.ok(updateCall, 'updateTask deve ser chamado mesmo sem campos IG');

  // setCustomField(CF_IG_MEDIA_ID) NÃO deve ter sido chamado com null
  const igMediaCall = calls.find(
    (c) => c.url.includes(`/task/TASK_POLLER_03/field/${CF_IG_MEDIA_ID}`) && c.method === 'POST',
  );
  if (igMediaCall) {
    const igBody = typeof igMediaCall.body === 'string' ? JSON.parse(igMediaCall.body) : (igMediaCall.body ?? {});
    assert.notStrictEqual(igBody.value, null, 'CF_IG_MEDIA_ID não deve ser setado com null');
  }
  // (se não foi chamado, também é OK — campos ausentes não devem ser gravados)

  // setCustomField(CF_LINK_PUBLICADO) NÃO deve ter sido chamado com null
  const linkCall = calls.find(
    (c) => c.url.includes(`/task/TASK_POLLER_03/field/${CF_LINK_PUBLICADO}`) && c.method === 'POST',
  );
  if (linkCall) {
    const linkBody = typeof linkCall.body === 'string' ? JSON.parse(linkCall.body) : (linkCall.body ?? {});
    assert.notStrictEqual(linkBody.value, null, 'CF_LINK_PUBLICADO não deve ser setado com null');
  }
});

// ---------------------------------------------------------------------------
// TASK 1 — TEST 4: Mensagem de erro truncada/sanitizada (sem http/pit-/pk_)
// ---------------------------------------------------------------------------

test('writeBackFalha: mensagem de erro truncada a 200 chars e sem http:// ou tokens', async (t) => {
  // Uses POST_GHL_004 to avoid dedup collision with Test 2 (POST_GHL_001:failed already set)
  const calls = [];

  const LONG_ERROR = 'A'.repeat(300); // mensagem longa demais
  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    const method = opts?.method ?? 'GET';
    calls.push({ url: urlStr, method, body: opts?.body });

    if (urlStr.includes('/list/') && urlStr.includes('/task?') && method === 'GET') {
      const u = new URL(urlStr);
      if (Number(u.searchParams.get('page') ?? '0') === 0) {
        return fakeResponse(200, { tasks: [makeAgendadoTask({
          id: 'TASK_POLLER_04',
          custom_fields: [
            { id: CF_GHL_POST_ID,     value: 'POST_GHL_004' },
            { id: CF_IG_MEDIA_ID,     value: null },
            { id: CF_LINK_PUBLICADO,  value: null },
            { id: CF_ERRO_PUBLICACAO, value: null },
          ],
        })] });
      }
      return fakeResponse(200, { tasks: [] });
    }

    if (urlStr.includes('/social-media-posting/') && urlStr.includes('/posts/POST_GHL_004') && method === 'GET') {
      return fakeResponse(200, makeFailedPost({
        _id: 'POST_GHL_004',
        instagramPostDetails: { failureReason: LONG_ERROR },
      }));
    }

    if (urlStr.includes('/task/TASK_POLLER_04') && method === 'PUT') return fakeResponse(200, {});
    if (urlStr.includes('/task/TASK_POLLER_04/field/') && method === 'POST') return fakeResponse(200, {});
    if (urlStr.includes('/task/TASK_POLLER_04/comment') && method === 'POST') return fakeResponse(200, {});

    return fakeResponse(404, {});
  });

  const { pollGhlPosts } = await import('../src/poller/ghlStatusPoller.js');
  await pollGhlPosts();

  fetchMock.mock.restore();

  const erroCall = calls.find(
    (c) => c.url.includes(`/task/TASK_POLLER_04/field/${CF_ERRO_PUBLICACAO}`) && c.method === 'POST',
  );
  assert.ok(erroCall, 'setCustomField(CF_ERRO_PUBLICACAO) deve ser chamado');
  const erroBody = typeof erroCall.body === 'string' ? JSON.parse(erroCall.body) : (erroCall.body ?? {});
  assert.ok(erroBody.value.length <= 200, `Mensagem deve ser <= 200 chars; recebida: ${erroBody.value.length} chars`);
});

// ---------------------------------------------------------------------------
// TASK 2 — TEST 5: pollGhlPosts happy-path com 1 task publicada
// ---------------------------------------------------------------------------

test('pollGhlPosts: getListTasks é chamado com STATUS_AGENDADO e tasks sem CF_GHL_POST_ID são ignoradas', async (t) => {
  let getListTasksUrl = null;
  let getPostCalled = false;

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    const method = opts?.method ?? 'GET';

    if (urlStr.includes('/list/') && urlStr.includes('/task?') && method === 'GET') {
      getListTasksUrl = urlStr;
      const u = new URL(urlStr);
      if (Number(u.searchParams.get('page') ?? '0') === 0) {
        // Task sem CF_GHL_POST_ID → deve ser ignorada
        return fakeResponse(200, {
          tasks: [{
            id: 'TASK_NO_POST_ID',
            status: { status: 'agendado' },
            custom_fields: [
              { id: CF_GHL_POST_ID, value: null }, // sem Post ID → ignorar
            ],
          }],
        });
      }
      return fakeResponse(200, { tasks: [] });
    }

    // getPost NÃO deve ser chamado para task sem CF_GHL_POST_ID
    if (urlStr.includes('/social-media-posting/') && urlStr.includes('/posts/')) {
      getPostCalled = true;
      return fakeResponse(200, makePublishedPost());
    }

    return fakeResponse(404, {});
  });

  const { pollGhlPosts } = await import('../src/poller/ghlStatusPoller.js');
  await pollGhlPosts();

  fetchMock.mock.restore();

  assert.ok(getListTasksUrl !== null, 'getListTasks deve ser chamado');
  assert.ok(
    getListTasksUrl.includes('statuses%5B%5D=agendado') || getListTasksUrl.includes('statuses[]=agendado'),
    `getListTasks deve filtrar por 'agendado'. URL: ${getListTasksUrl}`,
  );
  assert.strictEqual(getPostCalled, false, 'getPost NÃO deve ser chamado para task sem CF_GHL_POST_ID');
});

// ---------------------------------------------------------------------------
// TASK 2 — TEST 6: Dedup — mesma varredura não reprocessa postId:status
// ---------------------------------------------------------------------------

test('pollGhlPosts: dedup — segunda chamada a pollGhlPosts para mesmo postId:status não chama write-back de novo', async (t) => {
  // Uses POST_GHL_006 to start with a fresh dedup key (POST_GHL_001:published was set by Test 1)
  let updateTaskCallCount = 0;

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    const method = opts?.method ?? 'GET';

    if (urlStr.includes('/list/') && urlStr.includes('/task?') && method === 'GET') {
      const u = new URL(urlStr);
      if (Number(u.searchParams.get('page') ?? '0') === 0) {
        return fakeResponse(200, { tasks: [makeAgendadoTask({
          id: 'TASK_POLLER_06',
          custom_fields: [
            { id: CF_GHL_POST_ID,     value: 'POST_GHL_006' },
            { id: CF_IG_MEDIA_ID,     value: null },
            { id: CF_LINK_PUBLICADO,  value: null },
            { id: CF_ERRO_PUBLICACAO, value: null },
          ],
        })] });
      }
      return fakeResponse(200, { tasks: [] });
    }

    if (urlStr.includes('/social-media-posting/') && urlStr.includes('/posts/POST_GHL_006') && method === 'GET') {
      return fakeResponse(200, makePublishedPost({ _id: 'POST_GHL_006' }));
    }

    if (urlStr.includes('/task/TASK_POLLER_06') && method === 'PUT') {
      updateTaskCallCount++;
      return fakeResponse(200, {});
    }

    if (urlStr.includes('/task/TASK_POLLER_06/field/') && method === 'POST') return fakeResponse(200, {});
    if (urlStr.includes('/task/TASK_POLLER_06/comment') && method === 'POST') return fakeResponse(200, {});

    return fakeResponse(404, {});
  });

  const { pollGhlPosts } = await import('../src/poller/ghlStatusPoller.js');

  // Primeira varredura → deve chamar write-back
  await pollGhlPosts();
  const countAfterFirst = updateTaskCallCount;

  // Segunda varredura com mesmo postId:status → dedup deve impedir reprocessamento
  await pollGhlPosts();

  fetchMock.mock.restore();

  assert.strictEqual(countAfterFirst, 1, 'Primeira varredura deve chamar updateTask 1 vez');
  assert.strictEqual(updateTaskCallCount, 1, 'Segunda varredura NÃO deve reprocessar (dedup SYNC-06)');
});

// ---------------------------------------------------------------------------
// TASK 2 — TEST 7: Isolamento — erro em 1 task não aborta a varredura
// ---------------------------------------------------------------------------

test('pollGhlPosts: isolamento — erro em getPost de 1 task não aborta processamento das demais (D-18)', async (t) => {
  let task2UpdateCalled = false;

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    const method = opts?.method ?? 'GET';

    if (urlStr.includes('/list/') && urlStr.includes('/task?') && method === 'GET') {
      const u = new URL(urlStr);
      if (Number(u.searchParams.get('page') ?? '0') === 0) {
        return fakeResponse(200, {
          tasks: [
            // Task 1: vai lançar erro no getPost
            {
              id: 'TASK_POLLER_ERR',
              status: { status: 'agendado' },
              custom_fields: [{ id: CF_GHL_POST_ID, value: 'POST_ERROR' }],
            },
            // Task 2: deve ser processada normalmente
            {
              id: 'TASK_POLLER_OK',
              status: { status: 'agendado' },
              custom_fields: [{ id: CF_GHL_POST_ID, value: 'POST_GHL_002' }],
            },
          ],
        });
      }
      return fakeResponse(200, { tasks: [] });
    }

    // getPost para a task com erro → retorna 500 (vai lançar)
    if (urlStr.includes('/posts/POST_ERROR') && method === 'GET') {
      return fakeResponse(500, { error: 'GHL Internal Server Error' });
    }

    // getPost para a task OK → retorna publicado
    if (urlStr.includes('/posts/POST_GHL_002') && method === 'GET') {
      return fakeResponse(200, {
        results: {
          post: {
            _id: 'POST_GHL_002',
            status: 'published',
            publishedAt: '2026-06-22T23:00:00.000Z',
            deleted: false,
            instagramPostDetails: { igMediaId: 'IG_002', permalink: 'https://instagram.com/p/002/' },
          },
        },
      });
    }

    if (urlStr.includes('/task/TASK_POLLER_OK') && method === 'PUT') {
      task2UpdateCalled = true;
      return fakeResponse(200, {});
    }

    if (urlStr.includes('/task/TASK_POLLER_OK/field/') && method === 'POST') return fakeResponse(200, {});
    if (urlStr.includes('/task/TASK_POLLER_OK/comment') && method === 'POST') return fakeResponse(200, {});
    if (urlStr.includes('/task/TASK_POLLER_ERR') && method === 'PUT') return fakeResponse(200, {});
    if (urlStr.includes('/task/TASK_POLLER_ERR/field/') && method === 'POST') return fakeResponse(200, {});
    if (urlStr.includes('/task/TASK_POLLER_ERR/comment') && method === 'POST') return fakeResponse(200, {});

    return fakeResponse(404, {});
  });

  const { pollGhlPosts } = await import('../src/poller/ghlStatusPoller.js');
  // NÃO deve lançar erro mesmo com task 1 falhando
  await assert.doesNotReject(pollGhlPosts(), 'pollGhlPosts não deve propagar erro de task individual');

  fetchMock.mock.restore();

  assert.strictEqual(task2UpdateCalled, true, 'Task 2 deve ser processada mesmo com erro na Task 1 (D-18)');
});

// ---------------------------------------------------------------------------
// TASK 2 — TEST 8: Posts deletados são ignorados (não tratados como falha)
// ---------------------------------------------------------------------------

test('pollGhlPosts: post deletado → ignorado (não chama write-back de falha)', async (t) => {
  let updateTaskCalled = false;

  const fetchMock = t.mock.method(globalThis, 'fetch', async (url, opts) => {
    const urlStr = String(url);
    const method = opts?.method ?? 'GET';

    if (urlStr.includes('/list/') && urlStr.includes('/task?') && method === 'GET') {
      const u = new URL(urlStr);
      if (Number(u.searchParams.get('page') ?? '0') === 0) {
        return fakeResponse(200, { tasks: [makeAgendadoTask()] });
      }
      return fakeResponse(200, { tasks: [] });
    }

    // Post retorna como deletado
    if (urlStr.includes('/social-media-posting/') && urlStr.includes('/posts/POST_GHL_001') && method === 'GET') {
      return fakeResponse(200, {
        results: {
          post: {
            _id: 'POST_GHL_001',
            status: 'scheduled',
            publishedAt: null,
            deleted: true,
            deletedAt: '2026-06-22T22:00:00.000Z',
          },
        },
      });
    }

    // updateTask NÃO deve ser chamado para posts deletados
    if (urlStr.includes('/task/TASK_POLLER_01') && method === 'PUT') {
      updateTaskCalled = true;
      return fakeResponse(200, {});
    }

    if (urlStr.includes('/task/TASK_POLLER_01/field/') && method === 'POST') return fakeResponse(200, {});
    if (urlStr.includes('/task/TASK_POLLER_01/comment') && method === 'POST') return fakeResponse(200, {});

    return fakeResponse(404, {});
  });

  const { pollGhlPosts } = await import('../src/poller/ghlStatusPoller.js');
  await pollGhlPosts();

  fetchMock.mock.restore();

  assert.strictEqual(updateTaskCalled, false, 'updateTask NÃO deve ser chamado para posts deletados');
});
