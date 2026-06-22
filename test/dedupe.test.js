/**
 * test/dedupe.test.js
 *
 * RED até Plano 02 — test-first contract
 *
 * Fixa o contrato do DedupeStore in-memory com TTL (SYNC-06, TRIG-04).
 * O módulo alvo `src/server/dedupe.js` ainda não existe — este arquivo
 * ficará RED até o Plano 03-02 implementar o módulo.
 *
 * Referência: RESEARCH.md RQ4 (HIGH confidence — raciocínio de engenharia)
 *   - has(key): false para chave nova, true após set(key), false após expiração
 *   - set(key): registra com TTL configurável
 *   - Chave de dedup ClickUp: `${webhook_id}:${history_items[0].id}`
 *   - Chave de dedup GHL polling: `${postId}:${status}`
 */

import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Módulo alvo (ainda não existe — RED até Plano 02)
import { DedupeStore } from '../src/server/dedupe.js';

// ---------------------------------------------------------------------------
// Test 1: has() false para chave nova; true após set()
// ---------------------------------------------------------------------------

test('DedupeStore: has() false para chave nova, true apos set()', () => {
  const store = new DedupeStore(10_000); // 10 segundos TTL
  const key = 'webhook-id-001:history-item-001';

  assert.strictEqual(store.has(key), false, 'Chave nova deve retornar false');
  store.set(key);
  assert.strictEqual(store.has(key), true, 'Chave após set() deve retornar true');
});

// ---------------------------------------------------------------------------
// Test 2: has() retorna false após expiração do TTL
// ---------------------------------------------------------------------------

test('DedupeStore: expira apos TTL', async () => {
  const store = new DedupeStore(10); // 10ms TTL (intencionalmente curto para teste)
  const key = 'webhook-id-002:history-item-002';

  store.set(key);
  assert.strictEqual(store.has(key), true, 'Chave deve estar presente imediatamente após set()');

  // Aguardar TTL expirar
  await new Promise((r) => setTimeout(r, 25));

  assert.strictEqual(store.has(key), false, 'Chave deve expirar após TTL');
});

// ---------------------------------------------------------------------------
// Test 3: Múltiplas chaves independentes não interferem
// ---------------------------------------------------------------------------

test('DedupeStore: chaves independentes nao interferem', () => {
  const store = new DedupeStore(10_000);

  store.set('k1');
  assert.strictEqual(store.has('k1'), true);
  assert.strictEqual(store.has('k2'), false);
  assert.strictEqual(store.has('k3'), false);

  store.set('k3');
  assert.strictEqual(store.has('k1'), true);
  assert.strictEqual(store.has('k2'), false);
  assert.strictEqual(store.has('k3'), true);
});
