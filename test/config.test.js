/**
 * test/config.test.js
 *
 * Testes de fail-fast da configuração (CFG-01).
 *
 * Abordagem: subprocesso isolado (spawnSync) que importa src/config/index.js
 * com um processo.env propositalmente incompleto ou completo.
 * Não depende do .env real — monta o env diretamente no subprocesso.
 *
 * Cobre:
 *   - env sem CLICKUP_TOKEN → exit code !=0 e stderr cita variável/erro
 *   - env com todas variáveis mínimas válidas → exit code 0
 *
 * Segurança: os valores de token passados aqui são sintéticos/falsos (pk_test, pit-test)
 * — nunca tokens reais.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

/**
 * Env mínimo completo com todos os campos obrigatórios usando valores sintéticos.
 * Garante que o import de config/index.js sai com exit code 0.
 *
 * Phase 2: inclui as 7 novas variáveis (CFG-01):
 *   CU_FIELD_GHL_POST_ID, CU_FIELD_LINK_DO_POST, CU_FIELD_FORMATO,
 *   GHL_ACCOUNT_ID, GHL_USER_ID, STATUS_A_AGENDAR, STATUS_AGENDADO
 * Phase 3: inclui as variáveis novas (CFG-01):
 *   CLICKUP_WEBHOOK_SECRET, WEBHOOK_PORT, POLL_INTERVAL_MS, STATUS_PUBLICADO
 */
const FULL_ENV = {
  CLICKUP_TOKEN: 'pk_test_placeholder_token_value',
  CLICKUP_LIST_ID: '901327135553',
  GHL_TOKEN: 'pit-test-placeholder-token-value',
  GHL_LOCATION_ID: 'zEFpdSK1pMIC9d8aY4Lm',
  GHL_API_VERSION: '2021-07-28',
  CU_FIELD_LEGENDA: '91c07244-6ce6-42c7-bea2-ec49dba12fd3',
  CU_FIELD_DATA_PUBLICACAO: 'd5107244-d044-4bd0-ae5c-c07f8a4f194e',
  CU_FIELD_IG_MEDIA_ID: 'cde1cd79-ecdc-43f7-b29e-7d0f42c2eed1',
  CU_FIELD_LINK_PUBLICADO: 'e98e36fe-1d17-48b7-a797-9ae9b1623d0f',
  CU_FIELD_ERRO_PUBLICACAO: '1137de68-9a0a-467e-8848-1d0e59844d5e',
  CU_FIELD_ID_TASK_MAE: '3f37fbaa-93d0-4344-9fe2-f7c2c7320383',
  // Phase 2 — 6 novas variáveis obrigatórias (CFG-01)
  // UUIDs sintéticos no formato v4 válido (não são reais)
  CU_FIELD_GHL_POST_ID: 'a1b2c3d4-1234-4abc-8def-000000000001',
  CU_FIELD_LINK_DO_POST: 'a1b2c3d4-1234-4abc-8def-000000000002',
  CU_FIELD_FORMATO: '24e0f126-589f-400c-a602-0e4abe19b809',
  GHL_ACCOUNT_ID: 'test-account-id_17841440215631995',
  GHL_USER_ID: 'test-user-id-ghl-placeholder',
  STATUS_A_AGENDAR: 'a agendar',
  STATUS_AGENDADO: 'agendado',
  // Phase 3 — servidor webhook + polling (CFG-01)
  CLICKUP_WEBHOOK_SECRET: 'test-webhook-secret-placeholder',
  LOG_LEVEL: 'info',
  // Sem arquivo .env real — dotenv não vai encontrar nada, mas spawnSync envia process.env
  DOTENV_CONFIG_PATH: '/nonexistent/.env.test.nofile',
};

/**
 * Executa um subprocesso que faz `import('src/config/index.js')` no contexto
 * de um env específico. Retorna o resultado do spawnSync.
 *
 * Usa um arquivo ESM temporário para compatibilidade com Windows (caminhos UNC/drive letter).
 * O arquivo é criado e apagado a cada execução.
 */
function runConfigImport(env) {
  // Converter caminho Windows para file:// URL para uso em import() ESM
  const configFileUrl = pathToFileURL(resolve(ROOT, 'src', 'config', 'index.js')).href;
  const scriptContent = `import '${configFileUrl}';`;

  // Criar arquivo temporário para o script
  const tmpDir = mkdtempSync(join(tmpdir(), 'config-test-'));
  const tmpFile = join(tmpDir, 'run.mjs');
  writeFileSync(tmpFile, scriptContent, 'utf8');

  try {
    return spawnSync(
      process.execPath,
      [tmpFile],
      {
        env: { ...env },
        encoding: 'utf8',
        timeout: 10_000,
        cwd: ROOT,
      },
    );
  } finally {
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
    try { unlinkSync(tmpDir); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// Testes de fail-fast (CFG-01)
// ---------------------------------------------------------------------------

test('config: env sem CLICKUP_TOKEN → exit code !=0 e stderr indica erro', () => {
  const env = { ...FULL_ENV };
  delete env.CLICKUP_TOKEN;

  const result = runConfigImport(env);

  // Exit code deve ser não-zero (fail-fast)
  assert.notStrictEqual(result.status, 0, `Exit code esperado !=0, recebido: ${result.status}`);

  // Stderr deve mencionar CLICKUP_TOKEN ou indicar config inválida
  const combinedOutput = (result.stderr ?? '') + (result.stdout ?? '');
  const mentionsTerm =
    combinedOutput.toLowerCase().includes('clickup_token') ||
    combinedOutput.toLowerCase().includes('config') ||
    combinedOutput.toLowerCase().includes('invalid') ||
    combinedOutput.toLowerCase().includes('inválid');

  assert.ok(
    mentionsTerm,
    `Stderr/stdout deve citar a variável ou indicar config inválida. Recebido stderr: ${result.stderr?.slice(0, 500)}`,
  );
});

test('config: env sem GHL_TOKEN → exit code !=0 e stderr indica erro', () => {
  const env = { ...FULL_ENV };
  delete env.GHL_TOKEN;

  const result = runConfigImport(env);

  assert.notStrictEqual(result.status, 0, `Exit code esperado !=0, recebido: ${result.status}`);

  const combinedOutput = (result.stderr ?? '') + (result.stdout ?? '');
  const mentionsTerm =
    combinedOutput.toLowerCase().includes('ghl_token') ||
    combinedOutput.toLowerCase().includes('config') ||
    combinedOutput.toLowerCase().includes('invalid') ||
    combinedOutput.toLowerCase().includes('inválid');

  assert.ok(
    mentionsTerm,
    `Stderr/stdout deve citar a variável ou indicar config inválida. Recebido stderr: ${result.stderr?.slice(0, 500)}`,
  );
});

test('config: env sem CU_FIELD_LEGENDA (UUID inválido) → exit code !=0', () => {
  const env = { ...FULL_ENV };
  delete env.CU_FIELD_LEGENDA;

  const result = runConfigImport(env);

  assert.notStrictEqual(result.status, 0, `Exit code esperado !=0, recebido: ${result.status}`);
});

test('config: env com todas as variáveis mínimas válidas → exit code 0 (sem falha)', () => {
  // Env completo com valores sintéticos mas válidos na forma (format check do zod)
  const result = runConfigImport(FULL_ENV);

  assert.strictEqual(
    result.status,
    0,
    `Exit code esperado 0 com env completo. Stderr: ${result.stderr?.slice(0, 500)}`,
  );
});

test('config: CLICKUP_TOKEN com prefixo errado → exit code !=0', () => {
  const env = { ...FULL_ENV, CLICKUP_TOKEN: 'bad_prefix_token' };

  const result = runConfigImport(env);

  assert.notStrictEqual(result.status, 0, `Exit code esperado !=0 para token com prefixo inválido`);
});

// ---------------------------------------------------------------------------
// Phase 2 — Testes das 6 novas variáveis (CFG-01)
// ---------------------------------------------------------------------------

test('config Phase 2: env completo com as 6 novas vars → exit code 0', () => {
  // FULL_ENV já inclui as 6 novas vars — este teste confirma que o env completo
  // (incluindo Phase 2) ainda sai com exit code 0
  const result = runConfigImport(FULL_ENV);

  assert.strictEqual(
    result.status,
    0,
    `Exit code esperado 0 com env completo (Phase 2). Stderr: ${result.stderr?.slice(0, 500)}`,
  );
});

test('config Phase 2: faltar CU_FIELD_GHL_POST_ID → fail-fast exit code !=0', () => {
  const env = { ...FULL_ENV };
  delete env.CU_FIELD_GHL_POST_ID;

  const result = runConfigImport(env);

  assert.notStrictEqual(
    result.status,
    0,
    `Exit code esperado !=0 quando CU_FIELD_GHL_POST_ID está ausente`,
  );
  const combinedOutput = (result.stderr ?? '') + (result.stdout ?? '');
  const mentionsTerm =
    combinedOutput.toLowerCase().includes('cu_field_ghl_post_id') ||
    combinedOutput.toLowerCase().includes('config') ||
    combinedOutput.toLowerCase().includes('inválid');
  assert.ok(mentionsTerm, `Stderr/stdout deve citar a variável. Recebido: ${result.stderr?.slice(0, 300)}`);
});

test('config Phase 2: faltar CU_FIELD_LINK_DO_POST → fail-fast exit code !=0', () => {
  const env = { ...FULL_ENV };
  delete env.CU_FIELD_LINK_DO_POST;

  const result = runConfigImport(env);

  assert.notStrictEqual(result.status, 0, `Exit code esperado !=0 quando CU_FIELD_LINK_DO_POST ausente`);
});

test('config Phase 2: faltar GHL_ACCOUNT_ID → fail-fast exit code !=0', () => {
  const env = { ...FULL_ENV };
  delete env.GHL_ACCOUNT_ID;

  const result = runConfigImport(env);

  assert.notStrictEqual(result.status, 0, `Exit code esperado !=0 quando GHL_ACCOUNT_ID ausente`);
});

test('config Phase 2: STATUS_A_AGENDAR e STATUS_AGENDADO têm defaults quando ausentes', () => {
  // Remover os dois status do env — devem assumir defaults 'a agendar' e 'agendado'
  // O config deve sair sem erro (exit code 0) pois ambos têm .default()
  const env = { ...FULL_ENV };
  delete env.STATUS_A_AGENDAR;
  delete env.STATUS_AGENDADO;

  const result = runConfigImport(env);

  assert.strictEqual(
    result.status,
    0,
    `Exit code esperado 0 — STATUS_A_AGENDAR e STATUS_AGENDADO têm defaults. Stderr: ${result.stderr?.slice(0, 500)}`,
  );
});

// ---------------------------------------------------------------------------
// Phase 2 — GHL_USER_ID (crítico — 422 sem ele no createPost)
// ---------------------------------------------------------------------------

test('config Phase 2: GHL_USER_ID presente no env completo → config válida (exit 0)', () => {
  // GHL_USER_ID já está no FULL_ENV — confirma que o env completo ainda é válido
  const result = runConfigImport(FULL_ENV);

  assert.strictEqual(
    result.status,
    0,
    `Exit code esperado 0 com GHL_USER_ID presente. Stderr: ${result.stderr?.slice(0, 500)}`,
  );
});

test('config Phase 2: faltar GHL_USER_ID → fail-fast exit code !=0', () => {
  const env = { ...FULL_ENV };
  delete env.GHL_USER_ID;

  const result = runConfigImport(env);

  assert.notStrictEqual(
    result.status,
    0,
    `Exit code esperado !=0 quando GHL_USER_ID está ausente`,
  );
  const combinedOutput = (result.stderr ?? '') + (result.stdout ?? '');
  const mentionsTerm =
    combinedOutput.toLowerCase().includes('ghl_user_id') ||
    combinedOutput.toLowerCase().includes('config') ||
    combinedOutput.toLowerCase().includes('inválid');
  assert.ok(
    mentionsTerm,
    `Stderr/stdout deve citar a variável ou indicar config inválida. Recebido: ${result.stderr?.slice(0, 300)}`,
  );
});

// ---------------------------------------------------------------------------
// Phase 3 — Testes das 4 novas variáveis de webhook/polling (CFG-01)
// ---------------------------------------------------------------------------

test('config Phase 3: env completo com CLICKUP_WEBHOOK_SECRET → exit code 0', () => {
  // FULL_ENV já inclui CLICKUP_WEBHOOK_SECRET — confirma que o env completo
  // (incluindo Phase 3) sai com exit code 0
  const result = runConfigImport(FULL_ENV);

  assert.strictEqual(
    result.status,
    0,
    `Exit code esperado 0 com env completo (Phase 3). Stderr: ${result.stderr?.slice(0, 500)}`,
  );
});

test('config Phase 3: faltar CLICKUP_WEBHOOK_SECRET → fail-fast exit code !=0', () => {
  const env = { ...FULL_ENV };
  delete env.CLICKUP_WEBHOOK_SECRET;

  const result = runConfigImport(env);

  assert.notStrictEqual(
    result.status,
    0,
    `Exit code esperado !=0 quando CLICKUP_WEBHOOK_SECRET ausente`,
  );
  const combinedOutput = (result.stderr ?? '') + (result.stdout ?? '');
  const mentionsTerm =
    combinedOutput.toLowerCase().includes('clickup_webhook_secret') ||
    combinedOutput.toLowerCase().includes('config') ||
    combinedOutput.toLowerCase().includes('inválid');
  assert.ok(
    mentionsTerm,
    `Stderr/stdout deve citar CLICKUP_WEBHOOK_SECRET. Recebido: ${result.stderr?.slice(0, 300)}`,
  );
});

test('config Phase 3: WEBHOOK_PORT e POLL_INTERVAL_MS têm defaults quando ausentes', () => {
  // Ambos têm .default() → config válida sem eles
  const env = { ...FULL_ENV };
  delete env.WEBHOOK_PORT;
  delete env.POLL_INTERVAL_MS;

  const result = runConfigImport(env);

  assert.strictEqual(
    result.status,
    0,
    `Exit code esperado 0 — WEBHOOK_PORT e POLL_INTERVAL_MS têm defaults. Stderr: ${result.stderr?.slice(0, 500)}`,
  );
});

test('config Phase 3: STATUS_PUBLICADO tem default publicado quando ausente', () => {
  const env = { ...FULL_ENV };
  delete env.STATUS_PUBLICADO;

  const result = runConfigImport(env);

  assert.strictEqual(
    result.status,
    0,
    `Exit code esperado 0 — STATUS_PUBLICADO tem default. Stderr: ${result.stderr?.slice(0, 500)}`,
  );
});
