/**
 * test/errors.test.js
 *
 * Testes de normalização de AppError (CFG-04, T-01-05/T-01-09).
 *
 * Cobre:
 *   - AppError.fromClickUp: shape {err, ECODE} → AppError{api:'clickup', code, status}
 *   - AppError.fromGHL: shape {message, statusCode} → AppError{api:'ghl', status}
 *   - AppError serializado NÃO contém "authorization", tokens nem corpo bruto
 *
 * Não faz chamadas de rede — usa Response-like fake objects.
 * Não depende de .env real.
 */

import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/lib/errors.js';

// ---------------------------------------------------------------------------
// Helper: cria um Response-like fake (subset de globalThis.Response)
// ---------------------------------------------------------------------------

/**
 * Cria um objeto que imita um fetch Response para uso nos mapeadores de erro.
 *
 * @param {number} status - HTTP status code
 * @param {object} body - Corpo JSON da resposta
 * @param {Record<string,string>} [headers={}] - Headers opcionais (para testar redaction)
 * @returns {object}
 */
function fakeResponse(status, body, headers = {}) {
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
// Testes de AppError.fromClickUp
// ---------------------------------------------------------------------------

test('AppError.fromClickUp: shape {err, ECODE} → AppError correto', async () => {
  const res = fakeResponse(401, { err: 'Oauth token not found', ECODE: 'OAUTH_023' });

  const err = await AppError.fromClickUp(res);

  assert.ok(err instanceof AppError, 'Deve ser instância de AppError');
  assert.strictEqual(err.api, 'clickup', 'api deve ser "clickup"');
  assert.strictEqual(err.status, 401, 'status deve ser 401');
  assert.strictEqual(err.code, 'OAUTH_023', 'code deve ser o ECODE da resposta');
  assert.ok(typeof err.message === 'string' && err.message.length > 0, 'message deve existir');
});

test('AppError.fromClickUp: 422 com ECODE de validação → AppError com code correto', async () => {
  const res = fakeResponse(422, { err: 'Invalid field value', ECODE: 'INVALID_FIELD' });

  const err = await AppError.fromClickUp(res);

  assert.strictEqual(err.api, 'clickup');
  assert.strictEqual(err.status, 422);
  assert.strictEqual(err.code, 'INVALID_FIELD');
  assert.strictEqual(err.name, 'AppError');
});

test('AppError.fromClickUp: resposta sem ECODE → code é "UNKNOWN"', async () => {
  const res = fakeResponse(500, { error: 'Internal Server Error' }); // body sem ECODE

  const err = await AppError.fromClickUp(res);

  assert.strictEqual(err.api, 'clickup');
  assert.strictEqual(err.status, 500);
  assert.strictEqual(err.code, 'UNKNOWN', 'code deve ser "UNKNOWN" quando não há ECODE');
});

test('AppError.fromClickUp: body não-JSON → não lança, retorna AppError fallback', async () => {
  // Simula body que lança no .json()
  const res = {
    status: 502,
    ok: false,
    headers: { get: () => null },
    async json() {
      throw new SyntaxError('Unexpected token < in JSON at position 0');
    },
  };

  const err = await AppError.fromClickUp(res);

  assert.ok(err instanceof AppError, 'Deve ser AppError mesmo com body não-JSON');
  assert.strictEqual(err.api, 'clickup');
  assert.strictEqual(err.status, 502);
  assert.strictEqual(err.code, 'UNKNOWN');
});

// ---------------------------------------------------------------------------
// Testes de AppError.fromGHL
// ---------------------------------------------------------------------------

test('AppError.fromGHL: shape {message, statusCode} → AppError correto', async () => {
  const res = fakeResponse(422, { message: 'Post content is required', statusCode: 422 });

  const err = await AppError.fromGHL(res);

  assert.ok(err instanceof AppError, 'Deve ser instância de AppError');
  assert.strictEqual(err.api, 'ghl', 'api deve ser "ghl"');
  assert.strictEqual(err.status, 422, 'status deve ser 422');
  assert.ok(err.message.includes('Post content'), 'message deve refletir a mensagem da API');
});

test('AppError.fromGHL: 401 não autorizado → AppError com status 401', async () => {
  const res = fakeResponse(401, { message: 'Unauthorized', statusCode: 401 });

  const err = await AppError.fromGHL(res);

  assert.strictEqual(err.api, 'ghl');
  assert.strictEqual(err.status, 401);
  assert.strictEqual(err.name, 'AppError');
});

test('AppError.fromGHL: body não-JSON → não lança, retorna AppError fallback', async () => {
  const res = {
    status: 503,
    ok: false,
    headers: { get: () => null },
    async json() {
      throw new SyntaxError('Unexpected token');
    },
  };

  const err = await AppError.fromGHL(res);

  assert.ok(err instanceof AppError);
  assert.strictEqual(err.api, 'ghl');
  assert.strictEqual(err.status, 503);
});

// ---------------------------------------------------------------------------
// Testes de segurança: serialização NÃO vaza segredos (T-01-05 / T-01-09)
// ---------------------------------------------------------------------------

test('AppError: serialização (JSON.stringify) NÃO contém "authorization" nem token', async () => {
  // Simula uma resposta com headers de auth que NÃO devem vazar para o AppError
  const sensitiveHeader = 'pk_99_FAKE_TOKEN_SHOULD_NOT_APPEAR';
  const res = fakeResponse(
    401,
    { err: 'Unauthorized', ECODE: 'OAUTH_023' },
    { authorization: sensitiveHeader },
  );

  const err = await AppError.fromClickUp(res);
  const serialized = JSON.stringify(err);

  // Verificar que o header Authorization não vazou na serialização
  assert.ok(
    !serialized.toLowerCase().includes('authorization'),
    `Serialização não deve conter "authorization". Recebido: ${serialized}`,
  );
  assert.ok(
    !serialized.includes(sensitiveHeader),
    `Serialização não deve conter o valor do header sensível. Recebido: ${serialized}`,
  );
});

test('AppError: serialização NÃO contém token GHL sensível', async () => {
  const sensitiveGhlToken = 'pit-99-FAKE_GHL_TOKEN_SHOULD_NOT_APPEAR';
  const res = fakeResponse(
    401,
    { message: 'Invalid token', statusCode: 401 },
    { authorization: `Bearer ${sensitiveGhlToken}` },
  );

  const err = await AppError.fromGHL(res);
  const serialized = JSON.stringify(err);

  assert.ok(
    !serialized.includes(sensitiveGhlToken),
    `Serialização não deve conter o token GHL. Recebido: ${serialized}`,
  );
  assert.ok(
    !serialized.toLowerCase().includes('authorization'),
    `Serialização não deve conter "authorization". Recebido: ${serialized}`,
  );
});

test('AppError: contém apenas status, code, api e message — sem corpo bruto', async () => {
  const res = fakeResponse(403, {
    err: 'Forbidden',
    ECODE: 'ACCESS_DENIED',
    // Campos sensíveis adicionais no body que NÃO devem aparecer no AppError
    internalDetails: 'very-secret-internal-info',
    rawHeaders: { Authorization: 'pk_secret' },
  });

  const err = await AppError.fromClickUp(res);

  // AppError só deve ter: status, code, api, message, name
  assert.ok('status' in err, 'AppError deve ter status');
  assert.ok('code' in err, 'AppError deve ter code');
  assert.ok('api' in err, 'AppError deve ter api');
  assert.ok('message' in err, 'AppError deve ter message');

  const serialized = JSON.stringify(err);
  assert.ok(
    !serialized.includes('internalDetails'),
    'Serialização não deve conter campos internos do body bruto',
  );
  assert.ok(
    !serialized.includes('very-secret-internal-info'),
    'Serialização não deve conter valores internos do body bruto',
  );
});
