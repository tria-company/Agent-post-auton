/**
 * src/scheduler/pipeline.js
 *
 * Orquestrador batch do pipeline de agendamento ClickUp → GHL (Phase 2).
 *
 * Fluxo principal (runSchedulerBatch):
 *   1. getListTasks: lê tasks com status 'agendado' da lista ClickUp (SCH-01)
 *      [UAT decision: o humano move para 'agendado' para acionar o agendamento]
 *   2. Bootstrap: getListFields para montar mapa orderindex→label do campo Formato (Pitfall 2)
 *   3. Filtro de elegibilidade: Data de publicação preenchida + CF_GHL_POST_ID vazio (SCH-06/D-02)
 *   4. processTask para cada task elegível, isolada em try/catch (D-18)
 *
 * processTask:
 *   1. resolveContent: legenda + link com fallback campo-a-campo para task mãe (SCH-02/D-04/D-05/D-06)
 *   2. mapFormato: orderindex → {ghlType, mediaCount}
 *   3. Validação: data no passado, Formato vazio/Stories/desconhecido, legenda/mídia ausente (D-13/D-14)
 *   4. downloadAndExtract com zip-slip/SSRF/magic-bytes guards (SCH-03)
 *   5. uploadMedia para cada arquivo extraído — Carrossel: todos os arquivos em ordem numérica (SCH-04/D-10)
 *                                              Reels/Feed: arquivo único (primeiro)
 *   6. createPost agendado no GHL Social Planner com userId (CRÍTICO) (SCH-04)
 *      - type: 'post' | 'reel' (NUNCA 'carousel' — Pitfall 1/A1)
 *      - media[]: todos os arquivos para Carrossel, 1 arquivo para Reels/Feed (D-10)
 *   7. write-back de sucesso: setCustomField(CF_GHL_POST_ID) → addComment('✅ Agendado no GHL…') (SCH-05)
 *      [status permanece 'agendado' — task já estava neste status quando detectada]
 *   8. try/finally: cleanupTmp sempre executado (D-11)
 *
 * Falha de validação / erro GHL/MinIO (UAT decision — estado invertido):
 *   - updateTask(STATUS_A_AGENDAR): devolve a task ao estado inicial para retry (defensivo)
 *   - setCustomField(CF_ERRO_PUBLICACAO, mensagemCurta): registra o erro
 *   - addComment('❌ Falha ao agendar…'): comentário visível no card
 *   - Mensagem curta, sem stack trace, sem URL, sem token (D-15/T-02-03)
 *   - Cada write-back de falha é defensivo — se um lança, loga e continua para o próximo (D-18)
 *   - Falha isolada não aborta o batch (D-18/T-02-10)
 *
 * Segurança:
 *   - NUNCA logar zipUrl/link do MinIO — só taskId e fileName (T-02-03)
 *   - Tokens e headers auth redactados pelo logger (T-01-02, configurado em logger.js)
 *   - Mensagem de Erro de publicação derivada de AppError.message ou String(err.message) — sem body bruto
 *   - Truncada a MAX_ERRO_MSG_LEN chars; defensivamente sem http/pit-/pk_
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
import { AppError, translateError } from '../lib/errors.js';
import { clickup } from '../clients/clickup.js';
import { ghl } from '../clients/ghl.js';
import { downloadAndExtract, cleanupTmp, mimeFromFilename } from '../lib/zip.js';

const log = withContext({ module: 'scheduler', action: 'runSchedulerBatch' });

// Comprimento máximo da mensagem de Erro de publicação (D-15/T-02-03)
const MAX_ERRO_MSG_LEN = 200;

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

// Formatos explicitamente inválidos nesta fase (D-13)
const FORMATO_INVALIDO = new Set(['Stories']);

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
 * Lança com mensagem curta e segura se o formato for vazio, inválido (Stories — D-13) ou desconhecido.
 *
 * @param {string | null | undefined} name - Label do formato (ex: 'Reels', 'Feed estático')
 * @returns {{ghlType: 'post'|'reel', mediaCount: 'single'|'multiple'}}
 * @throws {Error} Se o formato não for suportado (mensagem segura para Erro de publicação)
 */
export function mapFormato(name) {
  // Formato vazio/null → falha de validação (D-13)
  if (!name || String(name).trim() === '') {
    throw new Error('Formato vazio');
  }
  // Formato explicitamente inválido (Stories — D-13)
  if (FORMATO_INVALIDO.has(name)) {
    throw new Error(`Formato ${name} não suportado`);
  }
  const mapped = FORMATO_MAP[name];
  if (!mapped) {
    throw new Error(`Formato ${name} não suportado`);
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
  // Validação de Formato ANTES de qualquer chamada ao GHL (D-13)
  const formatoOrderindex = readCF(task, config.CF_FORMATO);
  // formatoOptionsMap é um Map<orderindex, label> construído pelo runSchedulerBatch via getListFields
  const formatoLabel = formatoOrderindex !== null && formatoOrderindex !== undefined
    ? (formatoOptionsMap.get(Number(formatoOrderindex)) ?? null)
    : null;
  if (!formatoLabel) {
    throw new Error('Formato vazio');
  }
  // mapFormato lança para Stories e desconhecidos com mensagem segura (D-13)
  const { ghlType, mediaCount } = mapFormato(formatoLabel);

  // --- 3. Data de publicação: epochMs string → ISO string (Pitfall 3) ---
  // Validação de data ANTES de chamar o GHL (D-14)
  const epochMs = readCF(task, config.CF_DATA_PUBLICACAO);
  if (!epochMs) {
    throw new Error('Data de publicação vazia — task não deveria ter passado no filtro de elegibilidade');
  }
  const scheduleDateMs = Number(epochMs);
  if (scheduleDateMs < Date.now()) {
    throw new Error('Data no passado');
  }
  const scheduleDate = new Date(scheduleDateMs).toISOString();

  // --- 4. Download + extração do zip (com guardas de segurança em zip.js) ---
  let tmpDir;
  try {
    taskLog.info({ step: 'downloadExtract' }, 'Baixando e extraindo zip do MinIO');
    // NUNCA logar linkDoPost — apenas taskId no contexto acima (T-02-03)
    const extracted = await downloadAndExtract(linkDoPost);
    tmpDir = extracted.tmpDir;
    const { files } = extracted;

    if (files.length === 0) {
      throw new Error('Sem mídia após fallback');
    }

    // --- 5. Separar capa (cover/thumbnail) dos arquivos de mídia ---
    // A capa é identificada pelo basename (case-insensitive) correspondendo a
    // capa.<ext> ou cover.<ext> com extensão de imagem.
    // Ela se aplica APENAS a Reels — em outros formatos é simplesmente descartada.
    // A capa NUNCA deve aparecer como slide em media[] (excluída de filesToUpload).
    const COVER_REGEX = /^(capa|cover)\.(jpe?g|png|webp)$/i;
    const coverFile = files.find((f) => COVER_REGEX.test(f.name)) ?? null;
    const mediaFiles = files.filter((f) => !COVER_REGEX.test(f.name));

    if (mediaFiles.length === 0) {
      throw new Error('Sem mídia após fallback');
    }

    // --- 6. Upload de mídia para a media library do GHL (SCH-04/D-10) ---
    // Carrossel (mediaCount='multiple'): fazer upload de TODOS os arquivos em ordem numérica
    // Reels/Feed estático (mediaCount='single'): usar apenas o primeiro arquivo
    // downloadAndExtract já retorna os arquivos ordenados numericamente.
    const filesToUpload = mediaCount === 'multiple' ? mediaFiles : mediaFiles.slice(0, 1);
    const mediaItems = [];
    for (const file of filesToUpload) {
      const mime = mimeFromFilename(file.name);
      // Limites de upload do GHL (HTTP 413 acima disso): vídeo 500MB, imagem 25MB.
      // Validar ANTES do upload para dar mensagem clara em PT em vez do "413" cru.
      const isVideo = mime.startsWith('video/');
      const maxBytes = (isVideo ? 500 : 25) * 1024 * 1024;
      if (file.buffer.length > maxBytes) {
        const mb = (file.buffer.length / 1024 / 1024).toFixed(1);
        throw new Error(
          `${isVideo ? 'Vídeo' : 'Imagem'} "${file.name}" excede o limite do GHL ` +
          `(${isVideo ? '500MB' : '25MB'}; recebido ${mb}MB) — comprima o arquivo`,
        );
      }
      taskLog.info({ step: 'uploadMedia', fileName: file.name }, 'Fazendo upload de mídia para o GHL');
      const { url } = await ghl.uploadMedia(file.buffer, file.name, mime);
      mediaItems.push({ url, type: mime });
    }

    // --- 6b. Reel cover/thumbnail ---
    // Aplica-se somente quando ghlType === 'reel' E uma capa foi encontrada.
    //
    // CAVEAT EMPÍRICO: o campo correto para o thumbnail do Reel no GHL ainda NÃO foi
    // confirmado em produção (apenas type='post' para Carrossel foi validado). O campo
    // `media[].thumbnail` é nossa melhor estimativa com base na documentação disponível.
    // Se o GHL rejeitar (ex: 422) ou ignorar, inspecionar o response completo e ajustar
    // este campo. Outros candidatos: campo top-level `cover`, `instagramPostDetails.thumbnail`.
    // PONTO ÚNICO DE MUDANÇA — ajustar apenas aqui se o campo for diferente.
    if (ghlType === 'reel' && coverFile) {
      taskLog.info({ step: 'reelCover', fileName: coverFile.name }, 'Fazendo upload da capa do Reel');
      const coverMime = mimeFromFilename(coverFile.name);
      const { url: coverUrl } = await ghl.uploadMedia(coverFile.buffer, coverFile.name, coverMime);
      // Anexar thumbnail ao item de vídeo (mediaItems[0] = o único vídeo do Reel)
      // CAMPO: media[0].thumbnail — estimativa; confirmar na primeira run real.
      mediaItems[0].thumbnail = coverUrl;
      taskLog.info({ step: 'reelCover' }, 'Capa do Reel anexada ao payload (media[0].thumbnail)');
    }

    // --- 6c. Colaborador do Instagram (Collab Post) ---
    // Feed (incl. Carrossel) e Reels ACEITAM colaborador (confirmado em produção pelo usuário).
    // Stories não suporta — mas Stories já é rejeitado em mapFormato, então não chega aqui.
    // Formato do GHL confirmado em posts reais:
    //   instagramPostDetails.collaborators = { [GHL_ACCOUNT_ID]: ["username", ...] }
    // O username vai SEM @. O campo CF_COLABORADOR é opcional (nem todo post tem collab).
    let instagramPostDetails;
    if (config.CF_COLABORADOR) {
      const rawColab = readCF(task, config.CF_COLABORADOR);
      if (rawColab) {
        const usernames = String(rawColab)
          .split(',')
          .map((u) => u.trim().replace(/^@/, ''))
          .filter(Boolean);
        if (usernames.length > 0) {
          // IG permite 1 colaborador por post; mandamos a lista e o GHL/IG aplica/valida.
          instagramPostDetails = {
            collaborators: { [config.GHL_ACCOUNT_ID]: usernames },
          };
          taskLog.info({ step: 'collaborator', count: usernames.length }, 'Adicionando colaborador(es) IG ao post');
        }
      }
    }

    // --- 7. Criar post agendado no GHL (SCH-04) ---
    // CRÍTICO: payload DEVE incluir userId (422 sem ele — Finding 1 do Wave 0)
    // type: 'post' | 'reel' — NUNCA 'carousel' (Pitfall 1/A1)
    // media[]: todos os arquivos para Carrossel, 1 para Reels/Feed (D-10)
    const payload = {
      accountIds:   [config.GHL_ACCOUNT_ID],
      userId:       config.GHL_USER_ID,
      summary:      legenda,
      type:         ghlType,
      scheduleDate: scheduleDate,
      media:        mediaItems,
      status:       'scheduled',
      ...(instagramPostDetails ? { instagramPostDetails } : {}),
    };

    taskLog.info({ step: 'createPost', ghlType, mediaCount: mediaItems.length }, 'Criando post agendado no GHL');
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

    // --- 8. Write-back de sucesso (SCH-05) ---
    // Ordem: createPost → setCustomField(GHL Post ID) → addComment
    // Status NÃO é alterado — a task já está em STATUS_AGENDADO (humano a moveu para acionar).
    // O marcador de idempotência (CF_GHL_POST_ID) impede re-agendamento em futuras passadas.
    taskLog.info({ step: 'writeback.postId' }, 'Gravando GHL Post ID no ClickUp');
    await clickup.setCustomField(task.id, config.CF_GHL_POST_ID, postId);

    taskLog.info({ step: 'writeback.comment' }, 'Adicionando comentário de sucesso no ClickUp');
    try {
      await clickup.addComment(task.id, `✅ Agendado no GHL — post id: ${postId}`);
    } catch (commentErr) {
      // Comentário de sucesso é não-fatal — se falhar, logar e continuar
      taskLog.warn(
        { step: 'writeback.comment.error', commentErrMsg: commentErr?.message },
        'Falha ao adicionar comentário de sucesso no ClickUp — continuando',
      );
    }

    taskLog.info({ step: 'done', postId }, 'Task agendada com sucesso');

  } finally {
    // D-11: limpeza do diretório temporário em QUALQUER cenário (sucesso ou falha)
    if (tmpDir) await cleanupTmp(tmpDir);
  }
}

/**
 * Write-back de falha de agendamento — COMPARTILHADO pelo batch (runSchedulerBatch)
 * e pelo handler de webhook (src/server/routes/clickup.js). Garante o mesmo comportamento
 * nos dois caminhos (correção do bug de integração 03-02 — o webhook só logava, sem write-back):
 *   1. updateTask(STATUS_A_AGENDAR) — devolve a task para correção/retry
 *   2. setCustomField(CF_ERRO_PUBLICACAO, mensagem curta e segura)
 *   3. addComment(❌ ...) — visível no card
 * Cada passo é defensivo (D-18): se um lança, loga e segue.
 *
 * @param {{ id: string }} task
 * @param {unknown} err
 * @returns {Promise<void>}
 */
export async function writeBackFailure(task, err) {
  const taskLog = withContext({ module: 'scheduler', taskId: task.id });

  const rawMsg = err instanceof AppError
    ? err.message
    : String(err?.message ?? 'Erro desconhecido');
  // Traduz erros conhecidos do GHL/ClickUp para PT antes de exibir no ClickUp.
  // (Nossas mensagens de validação já estão em PT e passam intactas.)
  const mensagem = translateError(rawMsg).slice(0, MAX_ERRO_MSG_LEN);

  taskLog.warn({ step: 'processTask.error', errMsg: mensagem }, 'Falha ao processar task');

  try {
    await clickup.updateTask(task.id, { status: config.STATUS_A_AGENDAR });
  } catch (updateErr) {
    taskLog.warn(
      { step: 'processTask.writeback.updateTask.error', updateErrMsg: updateErr?.message },
      'Falha ao devolver task para a agendar',
    );
  }

  try {
    await clickup.setCustomField(task.id, config.CF_ERRO_PUBLICACAO, mensagem);
  } catch (writebackErr) {
    taskLog.warn(
      { step: 'processTask.writeback.error', writebackErrMsg: writebackErr?.message },
      'Falha ao gravar Erro de publicação no ClickUp',
    );
  }

  try {
    await clickup.addComment(task.id, `❌ Falha ao agendar: ${mensagem}`);
  } catch (commentErr) {
    taskLog.warn(
      { step: 'processTask.comment.error', commentErrMsg: commentErr?.message },
      'Falha ao adicionar comentário no ClickUp',
    );
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

  // --- 1. Buscar tasks com status 'agendado' ---
  // O humano move uma task para STATUS_AGENDADO para acionar o agendamento no GHL (UAT decision).
  const tasks = await clickup.getListTasks(config.CLICKUP_LIST_ID, config.STATUS_AGENDADO);
  log.info({ step: 'getListTasks', count: tasks.length }, `${tasks.length} task(s) com status '${config.STATUS_AGENDADO}' encontrada(s)`);

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

  // --- 3a. Filtro de task única (override operacional via SCHEDULER_ONLY_TASK_ID) ---
  // Quando a variável está definida, restringe o processamento a uma única task por id.
  // Não altera o comportamento padrão quando a variável está ausente.
  const onlyTaskId = process.env.SCHEDULER_ONLY_TASK_ID || '';
  let candidateTasks = tasks;
  if (onlyTaskId) {
    log.info({ step: 'singleTaskFilter', onlyTaskId }, `modo task única: ${onlyTaskId}`);
    const found = tasks.find((t) => t.id === onlyTaskId);
    if (!found) {
      log.warn({ step: 'singleTaskFilter', onlyTaskId }, `task ${onlyTaskId} não encontrada em '${config.STATUS_AGENDADO}'`);
      candidateTasks = [];
    } else {
      candidateTasks = [found];
    }
  }

  // --- 3b. Filtro de elegibilidade (SCH-01 + SCH-06/D-02) ---
  // Elegível = Data de publicação preenchida E CF_GHL_POST_ID vazio
  // (idempotência ANTES de qualquer chamada ao GHL)
  const eligibleTasks = candidateTasks.filter((t) => {
    const dataPublicacao = readCF(t, config.CF_DATA_PUBLICACAO);
    const ghlPostId      = readCF(t, config.CF_GHL_POST_ID);

    // Deve ter data de publicação
    if (!dataPublicacao) return false;

    // Não deve ter GHL Post ID já preenchido (idempotência)
    if (ghlPostId) return false;

    return true;
  });

  log.info({ step: 'filter', eligible: eligibleTasks.length, total: candidateTasks.length }, `${eligibleTasks.length} task(s) elegível(is) para agendamento`);

  if (eligibleTasks.length === 0) {
    log.info({ step: 'done' }, 'Nenhuma task elegível — batch concluído sem ações');
    return;
  }

  // --- 4. Processar cada task elegível de forma isolada ---
  for (const task of eligibleTasks) {
    try {
      await processTask(task, formatoOptionsMap);
    } catch (err) {
      // Write-back de falha compartilhado (batch + webhook) — isola cada task (D-18).
      await writeBackFailure(task, err);
    }
  }

  log.info({ step: 'done' }, 'Passada batch concluída');
}
