/**
 * src/server/routes/clickup.js
 *
 * Handler POST /webhook/clickup — HMAC gate, 200-then-setImmediate, filtro, processTask.
 *
 * Fluxo obrigatório (ordem importa):
 *   1. Verificar HMAC com verifyClickUpSignature sobre rawBody (L-05/TRIG-02).
 *      NUNCA logar x-signature nem CLICKUP_WEBHOOK_SECRET (T-03-07).
 *      Inválido → 401, return. Sem side-effects.
 *   2. JSON.parse(rawBody) APÓS o HMAC passar — 400 se inválido.
 *   3. Responder 200 IMEDIATAMENTE (res.writeHead(200); res.end('OK')) — Pitfall 6.
 *      ClickUp tem timeout curto; resposta tardia → reentrega storm.
 *   4. setImmediate: filtrar evento/status, DedupeStore, getTask, loadFormatoOptionsMap, processTask.
 *      Tudo em try/catch isolado — erro aqui não deve reabrir o socket.
 *
 * Dependências injetáveis (4º arg `deps`) para testabilidade:
 *   - clickupDedup: instância de DedupeStore para ClickUp (TRIG-04)
 *   - loadFormatoOptionsMap: função async () => Map<orderindex, label> (Pitfall 3)
 *   - processTaskOverride: substitui o processTask real nos testes
 *   - webhookSecret: sobrescreve config.CLICKUP_WEBHOOK_SECRET; quando fornecido, força verificação HMAC
 *   - skipSignatureVerify: false → força verificação HMAC mesmo sem webhookSecret
 *
 * HMAC ativo quando: deps.webhookSecret está definido OU deps.skipSignatureVerify === false.
 * Em produção: server/index.js sempre passa webhookSecret = config.CLICKUP_WEBHOOK_SECRET → HMAC ativo.
 *
 * Sem SKIP_SIGNATURE_VERIFY global — D-08 revisado: ingress é Caddy direto.
 * A verificação HMAC ocorre em TODOS os requests de produção (via webhookSecret injetado).
 */
import { config } from '../../config/index.js';
import { withContext } from '../../lib/logger.js';
import { verifyClickUpSignature } from '../verifySignature.js';
import { clickup } from '../../clients/clickup.js';
import { processTask, writeBackFailure } from '../../scheduler/pipeline.js';

const log = withContext({ module: 'webhook.clickup' });

/**
 * Processa a requisição POST /webhook/clickup.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {Buffer} rawBody - Buffer.concat dos chunks (capturado pelo servidor antes do parse)
 * @param {{
 *   clickupDedup: import('../dedupe.js').DedupeStore,
 *   loadFormatoOptionsMap: () => Promise<Map<number,string>>,
 *   processTaskOverride?: (task: object, map: Map<number,string>) => Promise<void>,
 *   webhookSecret?: string,
 *   skipSignatureVerify?: boolean,
 * }} deps - Dependências injetadas pelo servidor (ou stubs em testes)
 */
export async function handleClickUp(req, res, rawBody, deps) {
  const {
    clickupDedup,
    loadFormatoOptionsMap,
    processTaskOverride,
    writeBackFailureOverride,
    webhookSecret,
    skipSignatureVerify,
  } = deps;

  // ---- 1. Verificar HMAC ANTES de qualquer efeito colateral (L-05 / TRIG-02 / T-03-04) ----
  // HMAC ativo quando: webhookSecret injetado (produção + testes com override explícito)
  //                 OU skipSignatureVerify === false (testes que forçam verificação).
  // NUNCA logar sig nem secret (T-03-07).
  const shouldVerifyHmac = webhookSecret !== undefined || skipSignatureVerify === false;
  if (shouldVerifyHmac) {
    const secret = webhookSecret ?? config.CLICKUP_WEBHOOK_SECRET;
    const sig = req.headers['x-signature'];
    if (!verifyClickUpSignature(rawBody, sig, secret)) {
      log.warn({ step: 'hmac.fail' }, 'ClickUp webhook assinatura invalida — 401');
      res.writeHead(401);
      res.end('Unauthorized');
      return;
    }
  }

  // ---- 2. JSON.parse APÓS o HMAC passar ----
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return;
  }

  // ---- 3. Responder 200 IMEDIATAMENTE (Pitfall 6 — evitar reentrega por timeout) ----
  res.writeHead(200);
  res.end('OK');

  // ---- 4. Processar de forma assíncrona em setImmediate, isolado em try/catch ----
  setImmediate(async () => {
    // `task` hoisted para fora do try — necessário no catch para o write-back de falha.
    let task;
    try {
      // Filtro de evento — só processa taskStatusUpdated (TRIG-03)
      if (payload.event !== 'taskStatusUpdated') return;

      // Filtro de status — só processa transição para STATUS_AGENDADO (TRIG-03)
      const item = payload.history_items?.[0];
      if (item?.after?.status !== config.STATUS_AGENDADO) return;

      // Idempotência — chave webhook_id:history_item_id (TRIG-04)
      const dedupKey = `${payload.webhook_id}:${item.id}`;
      if (clickupDedup.has(dedupKey)) {
        log.info({ dedupKey }, 'Reentrega ignorada (dedup)');
        return;
      }
      clickupDedup.set(dedupKey);

      // getTask obrigatório — payload do webhook não tem custom_fields (Pitfall 2)
      task = await clickup.getTask(payload.task_id);

      // Carregar mapa orderindex→label do campo Formato (Pitfall 3)
      const formatoOptionsMap = await loadFormatoOptionsMap();

      // Disparar o pipeline de agendamento (L-04 — REUSO 100%)
      const processFn = processTaskOverride ?? processTask;
      await processFn(task, formatoOptionsMap);

      log.info({ taskId: payload.task_id, dedupKey }, 'Task agendada via webhook');
    } catch (err) {
      log.error({ err: err.message, taskId: payload.task_id }, 'Erro no handler ClickUp webhook');
      // Write-back de falha — MESMO comportamento do batch (Erro de publicação + volta pra
      // 'a agendar' + comentário). Antes o handler só logava (bug de integração 03-02).
      // Só é possível se a task já foi buscada (erro depois do getTask, ex.: validação/GHL).
      if (task) {
        try {
          const writeBack = writeBackFailureOverride ?? writeBackFailure;
          await writeBack(task, err);
        } catch (wbErr) {
          log.error({ err: wbErr?.message }, 'Falha no write-back de erro do webhook');
        }
      }
    }
  });
}
