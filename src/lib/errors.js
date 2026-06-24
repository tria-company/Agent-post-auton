/**
 * src/lib/errors.js
 *
 * Classe de erro normalizado da aplicação.
 * Cada client mapeia o shape de erro da sua API para AppError,
 * logando APENAS status + código — nunca headers nem corpo bruto (T-01-05).
 */

/**
 * Mapeia mensagens de erro conhecidas (GHL/ClickUp, em inglês) para português,
 * para exibição amigável no ClickUp (campo "Erro de publicação" + comentários).
 * Mensagens não mapeadas são mantidas como estão (adicionar tradução conforme aparecerem).
 *
 * @type {Array<[RegExp, string]>}
 */
const ERROR_TRANSLATIONS = [
  [/schedule date must be after current date/i, 'Data muito próxima — o Instagram exige agendar com mais antecedência (use ~15 min ou mais)'],
  [/must be after current date/i, 'A data de agendamento precisa estar mais no futuro'],
  [/unable to confirm whether your post was published/i, 'O Instagram não confirmou a publicação — confira o perfil; se não estiver lá, tente novamente em alguns minutos'],
  [/(not authorized for this scope|token is not authorized)/i, 'Token do GHL sem permissão (escopo) para esta ação'],
  [/user ?id (must be a string|should not be empty)/i, 'Configuração de usuário do GHL (GHL_USER_ID) ausente ou inválida'],
  [/(unprocessable entity|invalid input|validation failed)/i, 'Dados inválidos enviados ao GHL'],
  [/(rate limit|too many requests)/i, 'Limite de requisições atingido — tente novamente em instantes'],
  [/(unauthorized|invalid token|forbidden)/i, 'Falha de autenticação com o GHL (token inválido ou sem permissão)'],
  [/not found/i, 'Recurso não encontrado no GHL'],
  [/(413|payload too large|request entity too large|file too large)/i, 'Arquivo grande demais para o GHL — vídeo máx. 500MB, imagem máx. 25MB. Comprima o arquivo.'],
];

/**
 * Traduz uma mensagem de erro para português quando reconhecida.
 * @param {unknown} msg
 * @returns {string}
 */
export function translateError(msg) {
  const s = Array.isArray(msg) ? msg.join('; ') : String(msg ?? '');
  for (const [re, pt] of ERROR_TRANSLATIONS) {
    if (re.test(s)) return pt;
  }
  return s;
}

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
