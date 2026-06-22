/**
 * src/index.js
 *
 * Entrypoint da aplicação — Walking Skeleton (Phase 1).
 *
 * Executa o smoke test ponta-a-ponta:
 *   1. Carrega e valida config do .env (fail-fast via src/config/index.js)
 *   2. Autentica no ClickUp e lê a lista real de produção
 *   3. Autentica no GHL e lista as contas do Social Planner
 *   4. Emite log estruturado em cada passo com action='boot' (CFG-04)
 *
 * Exporta boot() para ser testável pelo smoke test (test/smoke.test.js).
 */
import { config } from './config/index.js';
import { withContext } from './lib/logger.js';
import { clickup } from './clients/clickup.js';
import { ghl } from './clients/ghl.js';

/**
 * Executa o boot da aplicação: autentica nas duas APIs e valida a fundação.
 * Cada passo emite log estruturado com action='boot' (CFG-04).
 *
 * Em falha fatal: loga com log.fatal e lança o erro (quem chama decide se faz process.exit).
 *
 * @returns {Promise<void>}
 */
export async function boot() {
  const log = withContext({ action: 'boot' });

  log.info({ step: 'config' }, 'Config carregada e validada do .env');

  // Passo 1: Autenticar no ClickUp e ler a lista real
  log.info({ step: 'clickup.getList', listId: config.CLICKUP_LIST_ID }, 'Autenticando no ClickUp...');
  const list = await clickup.getList(config.CLICKUP_LIST_ID);
  log.info({ step: 'clickup.getList', listName: list.name }, 'ClickUp autenticado');

  // Passo 2: Autenticar no GHL e listar contas do Social Planner
  log.info({ step: 'ghl.listAccounts' }, 'Autenticando no GHL...');
  const accountsResult = await ghl.listAccounts();
  // A API GHL retorna: { success, results: { accounts: [...], groups: [] } }
  const accounts =
    accountsResult?.results?.accounts ??
    accountsResult?.accounts ??
    (Array.isArray(accountsResult) ? accountsResult : []);
  log.info({ step: 'ghl.listAccounts', count: accounts.length }, 'GHL autenticado');

  log.info({ step: 'done' }, 'Fundação OK — clients prontos');
}

// Execução direta (entrypoint): chamar boot() e sair com código adequado.
// Usa fileURLToPath para comparar corretamente em todos os SOs (incluindo Windows).
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] === __filename;

if (isEntrypoint || process.env.DIRECT_RUN === '1') {
  const log = withContext({ action: 'boot' });
  boot().catch((err) => {
    log.fatal({ err }, 'Falha fatal no boot — encerrando');
    process.exit(1);
  });
}
