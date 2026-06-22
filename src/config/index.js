/**
 * src/config/index.js
 *
 * Carrega e valida toda a configuração do .env com zod.
 * Fail-fast: process.exit(1) com mensagem clara se faltar/for inválida qualquer variável.
 * Exporta um objeto `config` congelado (Object.freeze) — zero valores hardcoded (CFG-01).
 *
 * Mapeamento de variáveis de ambiente → chaves no config exportado:
 *   CU_FIELD_LEGENDA        → CF_LEGENDA
 *   CU_FIELD_DATA_PUBLICACAO → CF_DATA_PUBLICACAO
 *   CU_FIELD_IG_MEDIA_ID    → CF_IG_MEDIA_ID
 *   CU_FIELD_LINK_PUBLICADO → CF_LINK_PUBLICADO
 *   CU_FIELD_ERRO_PUBLICACAO → CF_ERRO_PUBLICACAO
 *   CU_FIELD_ID_TASK_MAE    → CF_ID_TASK_MAE
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
  CF_LEGENDA: env.CU_FIELD_LEGENDA,
  CF_DATA_PUBLICACAO: env.CU_FIELD_DATA_PUBLICACAO,
  CF_IG_MEDIA_ID: env.CU_FIELD_IG_MEDIA_ID,
  CF_LINK_PUBLICADO: env.CU_FIELD_LINK_PUBLICADO,
  CF_ERRO_PUBLICACAO: env.CU_FIELD_ERRO_PUBLICACAO,
  CF_ID_TASK_MAE: env.CU_FIELD_ID_TASK_MAE,
  LOG_LEVEL: env.LOG_LEVEL,
});
