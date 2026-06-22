/**
 * test/clients.test.js
 *
 * Regression test for CR-01: drives a non-retryable 4xx response through
 * each client's request/retry wrapper and asserts:
 *   1. The rejection is an AppError (not a TypeError or raw Error)
 *   2. No retry occurs — fetch is called exactly once per request
 *
 * This test would have FAILED against the old code (pRetry.AbortError is
 * not a constructor → TypeError instead of AppError).
 *
 * HTTP layer is stubbed via node:test mock.method on globalThis.fetch — no
 * live network calls. Requires .env for config validation (same as all other
 * tests in this suite).
 */

import 'dotenv/config';
import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../src/lib/errors.js';

// ---------------------------------------------------------------------------
// Helper: create a minimal fetch-Response-like stub for a given status code
// ---------------------------------------------------------------------------

/**
 * Returns a fake Response object compatible with the shape the clients
 * expect: `.status`, `.ok`, `.headers.get()`, `.json()`, `.text()`.
 *
 * @param {number} status
 * @param {object} [body]
 * @param {Record<string,string>} [headers]
 */
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
// ClickUp client — 404 through request()
// ---------------------------------------------------------------------------

test('clickup.request: 404 rejects with AppError, not TypeError, and does not retry', async (t) => {
  let callCount = 0;

  // Stub globalThis.fetch to return a 404 response.
  // We use mock.method which restores automatically when the test ends.
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    callCount = callCount + 1;
    return fakeResponse(404, { err: 'List not found', ECODE: 'ITEM_NOT_FOUND' });
  });

  // Dynamic import so the mock is already in place when the module's fetch
  // calls execute. The module is cached after first import, so we rely on
  // the global fetch stub being picked up at call-time (not import-time).
  const { clickup } = await import('../src/clients/clickup.js');

  let caughtError;
  try {
    await clickup.getList('nonexistent-list-id');
  } catch (err) {
    caughtError = err;
  }

  // 1. Must have thrown
  assert.ok(caughtError !== undefined, 'getList should have thrown for a 404');

  // 2. Must be an AppError — not a TypeError (old broken behavior) and not a raw Error
  assert.ok(
    caughtError instanceof AppError,
    `Error must be an AppError. Got: ${caughtError?.constructor?.name} — ${caughtError?.message}`,
  );

  // 3. Sanity-check the AppError shape
  assert.strictEqual(caughtError.status, 404, 'AppError.status must be 404');
  assert.strictEqual(caughtError.api, 'clickup', 'AppError.api must be "clickup"');
  assert.strictEqual(caughtError.code, 'ITEM_NOT_FOUND', 'AppError.code must reflect ECODE');

  // 4. Must NOT have retried — AbortError must stop p-retry after the first attempt
  assert.strictEqual(
    callCount,
    1,
    `fetch must be called exactly once for a 4xx (no retries). Called: ${callCount}`,
  );

  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// GHL client — 401 through request()
// ---------------------------------------------------------------------------

test('ghl.request: 401 rejects with AppError, not TypeError, and does not retry', async (t) => {
  let callCount = 0;

  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    callCount = callCount + 1;
    return fakeResponse(401, { message: 'Unauthorized', statusCode: 401 });
  });

  const { ghl } = await import('../src/clients/ghl.js');

  let caughtError;
  try {
    await ghl.listAccounts();
  } catch (err) {
    caughtError = err;
  }

  // 1. Must have thrown
  assert.ok(caughtError !== undefined, 'listAccounts should have thrown for a 401');

  // 2. Must be an AppError
  assert.ok(
    caughtError instanceof AppError,
    `Error must be an AppError. Got: ${caughtError?.constructor?.name} — ${caughtError?.message}`,
  );

  // 3. Sanity-check the AppError shape
  assert.strictEqual(caughtError.status, 401, 'AppError.status must be 401');
  assert.strictEqual(caughtError.api, 'ghl', 'AppError.api must be "ghl"');

  // 4. Must NOT have retried
  assert.strictEqual(
    callCount,
    1,
    `fetch must be called exactly once for a 4xx (no retries). Called: ${callCount}`,
  );

  fetchMock.mock.restore();
});

// ---------------------------------------------------------------------------
// Extra: 5xx IS retried (confirm retry path still works after the CR-01 fix)
// ---------------------------------------------------------------------------

test('clickup.request: 500 retries up to configured limit before rejecting', async (t) => {
  let callCount = 0;

  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    callCount = callCount + 1;
    return fakeResponse(500, { err: 'Internal Server Error' });
  });

  const { clickup } = await import('../src/clients/clickup.js');

  let caughtError;
  try {
    await clickup.getList('some-list-id');
  } catch (err) {
    caughtError = err;
  }

  // Should have thrown after exhausting retries
  assert.ok(caughtError !== undefined, 'getList should have thrown after retries exhausted');

  // 5xx is NOT an AppError — it is a plain Error thrown by p-retry after exhaustion.
  // The important assertion: it is NOT a TypeError (that would be the CR-01 regression).
  assert.ok(
    !(caughtError instanceof TypeError),
    `5xx exhaustion must not produce a TypeError. Got: ${caughtError?.constructor?.name}`,
  );

  // With retries: 3, there should be 4 total attempts (initial + 3 retries)
  assert.strictEqual(
    callCount,
    4,
    `fetch must be called 4 times (1 initial + 3 retries). Called: ${callCount}`,
  );

  fetchMock.mock.restore();
});
