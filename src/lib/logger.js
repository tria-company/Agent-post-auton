/**
 * src/lib/logger.js
 *
 * Logger pino raiz com configuração de redaction de segredos (CFG-04).
 * Em desenvolvimento (NODE_ENV !== 'production') usa pino-pretty para output legível.
 * Em produção, JSON puro.
 *
 * Exporta:
 *   - logger: instância pino raiz
 *   - withContext(fields): helper para criar child loggers com campos de domínio
 *                          (taskId, ghlPostId, action, etc.)
 */
import pino from 'pino';
import { config } from '../config/index.js';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'agent-posts-auton' },

  // Redaction de segredos — tokens NUNCA devem vazar em log (T-01-02)
  redact: {
    paths: [
      'authorization',
      '*.authorization',
      '*.headers.authorization',
      '*.headers.Authorization',
      'token',
      '*.token',
      'GHL_TOKEN',
      'CLICKUP_TOKEN',
    ],
    censor: '[REDACTED]',
  },

  // Em dev: pino-pretty; em prod: JSON puro
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        },
      }
    : {}),
});

/**
 * Cria um child logger com campos de contexto fixos.
 * Uso típico: const log = withContext({ taskId, ghlPostId, action: 'schedule' });
 *
 * @param {Record<string, unknown>} fields
 * @returns {import('pino').Logger}
 */
export const withContext = (fields) => logger.child(fields);
