/**
 * Smoke test end-to-end do boot ponta-a-ponta.
 *
 * RED:  Falha quando src/ ainda não existe (módulo não encontrado).
 * GREEN: Passa quando a implementação completa está presente e o .env real está configurado.
 *
 * Se as variáveis de ambiente obrigatórias não estiverem presentes, o teste
 * é pulado graciosamente (t.skip). Se estiverem presentes e o boot lançar,
 * o teste falha.
 */
import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const REQUIRED_ENV_VARS = [
  'CLICKUP_TOKEN',
  'CLICKUP_LIST_ID',
  'GHL_TOKEN',
  'GHL_LOCATION_ID',
];

function hasEnvVars() {
  return REQUIRED_ENV_VARS.every((v) => Boolean(process.env[v]));
}

test('boot() resolve sem lançar quando o .env real está presente', async (t) => {
  if (!hasEnvVars()) {
    t.skip('Variáveis de ambiente obrigatórias ausentes — pulando smoke test de integração');
    return;
  }

  // Importar o entrypoint — deve exportar uma função boot()
  const { boot } = await import('../src/index.js');
  assert.strictEqual(typeof boot, 'function', 'src/index.js deve exportar boot()');

  // boot() deve resolver sem lançar
  await assert.doesNotReject(
    () => boot(),
    'boot() não deve lançar com .env real presente',
  );
});

test('clickup.getList retorna lista com name contendo "Agendamentos"', async (t) => {
  if (!hasEnvVars()) {
    t.skip('Variáveis de ambiente obrigatórias ausentes — pulando smoke test de integração');
    return;
  }

  const { clickup } = await import('../src/clients/clickup.js');
  const { config } = await import('../src/config/index.js');

  const list = await clickup.getList(config.CLICKUP_LIST_ID);
  assert.ok(list, 'getList deve retornar um objeto');
  assert.ok(
    typeof list.name === 'string' && list.name.includes('Agendamentos'),
    `list.name deve incluir "Agendamentos", recebido: ${list?.name}`,
  );
});

test('ghl.listAccounts retorna contas incluindo auton.app', async (t) => {
  if (!hasEnvVars()) {
    t.skip('Variáveis de ambiente obrigatórias ausentes — pulando smoke test de integração');
    return;
  }

  const { ghl } = await import('../src/clients/ghl.js');

  const result = await ghl.listAccounts();
  assert.ok(result, 'listAccounts deve retornar um objeto');

  // A API GHL retorna: { success, results: { accounts: [...], groups: [] } }
  // Fallback para result.accounts ou array direto para resiliência
  const accounts =
    result?.results?.accounts ??
    result?.accounts ??
    (Array.isArray(result) ? result : []);
  assert.ok(Array.isArray(accounts) && accounts.length > 0, 'Deve retornar ao menos uma conta');

  const hasAuton = accounts.some(
    (a) =>
      (typeof a.name === 'string' && a.name.toLowerCase().includes('auton')) ||
      (typeof a.handle === 'string' && a.handle.toLowerCase().includes('auton')),
  );
  assert.ok(hasAuton, `Contas devem incluir auton.app. Recebido: ${JSON.stringify(accounts.map((a) => ({ name: a.name, handle: a.handle })))}`);
});
