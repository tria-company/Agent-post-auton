/**
 * src/server/index.js
 *
 * Servidor HTTP nativo (node:http, D-05) para o webhook ClickUp → GHL.
 *
 * Responsabilidades:
 *   - Capturar o RAW body (Buffer.concat) ANTES de qualquer parse (Pattern 1)
 *   - Rotear: POST /webhook/clickup → handleClickUp; GET /health → handleHealth; resto → 404
 *   - Instanciar DedupeStore (TTL 10 min) e loadFormatoOptionsMap
 *   - Passar { clickupDedup, loadFormatoOptionsMap, webhookSecret } ao handler
 *     (webhookSecret garante que HMAC é sempre verificado em produção — T-03-04)
 *
 * Entrypoint guard: só inicia o servidor quando executado diretamente (`npm run serve`).
 * Importável sem side-effects para testes e módulos downstream (TRIG-05).
 *
 * PONTO DE INTEGRAÇÃO DO POLLER (Plano 04):
 *   Plano 03-04 importa este módulo e adiciona o setInterval do ghlStatusPoller.
 *   Procurar o comentário "// POLLER_INTEGRATION_POINT" abaixo.
 *
 * `npm start` (runSchedulerBatch, src/index.js) NÃO é alterado (TRIG-05).
 * Este arquivo é usado apenas via `npm run serve` → node src/server/index.js.
 */
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { withContext } from '../lib/logger.js';
import { handleClickUp } from './routes/clickup.js';
import { handleHealth } from './routes/health.js';
import { DedupeStore } from './dedupe.js';
import { clickup } from '../clients/clickup.js';

const log = withContext({ module: 'server' });

// ---------------------------------------------------------------------------
// Instâncias compartilhadas (singleton no processo)
// ---------------------------------------------------------------------------

/** DedupeStore para webhooks ClickUp — TTL 10 minutos (TRIG-04) */
export const clickupDedup = new DedupeStore(10 * 60 * 1000);

/**
 * Carrega o mapa orderindex→label do campo Formato a partir do ClickUp.
 * Espelha o bootstrap de runSchedulerBatch (Pitfall 3 — não confiar no orderindex sem o mapa).
 * Recalculado a cada chamada — aceitável dentro do rate limit (A6) para event-driven.
 *
 * @returns {Promise<Map<number, string>>}
 */
export async function loadFormatoOptionsMap() {
  const formatoOptionsMap = new Map();
  try {
    const fieldsResult = await clickup.getListFields(config.CLICKUP_LIST_ID);
    const fields = fieldsResult?.fields ?? (Array.isArray(fieldsResult) ? fieldsResult : []);
    const formatoField = fields.find((f) => f.id === config.CF_FORMATO);
    if (formatoField) {
      const options = formatoField?.type_config?.options ?? [];
      for (const opt of options) {
        const idx = opt.orderindex ?? opt.order ?? null;
        const label = opt.name ?? opt.label ?? opt.value;
        if (idx !== null && label) {
          formatoOptionsMap.set(Number(idx), label);
        }
      }
    } else {
      log.warn({ step: 'loadFormatoOptionsMap' }, 'Campo Formato nao encontrado nos custom fields');
    }
  } catch (err) {
    log.warn({ step: 'loadFormatoOptionsMap', err: err?.message }, 'Falha ao carregar mapa de opcoes do Formato');
  }
  return formatoOptionsMap;
}

// ---------------------------------------------------------------------------
// Deps injetadas no handler (produção: webhookSecret garante HMAC ativo)
// ---------------------------------------------------------------------------

const deps = {
  clickupDedup,
  loadFormatoOptionsMap,
  // webhookSecret injected aqui garante que handleClickUp sempre verifica HMAC em produção (T-03-04)
  webhookSecret: config.CLICKUP_WEBHOOK_SECRET,
};

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

async function handleRequest(req, res, rawBody) {
  const { method, url } = req;

  if (method === 'POST' && url === '/webhook/clickup') {
    return handleClickUp(req, res, rawBody, deps);
  }

  if (method === 'GET' && url === '/health') {
    return handleHealth(req, res);
  }

  // Rota não encontrada
  res.writeHead(404);
  res.end('Not Found');
}

// ---------------------------------------------------------------------------
// Servidor HTTP com raw body capture (Pattern 1)
// ---------------------------------------------------------------------------

export const server = http.createServer((req, res) => {
  const chunks = [];

  req.on('data', (chunk) => chunks.push(chunk));

  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    handleRequest(req, res, rawBody).catch((err) => {
      log.error({ err: err.message }, 'Erro nao tratado no handler de requisicao');
      if (!res.writableEnded) {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    });
  });

  req.on('error', (err) => {
    log.error({ err: err.message }, 'Erro no stream da requisicao');
    if (!res.writableEnded) {
      res.writeHead(400);
      res.end('Bad Request');
    }
  });
});

// ---------------------------------------------------------------------------
// POLLER_INTEGRATION_POINT — Plano 03-04 importa e adiciona aqui:
//
//   import { pollGhlPosts } from '../poller/ghlStatusPoller.js';
//   setInterval(() => {
//     pollGhlPosts().catch(err =>
//       log.error({ err: err.message }, 'Polling GHL falhou — proxima rodada em breve'),
//     );
//   }, config.POLL_INTERVAL_MS);
//   log.info({ intervalMs: config.POLL_INTERVAL_MS }, 'GHL status poller iniciado');
//
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Entrypoint guard — inicia o servidor só quando executado diretamente
// (npm run serve → node src/server/index.js)
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] === __filename;

if (isEntrypoint) {
  server.listen(config.WEBHOOK_PORT, () => {
    log.info({ port: config.WEBHOOK_PORT }, 'Servidor webhook iniciado');
  });
}
