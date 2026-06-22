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
import { runSchedulerBatch } from './scheduler/pipeline.js';

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
  log.info({ step: 'clickup.getList', listName: list?.name }, 'ClickUp autenticado');

  // Passo 2: Autenticar no GHL e listar contas do Social Planner
  log.info({ step: 'ghl.listAccounts' }, 'Autenticando no GHL...');
  const accountsResult = await ghl.listAccounts();
  // A API GHL retorna: { success, results: { accounts: [...], groups: [] } }
  const accounts =
    accountsResult?.results?.accounts ??
    accountsResult?.accounts ??
    (Array.isArray(accountsResult) ? accountsResult : []);
  log.info({ step: 'ghl.listAccounts', count: accounts.length }, 'GHL autenticado');

  // Passo 3: Ler custom fields da lista para confirmar shape [ASSUMED] A2 do RESEARCH
  // Confirma: GET /list/{id}/field retorna type_config.options para dropdowns (Pitfall 2)
  // Mapeia label→id das opções do campo "Formato" que a Phase 2 precisará para escrever.
  // Não falha o boot se o campo não for encontrado — apenas loga warn (objetivo: descobrir/confirmar).
  log.info({ step: 'clickup.getListFields', listId: config.CLICKUP_LIST_ID }, 'Lendo custom fields da lista...');
  try {
    const fieldsResult = await clickup.getListFields(config.CLICKUP_LIST_ID);
    // Shape retornado: { fields: [...] }
    const fields = fieldsResult?.fields ?? (Array.isArray(fieldsResult) ? fieldsResult : []);
    log.info({ step: 'clickup.getListFields', fieldCount: fields.length }, 'Custom fields lidos');

    // Localizar campo "Formato" (dropdown) para confirmar shape type_config.options
    const formatoField = fields.find(
      (f) => typeof f.name === 'string' && f.name.toLowerCase().includes('formato'),
    );

    if (formatoField) {
      // Mapear label→id das opções (Reels/Carrossel/Stories/Feed)
      const options = formatoField?.type_config?.options ?? [];
      const labelToId = Object.fromEntries(
        options.map((opt) => [opt.label ?? opt.name ?? opt.value, opt.id]),
      );
      log.info(
        {
          step: 'clickup.getListFields',
          field: formatoField.name,
          fieldId: formatoField.id,
          fieldType: formatoField.type,
          optionCount: options.length,
          labelToId,
        },
        'Campo Formato mapeado — confirma shape type_config.options para Phase 2',
      );
    } else {
      log.warn(
        { step: 'clickup.getListFields', fieldNames: fields.map((f) => f.name) },
        'Campo "Formato" não encontrado nos custom fields — shape A2 não confirmado',
      );
    }
  } catch (err) {
    // Não bloquear o boot — logar warn e continuar (objetivo é descoberta, não bloqueio)
    log.warn({ step: 'clickup.getListFields', err: err?.message }, 'Falha ao ler custom fields — continuando boot');
  }

  log.info({ step: 'done' }, 'Fundação OK — clients prontos');
}

// Execução direta (entrypoint): chamar boot() e sair com código adequado.
// Usa fileURLToPath para comparar corretamente em todos os SOs (incluindo Windows).
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] === __filename;

if (isEntrypoint || process.env.DIRECT_RUN === '1') {
  const log = withContext({ action: 'main' });
  (async () => {
    await boot();
    // Executar o scheduler batch quando não estiver em modo smoke-only
    if (!process.env.SMOKE_ONLY) {
      await runSchedulerBatch();
    } else {
      log.info({ step: 'smoke_only' }, 'SMOKE_ONLY=1 — pulando runSchedulerBatch');
    }
  })().catch((err) => {
    log.fatal({ err }, 'Falha fatal — encerrando');
    process.exit(1);
  });
}
