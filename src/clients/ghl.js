/**
 * src/clients/ghl.js
 *
 * Client HTTP autenticado para a API GoHighLevel (GHL) Social Planner (CFG-03).
 *
 * - Auth: header Authorization: Bearer <GHL_TOKEN> (pit-…) + Version: <GHL_API_VERSION>
 * - Retry: p-retry com backoff exponencial em 429 e 5xx/rede; 4xx não-429 viram AppError não-retentável
 * - Fetch: nativo do Node 24 — sem node-fetch/axios/undici
 * - Segurança: headers de auth NUNCA logados (T-01-02)
 */
import pRetry, { AbortError } from 'p-retry';
import { config } from '../config/index.js';
import { withContext } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

const log = withContext({ module: 'ghl' });

const BASE_URL = 'https://services.leadconnectorhq.com';

/**
 * Retorna os headers de autenticação para o GHL.
 * Separado em função para nunca logar esses valores acidentalmente.
 *
 * @returns {Record<string, string>}
 */
function authHeaders() {
  return {
    Authorization: `Bearer ${config.GHL_TOKEN}`,
    Version: config.GHL_API_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

/**
 * Executa uma requisição HTTP autenticada para a API GHL.
 * Não loga os headers de autenticação (T-01-02).
 *
 * @param {'GET'|'POST'|'PUT'|'PATCH'|'DELETE'} method
 * @param {string} path - Path relativo (ex: '/social-media-posting/…/accounts')
 * @param {object|undefined} body - Payload JSON opcional
 * @returns {Promise<object|null>}
 */
async function request(method, path, body) {
  return pRetry(
    async (attemptNumber) => {
      const url = `${BASE_URL}${path}`;
      const res = await fetch(url, {
        method,
        headers: authHeaders(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });

      // 429 → rate limited pelo GHL; honra Retry-After se presente
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5_000;
        log.warn({ status: 429, waitMs, attempt: attemptNumber }, 'GHL rate limit — aguardando');
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        throw new Error(`Rate limited (429) — tentativa ${attemptNumber}`);
      }

      // 5xx → erros de servidor do GHL; retentável
      if (res.status >= 500) {
        throw new Error(`GHL server error ${res.status}`);
      }

      // 4xx não-429 → erro do caller; converter para AppError e NÃO retentar
      if (!res.ok) {
        const appErr = await AppError.fromGHL(res);
        log.warn({ status: appErr.status, code: appErr.code, attempt: attemptNumber }, 'GHL erro não-retentável');
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
        if (error instanceof AbortError) return;
        log.warn(
          { attempt: error.attemptNumber, retriesLeft: error.retriesLeft },
          'GHL request falhou — retentando',
        );
      },
    },
  );
}

/**
 * Client GHL exportado.
 * Phase 1: listAccounts para o smoke test.
 * Phase 2: uploadMedia (multipart), createPost (com payload real + userId).
 */
export const ghl = {
  /**
   * Lista as contas de social media configuradas na location.
   * GET /social-media-posting/{locationId}/accounts
   *
   * @returns {Promise<{accounts: Array<{name: string, platform: string, [key: string]: unknown}>}>}
   */
  listAccounts: () =>
    request('GET', `/social-media-posting/${config.GHL_LOCATION_ID}/accounts`),

  /**
   * Faz upload de um arquivo para a media library do GHL.
   * POST /medias/upload-file (multipart/form-data)
   *
   * NÃO usa request() pois o Content-Type deve ser definido pelo FormData (boundary automático).
   * Usar Content-Type manual quebraria o multipart — Pitfall 4 do RESEARCH.md.
   * Ainda envolve em pRetry para herdar retry/backoff.
   *
   * Segurança: não loga Authorization (T-01-02); reusa authHeaders exceto Content-Type.
   *
   * @param {Buffer} fileBuffer
   * @param {string} fileName
   * @param {string} mimeType
   * @returns {Promise<{url: string, fileId: string}>}
   */
  uploadMedia: (fileBuffer, fileName, mimeType) =>
    pRetry(
      async (attemptNumber) => {
        const form = new FormData();
        form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
        form.append('name', fileName);
        form.append('altType', 'location');
        form.append('altId', config.GHL_LOCATION_ID);
        // NÃO setar Content-Type — FormData define com boundary automaticamente (Pitfall 4)
        const res = await fetch(`${BASE_URL}/medias/upload-file`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.GHL_TOKEN}`,
            Version: config.GHL_API_VERSION,
            // sem Content-Type intencional
          },
          body: form,
        });

        if (res.status === 429) {
          const retryAfter = res.headers.get('Retry-After');
          const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5_000;
          log.warn({ status: 429, waitMs, attempt: attemptNumber }, 'GHL rate limit (upload) — aguardando');
          await new Promise((resolve) => setTimeout(resolve, waitMs));
          throw new Error(`Rate limited (429) — tentativa ${attemptNumber}`);
        }

        if (res.status >= 500) throw new Error(`GHL server error ${res.status}`);

        if (!res.ok) {
          const appErr = await AppError.fromGHL(res);
          log.warn({ status: appErr.status, code: appErr.code, attempt: attemptNumber }, 'GHL upload erro não-retentável');
          throw new AbortError(appErr);
        }

        const data = await res.json();
        return { url: data.url, fileId: data.fileId };
      },
      {
        retries: 3,
        minTimeout: 1_000,
        factor: 2,
        onFailedAttempt(error) {
          if (error instanceof AbortError) return;
          log.warn(
            { attempt: error.attemptNumber, retriesLeft: error.retriesLeft },
            'GHL upload falhou — retentando',
          );
        },
      },
    ),

  /**
   * Cria um post agendado no Social Planner do GHL.
   * POST /social-media-posting/{locationId}/posts
   *
   * Payload esperado (campos confirmados empiricamente — smoke Wave 0):
   *   {
   *     accountIds:   string[]   // ex: [config.GHL_ACCOUNT_ID]
   *     userId:       string     // OBRIGATÓRIO — 422 sem ele; ex: config.GHL_USER_ID
   *     summary:      string     // legenda do post
   *     type:         'post' | 'reel'  // 'post' para Feed/Carrossel, 'reel' para Reels
   *     scheduleDate: string     // ISO 8601 (ex: new Date(epochMs).toISOString())
   *     media:        Array<{url: string, type?: string}>  // url da media library do GHL (A2 confirmado)
   *     status:       'scheduled'
   *   }
   *
   * Resposta (Pitfall 7 — confirmado empiricamente):
   *   post id em response.results.post._id (NÃO response.post._id)
   *
   * @param {object} payload
   * @returns {Promise<object>}
   */
  createPost: (payload) =>
    request('POST', `/social-media-posting/${config.GHL_LOCATION_ID}/posts`, payload),
};
