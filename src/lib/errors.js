/**
 * src/lib/errors.js
 *
 * Classe de erro normalizado da aplicação.
 * Cada client mapeia o shape de erro da sua API para AppError,
 * logando APENAS status + código — nunca headers nem corpo bruto (T-01-05).
 */

export class AppError extends Error {
  /**
   * @param {object} options
   * @param {string} options.message - Mensagem human-readable
   * @param {number} options.status  - HTTP status code
   * @param {string} options.code    - Código de erro da API (e.g., OAUTH_023, item_not_found)
   * @param {string} options.api     - Identificador da API de origem ('clickup' | 'ghl')
   */
  constructor({ message, status, code, api }) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.api = api;
  }

  /**
   * Cria AppError a partir de uma resposta de erro do ClickUp.
   * Shape ClickUp: { err: string, ECODE: string }
   *
   * Loga SOMENTE status + ECODE — nunca headers nem body sensível (Security Domain).
   *
   * @param {Response} res - Objeto Response do fetch nativo
   * @returns {Promise<AppError>}
   */
  static async fromClickUp(res) {
    let code = 'UNKNOWN';
    let message = `ClickUp HTTP ${res.status}`;
    try {
      const body = await res.json();
      // Shape do ClickUp: { err: "...", ECODE: "OAUTH_023" }
      if (body?.ECODE) code = body.ECODE;
      if (body?.err) message = body.err;
    } catch {
      // body não é JSON — mantém fallback
    }
    return new AppError({ message, status: res.status, code, api: 'clickup' });
  }

  /**
   * Cria AppError a partir de uma resposta de erro do GHL.
   * Shape GHL: { message: string, statusCode: number }
   *
   * Loga SOMENTE status + message normalizada — nunca headers nem body sensível (Security Domain).
   *
   * @param {Response} res - Objeto Response do fetch nativo
   * @returns {Promise<AppError>}
   */
  static async fromGHL(res) {
    let code = String(res.status);
    let message = `GHL HTTP ${res.status}`;
    try {
      const body = await res.json();
      // Shape do GHL: { message: "...", statusCode: 422 }
      if (body?.message) message = body.message;
      if (body?.statusCode) code = String(body.statusCode);
    } catch {
      // body não é JSON — mantém fallback
    }
    return new AppError({ message, status: res.status, code, api: 'ghl' });
  }
}
