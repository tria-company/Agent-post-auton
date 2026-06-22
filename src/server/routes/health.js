/**
 * src/server/routes/health.js
 *
 * Handler para GET /health — responde 200 com JSON de status imediatamente.
 * Usado por probes de liveness (Caddy, load balancer, monitoramento).
 */
import { withContext } from '../../lib/logger.js';

const log = withContext({ module: 'server.health' });

/**
 * Responde à rota GET /health com 200 JSON { status:'ok', ts }.
 *
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 */
export function handleHealth(req, res) {
  log.info({ step: 'health.check' }, 'Health check OK');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }));
}
