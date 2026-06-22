/**
 * src/server/verifySignature.js
 *
 * Verifica a assinatura HMAC-SHA256 do webhook ClickUp (TRIG-02).
 * Input: rawBody (Buffer), header x-signature (hex string), secret.
 * NUNCA logar o valor do header nem do secret (T-01-02).
 *
 * Referência: developer.clickup.com/docs/webhooksignature
 *   - Header: X-Signature
 *   - Algoritmo: HMAC-SHA256
 *   - Input: raw body (Buffer) — NUNCA JSON.stringify(JSON.parse(...))
 *   - Output: hex digest
 *   - Comparação: crypto.timingSafeEqual (previne timing attack — T-03-05)
 */
import crypto from 'node:crypto';

/**
 * Verifica a assinatura HMAC-SHA256 do webhook ClickUp.
 * Usa crypto.timingSafeEqual para evitar timing attacks (T-03-05).
 * Retorna false para qualquer input inválido sem lançar exceção.
 *
 * @param {Buffer} rawBody   - Buffer.concat(chunks) ANTES de JSON.parse
 * @param {string} header    - req.headers['x-signature'] (hex string)
 * @param {string} secret    - config.CLICKUP_WEBHOOK_SECRET
 * @returns {boolean}
 */
export function verifyClickUpSignature(rawBody, header, secret) {
  if (!header || !secret) return false;
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody) // Buffer direto — NUNCA JSON.stringify(JSON.parse(...))
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'hex'),
      Buffer.from(header, 'hex'),
    );
  } catch {
    // timingSafeEqual lança se os buffers têm tamanhos diferentes
    return false;
  }
}

// Reservado para futuro (GHL não emite webhook de Social Planner atualmente)
// export function verifyGhlSignature(rawBody, signature) { ... }
