/**
 * src/scheduler/pipeline.js
 *
 * Orquestrador batch do pipeline de agendamento ClickUp → GHL (Phase 2).
 *
 * Fluxo principal (runSchedulerBatch):
 *   1. getListTasks: lê tasks com status 'a agendar' da lista ClickUp (SCH-01)
 *   2. Bootstrap: getListFields para montar mapa orderindex→label do campo Formato (Pitfall 2)
 *   3. Filtro de elegibilidade: Data de publicação preenchida + CF_GHL_POST_ID vazio (SCH-06/D-02)
 *   4. processTask para cada task elegível, isolada em try/catch (D-18)
 *
 * processTask:
 *   1. resolveContent: legenda + link com fallback campo-a-campo para task mãe (SCH-02/D-04/D-05/D-06)
 *   2. mapFormato: orderindex → {ghlType, mediaCount}
 *   3. downloadAndExtract com zip-slip/SSRF/magic-bytes guards (SCH-03)
 *   4. uploadMedia para cada arquivo extraído (único para este plano — Plano 03 cobre carrossel)
 *   5. createPost agendado no GHL Social Planner com userId (CRÍTICO) (SCH-04)
 *   6. write-back de sucesso: updateTask(agendado) → setCustomField(CF_GHL_POST_ID) (SCH-05)
 *   7. try/finally: cleanupTmp sempre executado (D-11)
 *
 * Segurança:
 *   - NUNCA logar zipUrl/link do MinIO — só taskId e fileName (T-02-03)
 *   - Tokens e headers auth redactados pelo logger (T-01-02, configurado em logger.js)
 *
 * Exportações públicas:
 *   runSchedulerBatch()                → Promise<void>
 *   processTask(task, formatoOptionsMap) → Promise<void>
 *   resolveContent(task)               → Promise<{legenda: string, linkDoPost: string}>
 *   readCF(task, fieldId)              → string | number | null
 *   mapFormato(name)                   → {ghlType: string, mediaCount: 'single'|'multiple'}
 */

import { config } from '../config/index.js';
import { withContext } from '../lib/logger.js';
import { clickup } from '../clients/clickup.js';
import { ghl } from '../clients/ghl.js';
import { downloadAndExtract, cleanupTmp, mimeFromFilename } from '../lib/zip.js';

const log = withContext({ module: 'scheduler', action: 'runSchedulerBatch' });

// ---------------------------------------------------------------------------
// Mapa Formato → tipo GHL (D-12, Pattern 5 do PATTERNS.md)
// Labels confirmados empiricamente vs. lista 901327135553 (Wave 0):
//   Reels, Carrossel, Stories, Feed estático
// Stories é inválido neste plano (D-13) — lança para tratamento no catch.
// ---------------------------------------------------------------------------

/**
 * @type {Record<string, {ghlType: 'post'|'reel', mediaCount: 'single'|'multiple'}>}
 */
const FORMATO_MAP = {
  'Reels':          { ghlType: 'reel',  mediaCount: 'single'   },
  'Carrossel':      { ghlType: 'post',  mediaCount: 'multiple' },
  'Feed estático':  { ghlType: 'post',  mediaCount: 'single'   },
  // 'Sequência' pode aparecer em outras workspaces — mapeado como post/single por segurança
  'Sequência':      { ghlType: 'post',  mediaCount: 'single'   },
};

// ---------------------------------------------------------------------------
// Helpers exportados (testáveis)
// ---------------------------------------------------------------------------

/**
 * Lê o valor de um custom field de uma task ClickUp por fieldId.
 * Retorna null se o campo não existir ou o valor for null/undefined.
 *
 * @param {object} task - Task object do ClickUp
 * @param {string} fieldId - UUID do custom field
 * @returns {string | number | null}
 */
export function readCF(task, fieldId) {
  const field = task.custom_fields?.find((f) => f.id === fieldId);
  if (!field) return null;
  // Campos com value undefined ou null → null
  return field.value ?? null;
}

/**
 * Mapeia o label do Formato (ex: 'Reels', 'Feed estático') para o tipo GHL.
 * Lança se o formato for desconhecido ou inválido (ex: 'Stories' é D-13).
 *
 * @param {string} name - Label do formato (ex: 'Reels', 'Feed estático')
 * @returns {{ghlType: 'post'|'reel', mediaCount: 'single'|'multiple'}}
 * @throws {Error} Se o formato não for suportado
 */
export function mapFormato(name) {
  const mapped = FORMATO_MAP[name];
  if (!mapped) {
    throw new Error(
      `Formato não suportado: "${name}". ` +
      `Suportados: ${Object.keys(FORMATO_MAP).join(', ')}. ` +
      `"Stories" está fora do escopo da Phase 2 (D-13).`,
    );
  }
  return mapped;
}

/**
 * Resolve legenda e link do post da task filha, com fallback campo-a-campo
 * para a task mãe quando o campo está vazio (SCH-02/D-04/D-05/D-06).
 *
 * Fallback é campo-a-campo independente:
 *   - Legenda: pega da filha; se vazio, busca da mãe
 *   - Link:    pega da filha; se vazio, busca da mãe (chamada separada se necessário)
 *
 * Lança se após o fallback ainda faltar legenda ou link (D-07).
 *
 * @param {object} task - Task da filha (com custom_fields)
 * @returns {Promise<{legenda: string, linkDoPost: string}>}
 * @throws {Error} Se legenda ou link não puderem ser resolvidos
 */
export async function resolveContent(task) {
  const taskLog = withContext({ module: 'scheduler', taskId: task.id, action: 'resolveContent' });

  let legenda    = readCF(task, config.CF_LEGENDA);
  let linkDoPost = readCF(task, config.CF_LINK_DO_POST);

  const needsFallback = !legenda || !linkDoPost;

  if (needsFallback) {
    const idMae = readCF(task, config.CF_ID_TASK_MAE);
    if (!idMae) {
      // Sem task mãe: só lança se o campo ainda faltando
      const missing = [];
      if (!legenda) missing.push('CF_LEGENDA');
      if (!linkDoPost) missing.push('CF_LINK_DO_POST');
      throw new Error(`Conteúdo incompleto na task filha sem mãe: ${missing.join(', ')} vazio(s)`);
    }

    taskLog.info({ step: 'resolveContent.fallback', motherTaskId: idMae }, 'Buscando conteúdo da task mãe');
    const motherTask = await clickup.getTask(idMae);

    // Fallback campo-a-campo independente (D-04/D-05/D-06)
    if (!legenda) {
      legenda = readCF(motherTask, config.CF_LEGENDA);
    }
    if (!linkDoPost) {
      linkDoPost = readCF(motherTask, config.CF_LINK_DO_POST);
    }
  }

  // D-07: se após o fallback ainda faltar → erro de validação
  const missing = [];
  if (!legenda) missing.push('CF_LEGENDA');
  if (!linkDoPost) missing.push('CF_LINK_DO_POST');
  if (missing.length > 0) {
    throw new Error(`Conteúdo incompleto após fallback para task mãe: ${missing.join(', ')} vazio(s)`);
  }

  return { legenda, linkDoPost };
}

/**
 * Processa uma task elegível:
 *   resolveContent → mapFormato → downloadAndExtract → uploadMedia → createPost → write-back
 *
 * @param {object} task - Task ClickUp com custom_fields
 * @param {Map<number, string>} formatoOptionsMap - Mapa orderindex→label do campo Formato
 * @returns {Promise<void>}
 */
export async function processTask(task, formatoOptionsMap) {
  const taskLog = withContext({ module: 'scheduler', taskId: task.id, action: 'processTask' });

  taskLog.info({ step: 'start' }, 'Iniciando processamento da task');

  // --- 1. Resolver conteúdo (legenda + link do post) com fallback para mãe ---
  const { legenda, linkDoPost } = await resolveContent(task);

  // --- 2. Mapear Formato → tipo GHL ---
  const formatoOrderindex = readCF(task, config.CF_FORMATO);
  // formatoOptionsMap é um Map<orderindex, label> construído pelo runSchedulerBatch via getListFields
  const formatoLabel = formatoOptionsMap.get(Number(formatoOrderindex));
  if (!formatoLabel) {
    throw new Error(
      `Formato não resolvido: orderindex "${formatoOrderindex}" não encontrado no mapa de opções. ` +
      `Opções disponíveis: ${JSON.stringify(Object.fromEntries(formatoOptionsMap))}`,
    );
  }
  const { ghlType } = mapFormato(formatoLabel);

  // --- 3. Data de publicação: epochMs string → ISO string (Pitfall 3) ---
  const epochMs = readCF(task, config.CF_DATA_PUBLICACAO);
  if (!epochMs) {
    throw new Error('Data de publicação vazia — task não deveria ter passado no filtro de elegibilidade');
  }
  const scheduleDate = new Date(Number(epochMs)).toISOString();

  // --- 4. Download + extração do zip (com guardas de segurança em zip.js) ---
  let tmpDir;
  try {
    taskLog.info({ step: 'downloadExtract' }, 'Baixando e extraindo zip do MinIO');
    // NUNCA logar linkDoPost — apenas taskId no contexto acima (T-02-03)
    const extracted = await downloadAndExtract(linkDoPost);
    tmpDir = extracted.tmpDir;
    const { files } = extracted;

    if (files.length === 0) {
      throw new Error('Zip extraído não contém arquivos de mídia válidos');
    }

    // --- 5. Upload de mídia para a media library do GHL ---
    // Plano 02: mídia única (Reels/Feed estático = primeiro arquivo)
    // Plano 03 estenderá para múltiplos arquivos (Carrossel)
    const mediaUrls = [];
    for (const file of files) {
      taskLog.info({ step: 'uploadMedia', fileName: file.name }, 'Fazendo upload de mídia para o GHL');
      const mime = mimeFromFilename(file.name);
      const { url } = await ghl.uploadMedia(file.buffer, file.name, mime);
      mediaUrls.push({ url, type: mime });
    }

    // --- 6. Criar post agendado no GHL (SCH-04) ---
    // CRÍTICO: payload DEVE incluir userId (422 sem ele — Finding 1 do Wave 0)
    const payload = {
      accountIds:   [config.GHL_ACCOUNT_ID],
      userId:       config.GHL_USER_ID,
      summary:      legenda,
      type:         ghlType,
      scheduleDate: scheduleDate,
      media:        mediaUrls.slice(0, 1), // mídia única neste plano; Plano 03 envia todas
      status:       'scheduled',
    };

    taskLog.info({ step: 'createPost', ghlType, mediaCount: mediaUrls.length }, 'Criando post agendado no GHL');
    const res = await ghl.createPost(payload);

    // Extrair post id (Pitfall 7 confirmado empiricamente — Wave 0 Finding 2):
    // id em res.results.post._id; fallback defensivo para res.post._id
    const postId = res?.results?.post?._id ?? res?.post?._id;
    if (!postId) {
      throw new Error(
        `createPost retornou sucesso mas post._id está ausente. ` +
        `Response shape: ${JSON.stringify(Object.keys(res ?? {}))}`,
      );
    }

    // --- 7. Write-back de sucesso (SCH-05) ---
    // Ordem obrigatória: createPost → updateTask → setCustomField (Pitfall anti-pattern)
    taskLog.info({ step: 'writeback.status' }, 'Atualizando status para agendado no ClickUp');
    await clickup.updateTask(task.id, { status: config.STATUS_AGENDADO });

    taskLog.info({ step: 'writeback.postId' }, 'Gravando GHL Post ID no ClickUp');
    await clickup.setCustomField(task.id, config.CF_GHL_POST_ID, postId);

    taskLog.info({ step: 'done', postId }, 'Task agendada com sucesso');

  } finally {
    // D-11: limpeza do diretório temporário em QUALQUER cenário (sucesso ou falha)
    if (tmpDir) await cleanupTmp(tmpDir);
  }
}

/**
 * Executa uma passada batch sobre as tasks elegíveis da lista ClickUp.
 *
 * Cada task é processada de forma isolada — erro em uma task não aborta as demais (D-18).
 * Write-back de erro: mantém status 'a agendar' e registra mensagem curta em CF_ERRO_PUBLICACAO
 * (write-back completo de erro detalhado é competência do Plano 03; aqui basta log+continue).
 *
 * @returns {Promise<void>}
 */
export async function runSchedulerBatch() {
  log.info({ step: 'start' }, 'Iniciando passada batch do scheduler');

  // --- 1. Buscar tasks com status 'a agendar' ---
  const tasks = await clickup.getListTasks(config.CLICKUP_LIST_ID, config.STATUS_A_AGENDAR);
  log.info({ step: 'getListTasks', count: tasks.length }, `${tasks.length} task(s) com status '${config.STATUS_A_AGENDAR}' encontrada(s)`);

  // --- 2. Bootstrap: mapa orderindex→label para o campo Formato (Pitfall 2) ---
  // O ClickUp armazena o valor de campos dropdown como orderindex (número),
  // não como label nem UUID. O mapa é construído via getListFields.
  const formatoOptionsMap = new Map(); // Map<orderindex: number, label: string>
  try {
    const fieldsResult = await clickup.getListFields(config.CLICKUP_LIST_ID);
    const fields = fieldsResult?.fields ?? (Array.isArray(fieldsResult) ? fieldsResult : []);
    const formatoField = fields.find((f) => f.id === config.CF_FORMATO);
    if (formatoField) {
      const options = formatoField?.type_config?.options ?? [];
      for (const opt of options) {
        // orderindex pode ser 0-based integer ou estar em opt.orderindex
        const idx = opt.orderindex ?? opt.order ?? null;
        const label = opt.name ?? opt.label ?? opt.value;
        if (idx !== null && label) {
          formatoOptionsMap.set(Number(idx), label);
        }
      }
      log.info({ step: 'formatoMap', options: formatoOptionsMap.size }, 'Mapa de opções do Formato carregado');
    } else {
      log.warn({ step: 'formatoMap' }, 'Campo Formato não encontrado nos custom fields — Formato será inválido para todas as tasks');
    }
  } catch (err) {
    // Não abortar o batch por falha no bootstrap do Formato
    log.warn({ step: 'formatoMap', err: err?.message }, 'Falha ao carregar mapa de opções do Formato — continuando');
  }

  // --- 3. Filtro de elegibilidade (SCH-01 + SCH-06/D-02) ---
  // Elegível = Data de publicação preenchida E CF_GHL_POST_ID vazio
  // (idempotência ANTES de qualquer chamada ao GHL)
  const eligibleTasks = tasks.filter((t) => {
    const dataPublicacao = readCF(t, config.CF_DATA_PUBLICACAO);
    const ghlPostId      = readCF(t, config.CF_GHL_POST_ID);

    // Deve ter data de publicação
    if (!dataPublicacao) return false;

    // Não deve ter GHL Post ID já preenchido (idempotência)
    if (ghlPostId) return false;

    return true;
  });

  log.info({ step: 'filter', eligible: eligibleTasks.length, total: tasks.length }, `${eligibleTasks.length} task(s) elegível(is) para agendamento`);

  if (eligibleTasks.length === 0) {
    log.info({ step: 'done' }, 'Nenhuma task elegível — batch concluído sem ações');
    return;
  }

  // --- 4. Processar cada task elegível de forma isolada ---
  for (const task of eligibleTasks) {
    try {
      await processTask(task, formatoOptionsMap);
    } catch (err) {
      const taskLog = withContext({ module: 'scheduler', taskId: task.id });
      const mensagem = err?.message
        ? String(err.message).slice(0, 200)
        : 'Erro desconhecido';
      taskLog.error({ step: 'processTask.error', err: mensagem }, 'Falha ao processar task — continuando batch');
      // Write-back de erro básico: não muda status, só loga
      // (write-back completo de erro para CF_ERRO_PUBLICACAO é competência do Plano 03)
    }
  }

  log.info({ step: 'done' }, 'Passada batch concluída');
}
