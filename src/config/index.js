/**
 * src/config/index.js
 *
 * Carrega e valida toda a configuração do .env com zod.
 * Fail-fast: process.exit(1) com mensagem clara se faltar/for inválida qualquer variável.
 * Exporta um objeto `config` congelado (Object.freeze) — zero valores hardcoded (CFG-01).
 *
 * Mapeamento de variáveis de ambiente → chaves no config exportado:
 *   CU_FIELD_LEGENDA         → CF_LEGENDA
 *   CU_FIELD_DATA_PUBLICACAO → CF_DATA_PUBLICACAO
 *   CU_FIELD_IG_MEDIA_ID     → CF_IG_MEDIA_ID
 *   CU_FIELD_LINK_PUBLICADO  → CF_LINK_PUBLICADO
 *   CU_FIELD_ERRO_PUBLICACAO → CF_ERRO_PUBLICACAO
 *   CU_FIELD_ID_TASK_MAE     → CF_ID_TASK_MAE
 *   -- Phase 2 (CFG-01) --
 *   CU_FIELD_GHL_POST_ID     → CF_GHL_POST_ID
 *   CU_FIELD_LINK_DO_POST    → CF_LINK_DO_POST
 *   CU_FIELD_FORMATO         → CF_FORMATO
 *   GHL_ACCOUNT_ID           → GHL_ACCOUNT_ID
 *   GHL_USER_ID              → GHL_USER_ID
 *   STATUS_A_AGENDAR         → STATUS_A_AGENDAR  (default: 'a agendar')
 *   STATUS_AGENDADO          → STATUS_AGENDADO   (default: 'agendado')
 *   -- Phase 3 (CFG-01) --
 *   WEBHOOK_PORT             → WEBHOOK_PORT      (default: 3000, number)
 *   CLICKUP_WEBHOOK_SECRET   → CLICKUP_WEBHOOK_SECRET
 *   POLL_INTERVAL_MS         → POLL_INTERVAL_MS  (default: 300000, number)
 *   STATUS_PUBLICADO         → STATUS_PUBLICADO  (default: 'publicado')
 *   PUBLIC_WEBHOOK_URL       → PUBLIC_WEBHOOK_URL (optional — usado pelo setup:webhooks)
 */
import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  // ClickUp
  CLICKUP_TOKEN: z.string().startsWith('pk_', { message: 'CLICKUP_TOKEN deve começar com pk_' }),
  CLICKUP_LIST_ID: z.string().min(1, { message: 'CLICKUP_LIST_ID é obrigatório' }),

  // GHL
  GHL_TOKEN: z.string().startsWith('pit-', { message: 'GHL_TOKEN deve começar com pit-' }),
  GHL_LOCATION_ID: z.string().min(1, { message: 'GHL_LOCATION_ID é obrigatório' }),
  GHL_API_VERSION: z.string().default('2021-07-28'),

  // Custom fields do ClickUp (UUIDs) — nomes no .env usam prefixo CU_FIELD_
  CU_FIELD_LEGENDA: z.string().uuid({ message: 'CU_FIELD_LEGENDA deve ser um UUID válido' }),
  CU_FIELD_DATA_PUBLICACAO: z.string().uuid({ message: 'CU_FIELD_DATA_PUBLICACAO deve ser um UUID válido' }),
  CU_FIELD_IG_MEDIA_ID: z.string().uuid({ message: 'CU_FIELD_IG_MEDIA_ID deve ser um UUID válido' }),
  CU_FIELD_LINK_PUBLICADO: z.string().uuid({ message: 'CU_FIELD_LINK_PUBLICADO deve ser um UUID válido' }),
  CU_FIELD_ERRO_PUBLICACAO: z.string().uuid({ message: 'CU_FIELD_ERRO_PUBLICACAO deve ser um UUID válido' }),
  CU_FIELD_ID_TASK_MAE: z.string().uuid({ message: 'CU_FIELD_ID_TASK_MAE deve ser um UUID válido' }),

  // Phase 2 — custom fields novos (CFG-01)
  CU_FIELD_GHL_POST_ID:  z.string().uuid({ message: 'CU_FIELD_GHL_POST_ID deve ser um UUID válido' }),
  CU_FIELD_LINK_DO_POST: z.string().uuid({ message: 'CU_FIELD_LINK_DO_POST deve ser um UUID válido' }),
  CU_FIELD_FORMATO:      z.string().uuid({ message: 'CU_FIELD_FORMATO deve ser um UUID válido' }),

  // Phase 2 — conta GHL, user id e nomes de status (CFG-01)
  GHL_ACCOUNT_ID:   z.string().min(1, { message: 'GHL_ACCOUNT_ID é obrigatório' }),
  GHL_USER_ID:      z.string().min(1, { message: 'GHL_USER_ID é obrigatório — obter via GET /users/?locationId=...' }),
  STATUS_A_AGENDAR: z.string().min(1).default('a agendar'),
  STATUS_AGENDADO:  z.string().min(1).default('agendado'),

  // Phase 3 — servidor webhook + polling (CFG-01)
  WEBHOOK_PORT:           z.string().default('3000').transform(Number),
  CLICKUP_WEBHOOK_SECRET: z.string().min(1, { message: 'CLICKUP_WEBHOOK_SECRET é obrigatório' }),
  POLL_INTERVAL_MS:       z.string().default('300000').transform(Number),
  STATUS_PUBLICADO:       z.string().min(1).default('publicado'),
  /** URL pública do VPS atrás do Caddy — usada pelo setup:webhooks para registrar o webhook ClickUp.
   *  Opcional: o servidor HTTP não precisa desta variável; só o script setup:webhooks usa.
   *  Exemplo: https://meudominio.com.br/webhook/clickup
   */
  PUBLIC_WEBHOOK_URL:     z.string().url({ message: 'PUBLIC_WEBHOOK_URL deve ser uma URL válida' }).optional(),

  // Logging
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  // Mensagem clara com erros por campo — roda ANTES de qualquer client subir
  console.error('❌ Config inválida — verifique o arquivo .env:\n');
  console.error(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2));
  process.exit(1);
}

const env = parsed.data;

/**
 * Objeto de configuração congelado exportado para o resto da aplicação.
 * As chaves CF_* são os aliases canônicos usados internamente (interfaces do plano).
 *
 * @type {Readonly<{
 *   CLICKUP_TOKEN: string,
 *   CLICKUP_LIST_ID: string,
 *   GHL_TOKEN: string,
 *   GHL_LOCATION_ID: string,
 *   GHL_API_VERSION: string,
 *   CF_LEGENDA: string,
 *   CF_DATA_PUBLICACAO: string,
 *   CF_IG_MEDIA_ID: string,
 *   CF_LINK_PUBLICADO: string,
 *   CF_ERRO_PUBLICACAO: string,
 *   CF_ID_TASK_MAE: string,
 *   CF_GHL_POST_ID: string,
 *   CF_LINK_DO_POST: string,
 *   CF_FORMATO: string,
 *   GHL_ACCOUNT_ID: string,
 *   GHL_USER_ID: string,
 *   STATUS_A_AGENDAR: string,
 *   STATUS_AGENDADO: string,
 *   WEBHOOK_PORT: number,
 *   CLICKUP_WEBHOOK_SECRET: string,
 *   POLL_INTERVAL_MS: number,
 *   STATUS_PUBLICADO: string,
 *   PUBLIC_WEBHOOK_URL: string|undefined,
 *   LOG_LEVEL: string,
 * }>}
 */
export const config = Object.freeze({
  CLICKUP_TOKEN: env.CLICKUP_TOKEN,
  CLICKUP_LIST_ID: env.CLICKUP_LIST_ID,
  GHL_TOKEN: env.GHL_TOKEN,
  GHL_LOCATION_ID: env.GHL_LOCATION_ID,
  GHL_API_VERSION: env.GHL_API_VERSION,
  // Aliases CF_* (interfaces do plano) mapeados de CU_FIELD_*
  CF_LEGENDA:          env.CU_FIELD_LEGENDA,
  CF_DATA_PUBLICACAO:  env.CU_FIELD_DATA_PUBLICACAO,
  CF_IG_MEDIA_ID:      env.CU_FIELD_IG_MEDIA_ID,
  CF_LINK_PUBLICADO:   env.CU_FIELD_LINK_PUBLICADO,
  CF_ERRO_PUBLICACAO:  env.CU_FIELD_ERRO_PUBLICACAO,
  CF_ID_TASK_MAE:      env.CU_FIELD_ID_TASK_MAE,
  // Phase 2 — aliases CF_* novos (CFG-01)
  CF_GHL_POST_ID:      env.CU_FIELD_GHL_POST_ID,
  CF_LINK_DO_POST:     env.CU_FIELD_LINK_DO_POST,
  CF_FORMATO:          env.CU_FIELD_FORMATO,
  // Phase 2 — conta GHL, user id e status (sem prefixo CU_FIELD_; passam direto)
  GHL_ACCOUNT_ID:      env.GHL_ACCOUNT_ID,
  GHL_USER_ID:         env.GHL_USER_ID,
  STATUS_A_AGENDAR:    env.STATUS_A_AGENDAR,
  STATUS_AGENDADO:     env.STATUS_AGENDADO,
  // Phase 3 — servidor webhook + polling (sem prefixo CU_FIELD_; passam direto)
  WEBHOOK_PORT:           env.WEBHOOK_PORT,
  CLICKUP_WEBHOOK_SECRET: env.CLICKUP_WEBHOOK_SECRET,
  POLL_INTERVAL_MS:       env.POLL_INTERVAL_MS,
  STATUS_PUBLICADO:       env.STATUS_PUBLICADO,
  // PUBLIC_WEBHOOK_URL — opcional; obrigatório apenas para npm run setup:webhooks
  PUBLIC_WEBHOOK_URL:     env.PUBLIC_WEBHOOK_URL,
  LOG_LEVEL:           env.LOG_LEVEL,
});
