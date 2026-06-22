/**
 * src/clients/clickup.js
 *
 * Client HTTP autenticado para a API ClickUp v2 (CFG-02).
 *
 * - Auth: header Authorization: <CLICKUP_TOKEN> (pk_…)
 * - Rate limit: Bottleneck com reservoir 100 req/60s (100 req/min por token)
 * - Retry: p-retry com backoff exponencial em 429 e 5xx/rede; 4xx não-429 viram AppError não-retentável
 * - Fetch: nativo do Node 24 — sem node-fetch/axios/undici
 * - Segurança: headers de auth NUNCA logados (T-01-02)
 */
import Bottleneck from 'bottleneck';
import pRetry, { AbortError } from 'p-retry';
import { config } from '../config/index.js';
import { withContext } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

const log = withContext({ module: 'clickup' });

const BASE_URL = 'https://api.clickup.com/api/v2';

/**
 * Throttle: 100 requisições por janela de 60 segundos (limite por token do ClickUp).
 * maxConcurrent: 5 para evitar bursts.
 */
const limiter = new Bottleneck({
  reservoir: 100,
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60_000,
  maxConcurrent: 5,
});

/**
 * Executa uma requisição HTTP autenticada para a API ClickUp.
 * Não loga os headers de autenticação (T-01-02).
 *
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path - Path relativo (ex: '/list/123')
 * @param {object|undefined} body - Payload JSON opcional
 * @returns {Promise<object|null>}
 */
async function request(method, path, body) {
  return limiter.schedule(() =>
    pRetry(
      async (attemptNumber) => {
        const url = `${BASE_URL}${path}`;
        // NUNCA logar o valor de Authorization
        const res = await fetch(url, {
          method,
          headers: {
            Authorization: config.CLICKUP_TOKEN,
            'Content-Type': 'application/json',
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });

        // 429 → rate limited pelo ClickUp; honra Retry-After / X-RateLimit-Reset
        // Retry-After é delta-segundos; X-RateLimit-Reset é epoch Unix (segundos desde 1970)
        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          const resetEpoch = res.headers.get('X-RateLimit-Reset');
          let waitMs;
          if (retryAfter) {
            waitMs = Number(retryAfter) * 1000;
          } else if (resetEpoch) {
            waitMs = Math.max(0, Number(resetEpoch) * 1000 - Date.now());
          } else {
            waitMs = 5_000;
          }
          waitMs = Math.min(waitMs, 60_000); // nunca esperar mais de 60s
          log.warn({ status: 429, waitMs, attempt: attemptNumber }, 'ClickUp rate limit — aguardando');
          // Aguarda antes de retentar (p-retry vai esperar minTimeout+factor normalmente,
          // mas aqui adicionamos o delay real do header)
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          throw new Error(`Rate limited (429) — tentativa ${attemptNumber}`);
        }

        // 5xx → erros de servidor; retentável
        if (res.status >= 500) {
          throw new Error(`ClickUp server error ${res.status}`);
        }

        // 4xx não-429 → erro do caller; converter para AppError e NÃO retentar
        if (!res.ok) {
          const appErr = await AppError.fromClickUp(res);
          log.warn({ status: appErr.status, code: appErr.code, attempt: attemptNumber }, 'ClickUp erro não-retentável');
          throw new AbortError(appErr);
        }

        // 204 No Content
        if (res.status === 204) return null;

        return res.json();
      },
      {
        retries: 3,
        minTimeout: 1_000,
        factor: 2,
        onFailedAttempt(error) {
          // Não logar AbortError (já logado acima com dados estruturados)
          if (error instanceof AbortError) return;
          log.warn(
            { attempt: error.attemptNumber, retriesLeft: error.retriesLeft },
            `ClickUp request falhou — retentando`,
          );
        },
      },
    ),
  );
}

/**
 * Client ClickUp exportado.
 * Phase 1: getList, getListFields, getTask, updateTask, setCustomField.
 * Phase 2: getListTasks com paginação automática.
 */
export const clickup = {
  /**
   * Busca os dados de uma lista pelo id.
   * GET /list/{id}
   *
   * @param {string} listId
   * @returns {Promise<{id: string, name: string, [key: string]: unknown}>}
   */
  getList: (listId) => request('GET', `/list/${listId}`),

  /**
   * Busca os custom fields de uma lista.
   * GET /list/{id}/field
   *
   * @param {string} listId
   * @returns {Promise<{fields: Array<object>}>}
   */
  getListFields: (listId) => request('GET', `/list/${listId}/field`),

  /**
   * Busca uma task pelo id.
   * GET /task/{id}
   *
   * @param {string} taskId
   * @returns {Promise<object>}
   */
  getTask: (taskId) => request('GET', `/task/${taskId}`),

  /**
   * Atualiza campos de uma task (ex: status).
   * PUT /task/{id}
   *
   * @param {string} taskId
   * @param {object} patch
   * @returns {Promise<object>}
   */
  updateTask: (taskId, patch) => request('PUT', `/task/${taskId}`, patch),

  /**
   * Define o valor de um custom field em uma task.
   * POST /task/{taskId}/field/{fieldId}
   *
   * @param {string} taskId
   * @param {string} fieldId
   * @param {unknown} value
   * @returns {Promise<object|null>}
   */
  setCustomField: (taskId, fieldId, value) =>
    request('POST', `/task/${taskId}/field/${fieldId}`, { value }),

  /**
   * Lista tasks de uma lista com filtro por status — paginação automática.
   * GET /list/{id}/task?statuses[]=...&page=N
   *
   * Pagina com while(true) por `page` até receber `tasks` vazio.
   * Passa `statuses[]` como parâmetro de query string.
   * Rate limit herdado do limiter via request(). Implementa SCH-01.
   *
   * @param {string} listId
   * @param {string} statusFilter - valor exato do status (ex: config.STATUS_A_AGENDAR)
   * @returns {Promise<Array<object>>}
   */
  getListTasks: async (listId, statusFilter) => {
    const tasks = [];
    let page = 0;
    while (true) {
      const params = new URLSearchParams();
      params.append('statuses[]', statusFilter);
      params.append('include_closed', 'false');
      params.append('subtasks', 'false');
      params.append('page', String(page));
      const result = await request('GET', `/list/${listId}/task?${params}`);
      if (!result?.tasks?.length) break;
      tasks.push(...result.tasks);
      page++;
    }
    return tasks;
  },
};
