/**
 * test/verifySignature.test.js
 *
 * RED até Plano 02 — test-first contract
 *
 * Fixa o contrato de HMAC-SHA256 para a verificação de assinatura do webhook
 * ClickUp (TRIG-02). O módulo alvo `src/server/verifySignature.js` ainda não
 * existe — este arquivo ficará RED até o Plano 03-02 implementar o módulo.
 *
 * Referência: RESEARCH.md RQ2 (HIGH confidence — developer.clickup.com/docs/webhooksignature)
 *   - Header: X-Signature
 *   - Algoritmo: HMAC-SHA256
 *   - Input: raw body (Buffer) — NUNCA JSON.stringify(JSON.parse(...))
 *   - Output: hex digest
 *   - Comparação: crypto.timingSafeEqual (previne timing attack)
 */

import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

// Módulo alvo (ainda não existe — RED até Plano 02)
import { verifyClickUpSignature } from '../src/server/verifySignature.js';

// ---------------------------------------------------------------------------
// Test 1: Assinatura HMAC-SHA256 válida retorna true
// ---------------------------------------------------------------------------

test('verifyClickUpSignature: assinatura valida retorna true', () => {
  const secret = 'test-secret-webhook';
  const body = Buffer.from('{"event":"taskStatusUpdated","task_id":"abc123"}');

  // Gera assinatura válida inline com o mesmo algoritmo que o ClickUp usa
  const sig = crypto
    .createHmac('sha256', secret)
    .update(body)
    .digest('hex');

  assert.strictEqual(
    verifyClickUpSignature(body, sig, secret),
    true,
    'Assinatura válida gerada com o mesmo secret deve retornar true',
  );
});

// ---------------------------------------------------------------------------
// Test 2: Assinatura inválida retorna false (gate para 401)
// ---------------------------------------------------------------------------

test('verifyClickUpSignature: assinatura invalida retorna false (gate 401)', () => {
  const body = Buffer.from('{"event":"taskStatusUpdated"}');
  const wrongSig = 'deadbeef'.repeat(8); // 64 chars hex, mas HMAC errado

  assert.strictEqual(
    verifyClickUpSignature(body, wrongSig, 'qualquer-secret'),
    false,
    'Assinatura inválida deve retornar false',
  );
});

// ---------------------------------------------------------------------------
// Test 3: Header ausente OU secret ausente retorna false
// ---------------------------------------------------------------------------

test('verifyClickUpSignature: header ausente retorna false', () => {
  const body = Buffer.from('{}');
  assert.strictEqual(
    verifyClickUpSignature(body, undefined, 'secret'),
    false,
    'Header X-Signature ausente deve retornar false',
  );
});

test('verifyClickUpSignature: secret ausente retorna false', () => {
  const body = Buffer.from('{}');
  const sig = crypto.createHmac('sha256', 'secret').update(body).digest('hex');
  assert.strictEqual(
    verifyClickUpSignature(body, sig, ''),
    false,
    'Secret vazio deve retornar false',
  );
});

test('verifyClickUpSignature: header string vazia retorna false', () => {
  const body = Buffer.from('{}');
  assert.strictEqual(
    verifyClickUpSignature(body, '', 'secret'),
    false,
    'Header vazio deve retornar false',
  );
});
