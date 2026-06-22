/**
 * scripts/smoke-ghl-getpost.js
 *
 * Smoke OQ1: Descobre o shape real do endpoint GET /social-media-posting/:locationId/posts/:id
 *
 * Propósito: Antes de implementar o polling write-back (Plano 03-03), este smoke
 * confirma empiricamente os nomes REAIS dos campos de resposta do GHL, em particular:
 *   - O campo que carrega o status do post (OQ1: 'status'? 'state'?)
 *   - Os campos de IG media id e permalink (se o post já foi publicado)
 *   - O campo de razão de falha
 *
 * Atenção de segurança:
 *   - O JSON cru do response é impresso via console.log (inspeção local efêmera)
 *   - O logger estruturado (pino) recebe APENAS nomes de chaves, não valores sensíveis
 *   - O GHL_TOKEN é lido do .env e NUNCA aparece no output
 *
 * Uso:
 *   node scripts/smoke-ghl-getpost.js
 *   SMOKE_POST_ID=<id> node scripts/smoke-ghl-getpost.js
 *
 * Post id default: 6a39a0be892064b3bddd4ece (post de teste agendado na Phase 2)
 */

import 'dotenv/config';
import { ghl } from '../src/clients/ghl.js';
import { withContext } from '../src/lib/logger.js';

const log = withContext({ module: 'smoke' });

// Post id para inspecionar — usa default da Phase 2 se não fornecido
const POST_ID = process.env.SMOKE_POST_ID ?? '6a39a0be892064b3bddd4ece';

log.info({ postId: POST_ID }, 'Smoke OQ1 — iniciando GET /posts/:id');

async function main() {
  let resp;
  try {
    resp = await ghl.getPost(POST_ID);
  } catch (err) {
    // AppError ou erro de rede
    log.error({ err: err.message, code: err.code ?? 'UNKNOWN' }, 'Smoke falhou — erro na chamada getPost');
    console.error('\n[smoke] Erro:', err.message);
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Inspecao do response completo (console.log — efemero, apenas local)
  // NAO usar o logger pino aqui para nao vazar valores sensiveis via transporte
  // -------------------------------------------------------------------------
  console.log('\n========== SMOKE OQ1: RESPONSE COMPLETO DO GHL GET /posts/:id ==========');
  console.log(JSON.stringify(resp, null, 2));
  console.log('==========================================================================\n');

  // -------------------------------------------------------------------------
  // Resumo estruturado — apenas NOMES DE CHAVES, nao valores (T-03-01)
  // -------------------------------------------------------------------------
  const topLevelKeys = resp != null ? Object.keys(resp) : [];

  // Tentar detectar em qual chave esta o objeto do post
  // O createPost retornou results.post._id (Phase 2); o GET pode ser diferente
  const postObj = resp?.post ?? resp?.data ?? resp?.result ?? resp;
  const postKeys = postObj != null && typeof postObj === 'object' ? Object.keys(postObj) : [];

  // Detectar campo de status
  const statusFieldCandidates = ['status', 'state', 'postStatus', 'publishingStatus'];
  const statusField = statusFieldCandidates.find(f => postKeys.includes(f) || topLevelKeys.includes(f));
  const statusValue = postObj?.[statusField] ?? resp?.[statusField];

  // Detectar campo de ig media id
  const igMediaCandidates = ['igMediaId', 'instagramMediaId', 'mediaId', 'ig_media_id', 'instagramPostId'];
  const igMediaField = igMediaCandidates.find(f => postKeys.includes(f) || topLevelKeys.includes(f));

  // Detectar campo de permalink
  const permalinkCandidates = ['permalink', 'postUrl', 'url', 'link', 'post_url'];
  const permalinkField = permalinkCandidates.find(f => postKeys.includes(f) || topLevelKeys.includes(f));

  // Detectar campo de razao de falha
  const failureCandidates = ['failureReason', 'error', 'errorMessage', 'failure_reason', 'reason'];
  const failureField = failureCandidates.find(f => postKeys.includes(f) || topLevelKeys.includes(f));

  log.info({
    topLevelKeys,
    postObjKeys: postKeys,
    statusField: statusField ?? 'NAO ENCONTRADO — verificar JSON acima',
    statusValue: statusValue ?? 'N/A',
    igMediaField: igMediaField ?? 'NAO ENCONTRADO — campo pode ser diferente ou so existir apos publicacao',
    permalinkField: permalinkField ?? 'NAO ENCONTRADO — campo pode ser diferente ou so existir apos publicacao',
    failureField: failureField ?? 'NAO ENCONTRADO — campo pode so existir em status=failed',
  }, 'Smoke OQ1 — resumo dos campos detectados (apenas nomes, sem valores sensiveis)');

  console.log('\n========== ACAO REQUERIDA ==========');
  console.log('Copie os nomes REAIS dos campos do JSON acima e reporte:');
  console.log('  1. Campo de status do post (ex: "status", "state", etc.)');
  console.log('  2. Valores possiveis observados (ex: "scheduled", "published", ...)');
  console.log('  3. Campo de IG media id (se o post ja foi publicado)');
  console.log('  4. Campo de permalink / URL do post (se publicado)');
  console.log('  5. Campo de razao de falha (se em status=failed)');
  console.log('=====================================\n');
}

main();
