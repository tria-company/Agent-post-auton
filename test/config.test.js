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
