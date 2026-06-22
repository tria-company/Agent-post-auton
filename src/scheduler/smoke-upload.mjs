/**
 * src/scheduler/smoke-upload.mjs
 *
 * Smoke test empírico — Wave 0 (Plano 02-01, Task 3)
 *
 * Valida empiricamente as suposições A1, A2, A4, A7 do RESEARCH.md antes
 * de implementar o pipeline completo:
 *
 *   A4: FormData nativo do Node 24 + Blob funciona para POST /medias/upload-file
 *   A2: A `url` retornada pelo upload pode ser usada diretamente em media[].url do createPost
 *   A1: Carrossel com type='post' + múltiplas mídias funciona (testado com 1 mídia apenas neste smoke)
 *   A7: GHL_ACCOUNT_ID da conta auton.app é o valor correto configurado no .env
 *
 * COMO USAR:
 *   1. Preencha o .env com as 6 novas variáveis (ver instruções no checkpoint):
 *      CU_FIELD_GHL_POST_ID, CU_FIELD_LINK_DO_POST, CU_FIELD_FORMATO,
 *      GHL_ACCOUNT_ID, STATUS_A_AGENDAR (opcional), STATUS_AGENDADO (opcional)
 *
 *   2. Verifique que o boot passa (config fail-fast OK):
 *      node src/index.js SMOKE_ONLY=1
 *      (ou: SMOKE_ONLY=1 node src/index.js)
 *
 *   3. Execute o smoke de upload + createPost:
 *      node src/scheduler/smoke-upload.mjs
 *
 * RESULTADO ESPERADO:
 *   - "upload OK" com { url, fileId } preenchidos (A4 confirmada)
 *   - "createPost OK" com post._id preenchido (A2 + A7 confirmadas)
 *   - Um post de teste agendado aparece no GHL Social Planner da auton.app
 *
 * APÓS O SMOKE:
 *   - Apague / cancele o post de teste no GHL Social Planner (é apenas um teste)
 *   - Reporte o resultado no chat: "approved + upload OK + createPost retornou post._id: <id>"
 *     OU descreva o erro (status HTTP, mensagem) para ajuste no Plano 02
 *
 * SEGURANÇA:
 *   - Este script nunca loga tokens, URLs pre-signed completas nem o accountId cru
 *   - A imagem de teste é gerada em memória (PNG mínimo válido de 1x1 px)
 *   - O post de teste é agendado para +7 dias; apague após verificar
 */

import 'dotenv/config';

// ---------------------------------------------------------------------------
// 1. Valida que as variáveis críticas estão no .env (fail rápido sem crashar)
// ---------------------------------------------------------------------------
const REQUIRED = ['GHL_TOKEN', 'GHL_LOCATION_ID', 'GHL_API_VERSION', 'GHL_ACCOUNT_ID', 'GHL_USER_ID'];
const missing = REQUIRED.filter(k => !process.env[k]);
if (missing.length) {
  console.error('[smoke] ERRO: variáveis ausentes no .env:', missing.join(', '));
  console.error('[smoke] Preencha o .env seguindo o .env.example e tente novamente.');
  process.exit(1);
}

const GHL_TOKEN       = process.env.GHL_TOKEN;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;
const GHL_API_VERSION = process.env.GHL_API_VERSION ?? '2021-07-28';
const GHL_ACCOUNT_ID  = process.env.GHL_ACCOUNT_ID;
const GHL_USER_ID     = process.env.GHL_USER_ID;
const BASE_URL        = 'https://services.leadconnectorhq.com';

console.log('[smoke] Iniciando smoke empírico: upload + createPost (Wave 0 / A1/A2/A4/A7)');
console.log('[smoke] Location ID:', GHL_LOCATION_ID);
console.log('[smoke] Account ID (últimos 20 chars):', GHL_ACCOUNT_ID.slice(-20));

// ---------------------------------------------------------------------------
// 2. Gera uma imagem PNG mínima válida de 1x1 px em memória (sem disco)
//    (PNG header + IHDR + IDAT + IEND — suficiente para a API aceitar)
// ---------------------------------------------------------------------------
const PNG_1X1_BUFFER = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR length + type
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // width=1, height=1
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // bit depth=8, colorType=RGB, CRC
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT length + type
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00, // IDAT data (deflate)
  0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc, // IDAT CRC
  0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND length + type
  0x44, 0xae, 0x42, 0x60, 0x82,                   // IEND CRC
]);

const SMOKE_FILE_NAME = `smoke-test-${Date.now()}.png`;
const SMOKE_MIME      = 'image/png';

// ---------------------------------------------------------------------------
// 3. PASSO A: Upload do arquivo para a media library do GHL
//    Valida A4: FormData nativo do Node 24 + Blob funciona para /medias/upload-file
// ---------------------------------------------------------------------------
console.log('[smoke] PASSO A: upload de imagem para media library do GHL...');

let uploadResult;
try {
  const form = new FormData();
  form.append('file', new Blob([PNG_1X1_BUFFER], { type: SMOKE_MIME }), SMOKE_FILE_NAME);
  form.append('name', SMOKE_FILE_NAME);
  form.append('altType', 'location');
  form.append('altId', GHL_LOCATION_ID);
  // NÃO setar Content-Type — FormData define boundary automaticamente (Pitfall 4)

  const res = await fetch(`${BASE_URL}/medias/upload-file`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: GHL_API_VERSION,
      // SEM Content-Type aqui
    },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<sem body>');
    console.error('[smoke] PASSO A FALHOU — upload retornou', res.status);
    console.error('[smoke] Response body (primeiros 500 chars):', body.slice(0, 500));
    console.error('[smoke] DIAGNÓSTICO A4: FormData/Blob nativo do Node 24 pode não ser compatível com este endpoint.');
    console.error('[smoke] Verifique se o endpoint /medias/upload-file aceita multipart/form-data sem hosted=false explícito.');
    process.exit(1);
  }

  const data = await res.json();
  uploadResult = { url: data.url, fileId: data.fileId };
  console.log('[smoke] PASSO A OK — upload concluído');
  console.log('[smoke]   fileId:', uploadResult.fileId ?? '(ausente!)');
  console.log('[smoke]   url (primeiros 60 chars):', (uploadResult.url ?? '').slice(0, 60) + '...');

  if (!uploadResult.url || !uploadResult.fileId) {
    console.error('[smoke] AVISO: upload retornou 200/201 mas url ou fileId estão ausentes no response.');
    console.error('[smoke] Response completo:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
} catch (err) {
  console.error('[smoke] PASSO A — erro de rede/fetch:', err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 4. PASSO B: createPost agendado com a URL retornada pelo upload
//    Valida A2: url do upload pode ser usada em media[].url do createPost
//    Valida A7: GHL_ACCOUNT_ID está correto e é aceito pelo endpoint
//    Valida A1 (parcial): type='post' é aceito (smoke usa Feed estático com 1 mídia)
// ---------------------------------------------------------------------------
console.log('[smoke] PASSO B: criar post agendado de teste no GHL Social Planner...');

// Agenda para +7 dias a partir de agora (não interfere com posts reais próximos)
const scheduleDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const smokePayload = {
  accountIds:   [GHL_ACCOUNT_ID],
  userId:       GHL_USER_ID,
  summary:      `[SMOKE TEST — APAGAR] Teste automático Wave 0 (${new Date().toISOString()})`,
  type:         'post',
  status:       'scheduled',
  scheduleDate: scheduleDate,
  media: [
    { url: uploadResult.url, type: SMOKE_MIME },
  ],
};

let createPostResult;
try {
  const res = await fetch(`${BASE_URL}/social-media-posting/${GHL_LOCATION_ID}/posts`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GHL_TOKEN}`,
      Version: GHL_API_VERSION,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(smokePayload),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<sem body>');
    console.error('[smoke] PASSO B FALHOU — createPost retornou', res.status);
    console.error('[smoke] Response body (primeiros 500 chars):', body.slice(0, 500));
    if (res.status === 422) {
      console.error('[smoke] DIAGNÓSTICO: Erro 422 pode indicar accountId inválido (A7) ou payload malformado.');
      console.error('[smoke] Verifique GHL_ACCOUNT_ID no .env e compare com a saída de ghl.listAccounts().');
    }
    if (res.status === 401 || res.status === 403) {
      console.error('[smoke] DIAGNÓSTICO: Token GHL sem permissões de Social Planner, ou token expirado.');
    }
    process.exit(1);
  }

  const data = await res.json();
  createPostResult = data;

  // Pitfall 7 (confirmado empiricamente Wave 0): o id vem em results.post._id,
  // NÃO em post._id. Fallback mantido para compatibilidade defensiva.
  const postId = data?.results?.post?._id ?? data?.post?._id;
  console.log('[smoke] PASSO B OK — post criado com sucesso');
  console.log('[smoke]   post._id:', postId ?? '(AUSENTE — verificar Pitfall 7 no RESEARCH.md!)');
  console.log('[smoke]   scheduleDate:', scheduleDate);

  if (!postId) {
    console.error('[smoke] AVISO: createPost retornou 200/201 mas post._id está ausente.');
    console.error('[smoke] Response completo:', JSON.stringify(data, null, 2));
    process.exit(1);
  }
} catch (err) {
  console.error('[smoke] PASSO B — erro de rede/fetch:', err.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 5. Sumário final
// ---------------------------------------------------------------------------
console.log('\n[smoke] ========== SMOKE CONCLUIDO COM SUCESSO ==========');
console.log('[smoke] A4 (FormData nativo Node 24): CONFIRMADO');
console.log('[smoke] A2 (url do upload usável em createPost): CONFIRMADO');
console.log('[smoke] A7 (GHL_ACCOUNT_ID correto): CONFIRMADO');
console.log('[smoke] A1 (type=post aceito): CONFIRMADO (smoke com 1 mídia; carrossel com N mídias a confirmar no Plano 02)');
console.log('[smoke] post._id salvo:', createPostResult?.post?._id);
console.log('\n[smoke] ACAO NECESSARIA: Apague/cancele o post de teste "[SMOKE TEST — APAGAR]"');
console.log('[smoke] no GHL Social Planner da conta auton.app.');
console.log('\n[smoke] Reporte no chat: "approved" + o post._id acima (confirma que createPost funcionou).');
