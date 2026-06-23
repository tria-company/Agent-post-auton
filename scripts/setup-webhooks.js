/**
 * scripts/setup-webhooks.js
 *
 * Registra (ou atualiza) o webhook ClickUp de forma IDEMPOTENTE.
 *
 * Fluxo:
 *   1. GET /team/{TEAM_ID}/webhook — lista webhooks existentes
 *   2. Busca webhook cujo endpoint === PUBLIC_WEBHOOK_URL E list_id === LIST_ID
 *   3. Se encontrado → PUT /webhook/{id} (atualiza para garantir status active + eventos corretos)
 *      O PUT NÃO retorna o secret — usar o que está no .env (salvo na criação original).
 *   4. Se não encontrado → POST /team/{TEAM_ID}/webhook (cria novo)
 *      O secret é retornado SOMENTE na criação — imprimir e instrução para salvar no .env.
 *
 * Segurança (T-03-14):
 *   - NUNCA logar o CLICKUP_TOKEN (apenas usado como header de autorização)
 *   - O secret é impresso UMA VEZ via console.log para o operador copiar manualmente
 *   - Nenhum dado sensível vai para arquivos ou logs estruturados
 *
 * Uso:
 *   npm run setup:webhooks
 *   (requer PUBLIC_WEBHOOK_URL no .env — ex.: https://meudominio.com.br/webhook/clickup)
 */

import 'dotenv/config';
import { config } from '../src/config/index.js';

// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------

const BASE = 'https://api.clickup.com/api/v2';
const TEAM_ID = '90132819023';
const LIST_ID = 901327135553; // number — comparar com Number(w.list_id) (Pitfall 7)
const EVENTS = ['taskStatusUpdated'];

// ---------------------------------------------------------------------------
// Verificar que PUBLIC_WEBHOOK_URL está definida (obrigatória para este script)
// ---------------------------------------------------------------------------

const ENDPOINT = config.PUBLIC_WEBHOOK_URL;

if (!ENDPOINT) {
  console.error('');
  console.error('❌ PUBLIC_WEBHOOK_URL não está definida no .env');
  console.error('');
  console.error('Adicione ao .env:');
  console.error('  PUBLIC_WEBHOOK_URL=https://<seu-dominio>/webhook/clickup');
  console.error('');
  console.error('Exemplo (substitua pelo domínio real apontando para o VPS):');
  console.error('  PUBLIC_WEBHOOK_URL=https://auton.example.com.br/webhook/clickup');
  console.error('');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Wrapper de requisição — padrão clickup.js (sem Bottleneck; one-shot script)
// NUNCA logar config.CLICKUP_TOKEN (T-03-14)
// ---------------------------------------------------------------------------

/**
 * Executa uma requisição autenticada à API ClickUp v2.
 *
 * @param {'GET'|'POST'|'PUT'|'DELETE'} method
 * @param {string} path - Caminho relativo (ex.: /team/90132819023/webhook)
 * @param {object|undefined} body - Body JSON (omitido em GET)
 * @returns {Promise<object|null>} - JSON de resposta ou null em 204
 */
async function req(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      // Authorization segue o mesmo padrão de src/clients/clickup.js (linha 47)
      // NUNCA logar este valor (T-03-14)
      Authorization: config.CLICKUP_TOKEN,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ClickUp API ${res.status} ${method} ${path}: ${text}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

// ---------------------------------------------------------------------------
// Main — idempotência: GET → find → PUT se existe / POST se não existe
// ---------------------------------------------------------------------------

async function main() {
  console.log('');
  console.log('=== setup:webhooks ===');
  console.log(`Endpoint alvo : ${ENDPOINT}`);
  console.log(`Team ID       : ${TEAM_ID}`);
  console.log(`List ID       : ${LIST_ID}`);
  console.log(`Eventos       : ${EVENTS.join(', ')}`);
  console.log('');

  // 1. Listar webhooks existentes do team
  console.log('Listando webhooks existentes...');
  const data = await req('GET', `/team/${TEAM_ID}/webhook`);
  const webhooks = data?.webhooks ?? [];
  console.log(`  → ${webhooks.length} webhook(s) encontrado(s) para o team`);

  // 2. Buscar webhook que corresponde ao endpoint E à list_id (Pitfall 7: Number())
  const existing = webhooks.find(
    (w) => w.endpoint === ENDPOINT && Number(w.list_id) === LIST_ID,
  );

  if (existing) {
    // 3. Atualizar webhook existente (idempotente — garante eventos e status corretos)
    console.log(`  → Webhook existente encontrado: ${existing.id}`);
    console.log('Atualizando webhook para garantir status active e eventos corretos...');

    await req('PUT', `/webhook/${existing.id}`, {
      endpoint: ENDPOINT,
      events: EVENTS,
      status: 'active',
    });

    console.log('');
    console.log('✅ Webhook atualizado com sucesso.');
    console.log('');
    console.log('NOTA: O PUT não retorna o webhook secret.');
    console.log('Use o CLICKUP_WEBHOOK_SECRET que já está salvo no seu .env.');
    console.log('Se perdeu o secret, delete o webhook e rode este script novamente.');
    console.log('');
  } else {
    // 4. Criar novo webhook
    console.log('  → Nenhum webhook existente para este endpoint + list_id. Criando...');

    const result = await req('POST', `/team/${TEAM_ID}/webhook`, {
      endpoint: ENDPOINT,
      events: EVENTS,
      list_id: LIST_ID,
    });

    const webhookId = result?.webhook?.id ?? result?.id;
    const secret = result?.webhook?.secret;

    console.log('');
    console.log(`✅ Webhook criado: ${webhookId}`);
    console.log('');

    if (secret) {
      // Imprimir o secret de forma destacada para o operador copiar (T-03-14)
      // Secret é exibido UMA VEZ — não é recuperável via API (Pitfall 4)
      console.log('╔══════════════════════════════════════════════════════════════╗');
      console.log('║  ⚠️  AÇÃO OBRIGATÓRIA — SALVAR NO .env AGORA                ║');
      console.log('║  O secret NÃO é recuperável via API após esta tela fechar.  ║');
      console.log('╚══════════════════════════════════════════════════════════════╝');
      console.log('');
      console.log('Adicione ao seu arquivo .env:');
      console.log('');
      console.log(`CLICKUP_WEBHOOK_SECRET=${secret}`);
      console.log('');
      console.log('Depois reinicie o servidor: npm run serve');
      console.log('');
    } else {
      console.log('AVISO: resposta não continha o secret. Verifique o objeto completo:');
      console.log(JSON.stringify(result, null, 2));
    }
  }
}

main().catch((err) => {
  console.error('');
  console.error('❌ Erro ao configurar webhook:');
  console.error(err.message);
  console.error('');
  process.exit(1);
});
