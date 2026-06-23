/**
 * src/poller/ghlStatusPoller.js
 *
 * GHL → ClickUp status sync via POLLING (Plan 03-03).
 *
 * SYNC-02 N/A: GHL does not emit post webhooks — this module polls the GHL API
 * directly using the app token. No webhook signature verification is needed here;
 * authentication is the outbound GHL_TOKEN on every getPost call.
 *
 * Eligibility:
 *   Tasks in STATUS_AGENDADO with CF_GHL_POST_ID non-empty.
 *
 * Published (publishedAt != null — primary signal per OQ1/D-OQ1-STATUS):
 *   → updateTask(STATUS_PUBLICADO)
 *   → setCustomField(CF_IG_MEDIA_ID, igMediaId)  [if present]
 *   → setCustomField(CF_LINK_PUBLICADO, permalink)  [if present]
 *   → addComment ✅
 *   → log full results.post JSON once per published detection (first time only)
 *
 * Failed (status === 'failed'):
 *   → updateTask(STATUS_A_AGENDAR)
 *   → setCustomField(CF_ERRO_PUBLICACAO, msg ≤ 200 chars, sanitized)
 *   → setCustomField(CF_GHL_POST_ID, '')  — clears anchor for retry (D-01)
 *   → addComment ❌
 *
 * Deleted (results.post.deleted === true):
 *   → SKIP — do not treat as failure (D-OQ1-DELETED)
 *
 * Idempotency (SYNC-06):
 *   DedupeStore keyed by `postId:published` or `postId:failed` (TTL 2h).
 *   Prevents write-back duplication across polling passes.
 *
 * Isolation (D-18):
 *   Each task processed inside try/catch — one failure does not abort the pass.
 *
 * Exports: pollGhlPosts()
 */

import { config } from '../config/index.js';
import { withContext } from '../lib/logger.js';
import { clickup } from '../clients/clickup.js';
import { ghl } from '../clients/ghl.js';
import { readCF } from '../scheduler/pipeline.js';
import { DedupeStore } from '../server/dedupe.js';

const log = withContext({ module: 'poller' });

// Comprimento máximo da mensagem de erro — alinhado com pipeline.js (D-15/T-02-03)
const MAX_ERRO_MSG_LEN = 200;

// Dedup store com TTL de 2 horas — módulo-level singleton (SYNC-06)
const ghlDedup = new DedupeStore(2 * 60 * 60 * 1000);

// Flag para logar o shape completo do post apenas na primeira detecção de publicado
// (por invocação do módulo — confirmar nomes reais dos campos IG em produção)
let _loggedPublishedShape = false;

/**
 * Sanitiza e trunca uma mensagem de erro para uso em campos/comentários do ClickUp.
 * Remove URLs (http/https) e prefixos de token (pit-/pk_) — D-15/T-02-03.
 *
 * @param {string} raw
 * @returns {string}
 */
function sanitizeErrorMsg(raw) {
  return String(raw ?? 'Erro desconhecido')
    .replace(/https?:\/\/\S*/g, '[URL]')
    .replace(/pit-\S*/g, '[TOKEN]')
    .replace(/pk_\S*/g, '[TOKEN]')
    .slice(0, MAX_ERRO_MSG_LEN);
}

/**
 * Resolve os campos IG de um post GHL de forma defensiva (OQ1 / D-OQ1-INSTAGRAMDETAILS).
 *
 * Estratégia (campos não confirmados para posts publicados — smoke só viu scheduled):
 *   1. instagramPostDetails.igMediaId / instagramPostDetails.instagramMediaId
 *   2. Top-level: igMediaId / instagramMediaId
 *   Permalink:
 *   1. instagramPostDetails.permalink / instagramPostDetails.postUrl
 *   2. Top-level: permalink / postUrl
 *
 * @param {object} post - results.post
 * @returns {{ igMediaId: string|null, permalink: string|null }}
 */
function resolveIgFields(post) {
  const details = post.instagramPostDetails ?? {};

  const igMediaId =
    details.igMediaId ??
    details.instagramMediaId ??
    post.igMediaId ??
    post.instagramMediaId ??
    null;

  const permalink =
    details.permalink ??
    details.postUrl ??
    post.permalink ??
    post.postUrl ??
    null;

  return { igMediaId, permalink };
}

/**
 * Resolve a mensagem de erro de um post GHL com falha de forma defensiva.
 *
 * @param {object} post - results.post
 * @returns {string}
 */
function resolveFailureReason(post) {
  const details = post.instagramPostDetails ?? {};
  const raw =
    details.failureReason ??
    details.error ??
    post.failureReason ??
    post.error ??
    `GHL post status: ${post.status ?? 'failed'}`;
  return sanitizeErrorMsg(raw);
}

/**
 * Write-back para post publicado (SYNC-04/D-02).
 *
 * @param {object} task - Task ClickUp
 * @param {object} post - results.post
 */
async function writeBackPublicado(task, post) {
  const taskLog = withContext({ module: 'poller', taskId: task.id, action: 'writeBackPublicado' });

  // Log do shape completo apenas na primeira vez (OQ1 — confirmar campos reais em produção)
  if (!_loggedPublishedShape) {
    _loggedPublishedShape = true;
    taskLog.info({ publishedPostShape: post }, 'Primeira detecção de post publicado — shape completo para confirmar campos IG reais');
  }

  const { igMediaId, permalink } = resolveIgFields(post);

  taskLog.info({ step: 'updateTask', status: config.STATUS_PUBLICADO }, 'Movendo task para STATUS_PUBLICADO');
  await clickup.updateTask(task.id, { status: config.STATUS_PUBLICADO });

  // Só grava campos IG se tiverem valor (não gravar null — teste 3)
  if (igMediaId != null) {
    taskLog.info({ step: 'setIgMediaId' }, 'Gravando IG Media ID');
    await clickup.setCustomField(task.id, config.CF_IG_MEDIA_ID, igMediaId);
  }

  if (permalink != null) {
    taskLog.info({ step: 'setLinkPublicado' }, 'Gravando link publicado');
    await clickup.setCustomField(task.id, config.CF_LINK_PUBLICADO, permalink);
  }

  const commentText = `✅ Post publicado no Instagram — publishedAt: ${post.publishedAt ?? 'desconhecido'}`;
  try {
    await clickup.addComment(task.id, commentText);
  } catch (commentErr) {
    taskLog.warn({ step: 'addComment.error', err: commentErr?.message }, 'Falha ao adicionar comentário ✅ — continuando');
  }

  taskLog.info({ step: 'done' }, 'Write-back de publicado concluído');
}

/**
 * Write-back para post com falha (SYNC-05/D-01).
 *
 * @param {object} task - Task ClickUp
 * @param {object} post - results.post
 */
async function writeBackFalha(task, post) {
  const taskLog = withContext({ module: 'poller', taskId: task.id, action: 'writeBackFalha' });

  const mensagem = resolveFailureReason(post);

  taskLog.info({ step: 'updateTask', status: config.STATUS_A_AGENDAR }, 'Devolvendo task para STATUS_A_AGENDAR (falha de publicação)');
  await clickup.updateTask(task.id, { status: config.STATUS_A_AGENDAR });

  taskLog.info({ step: 'setErroPublicacao' }, 'Gravando Erro de publicação');
  try {
    await clickup.setCustomField(task.id, config.CF_ERRO_PUBLICACAO, mensagem);
  } catch (erroErr) {
    taskLog.warn({ step: 'setErroPublicacao.error', err: erroErr?.message }, 'Falha ao gravar erro — continuando');
  }

  // Limpa CF_GHL_POST_ID para permitir retry (D-01)
  taskLog.info({ step: 'clearGhlPostId' }, 'Limpando CF_GHL_POST_ID para retry (D-01)');
  try {
    await clickup.setCustomField(task.id, config.CF_GHL_POST_ID, '');
  } catch (clearErr) {
    taskLog.warn({ step: 'clearGhlPostId.error', err: clearErr?.message }, 'Falha ao limpar GHL Post ID — continuando');
  }

  const commentText = `❌ Falha na publicação: ${mensagem}`;
  try {
    await clickup.addComment(task.id, commentText);
  } catch (commentErr) {
    taskLog.warn({ step: 'addComment.error', err: commentErr?.message }, 'Falha ao adicionar comentário ❌ — continuando');
  }

  taskLog.info({ step: 'done' }, 'Write-back de falha concluído');
}

/**
 * Executa uma passada de polling sobre as tasks elegíveis.
 *
 * Uma task é elegível se:
 *   - status === STATUS_AGENDADO
 *   - CF_GHL_POST_ID não-vazio (o post já foi criado no GHL pelo scheduler)
 *
 * Para cada task elegível:
 *   - ghl.getPost(postId) → interpreta status/publishedAt/deleted
 *   - Deleted → skip (não é falha)
 *   - Published (publishedAt != null) → writeBackPublicado [com dedup postId:published]
 *   - Failed (status === 'failed') → writeBackFalha [com dedup postId:failed]
 *   - Outros (scheduled/pending) → sem ação (aguardar próxima passada)
 *
 * Falha em getListTasks → log.error e retorna imediatamente.
 * Falha em uma task individual → log.warn e continua para a próxima (D-18).
 *
 * @returns {Promise<void>}
 */
export async function pollGhlPosts() {
  log.info({ step: 'start' }, 'Iniciando passada de polling GHL');

  let tasks;
  try {
    tasks = await clickup.getListTasks(config.CLICKUP_LIST_ID, config.STATUS_AGENDADO);
  } catch (err) {
    log.error({ step: 'getListTasks', err: err?.message }, 'Falha ao buscar tasks em STATUS_AGENDADO — abortando passada');
    return;
  }

  // Filtra tasks com CF_GHL_POST_ID preenchido (SYNC-03)
  const eligible = tasks.filter((t) => {
    const postId = readCF(t, config.CF_GHL_POST_ID);
    return postId != null && String(postId).trim() !== '';
  });

  log.info({ step: 'filter', total: tasks.length, eligible: eligible.length }, `${eligible.length} task(s) elegível(is) com GHL Post ID`);

  for (const task of eligible) {
    const taskLog = withContext({ module: 'poller', taskId: task.id });
    const postId = String(readCF(task, config.CF_GHL_POST_ID));

    try {
      const response = await ghl.getPost(postId);
      const post = response?.results?.post;

      if (!post) {
        taskLog.warn({ step: 'getPost', postId }, 'getPost retornou resposta sem results.post — ignorando');
        continue;
      }

      // Deleted → skip (D-OQ1-DELETED)
      if (post.deleted === true) {
        taskLog.info({ step: 'deleted', postId }, 'Post deletado no GHL — ignorando (não é falha)');
        continue;
      }

      // Published: publishedAt != null é o sinal primário (OQ1/D-OQ1-STATUS)
      const isPublished = post.publishedAt != null;
      // Failed: status === 'failed' (e não publicado)
      const isFailed = !isPublished && post.status === 'failed';

      if (isPublished) {
        const dedupKey = `${postId}:published`;
        if (ghlDedup.has(dedupKey)) {
          taskLog.info({ step: 'dedup', dedupKey }, 'Post já processado como publicado — skipping (SYNC-06)');
          continue;
        }
        taskLog.info({ step: 'published', postId }, 'Post detectado como publicado — iniciando write-back');
        await writeBackPublicado(task, post);
        ghlDedup.set(dedupKey);
      } else if (isFailed) {
        const dedupKey = `${postId}:failed`;
        if (ghlDedup.has(dedupKey)) {
          taskLog.info({ step: 'dedup', dedupKey }, 'Post já processado como falha — skipping (SYNC-06)');
          continue;
        }
        taskLog.info({ step: 'failed', postId }, 'Post detectado como com falha — iniciando write-back de falha');
        await writeBackFalha(task, post);
        ghlDedup.set(dedupKey);
      } else {
        // Status intermediário (scheduled/pending) → aguardar próxima passada
        taskLog.info({ step: 'pending', postId, status: post.status }, 'Post ainda pendente — aguardando próxima passada');
      }
    } catch (err) {
      // Isolamento por task (D-18): falha em uma task não aborta a passada
      taskLog.warn({ step: 'task.error', postId, err: err?.message }, 'Erro ao processar task — continuando para a próxima');
    }
  }

  log.info({ step: 'done' }, 'Passada de polling GHL concluída');
}
