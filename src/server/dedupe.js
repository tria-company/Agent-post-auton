/**
 * src/server/dedupe.js
 *
 * In-memory Map com TTL para idempotência de webhook (TRIG-04, SYNC-06).
 * Single-instance VPS: restart zera o store — aceitável (CF_GHL_POST_ID é âncora duradoura).
 *
 * Chave de dedup ClickUp:  `${webhook_id}:${history_items[0].id}`
 * Chave de dedup GHL poll: `${postId}:${status}`
 */

/**
 * Store de deduplicação em-memória com TTL configurável.
 * Usado para evitar que a mesma entrega de webhook dispare processTask mais de uma vez (TRIG-04).
 */
export class DedupeStore {
  /**
   * @param {number} ttlMs - Time-to-live em ms (default: 10 minutos)
   */
  constructor(ttlMs = 10 * 60 * 1000) {
    this._map = new Map();
    this._ttl = ttlMs;
  }

  /**
   * Verifica se a chave existe e ainda não expirou.
   * Remove automaticamente entradas expiradas ao acessar.
   *
   * @param {string} key
   * @returns {boolean}
   */
  has(key) {
    const entry = this._map.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this._map.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Registra a chave com expiração em ttlMs a partir de agora.
   *
   * @param {string} key
   */
  set(key) {
    this._map.set(key, { expiresAt: Date.now() + this._ttl });
  }

  /**
   * Limpeza periódica — evitar memory leak em runs longas.
   * Chamar em setInterval ou manualmente quando conveniente.
   */
  gc() {
    const now = Date.now();
    for (const [k, v] of this._map) {
      if (now > v.expiresAt) this._map.delete(k);
    }
  }
}
