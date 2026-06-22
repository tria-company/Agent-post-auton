# Phase 2: Agendamento ClickUp → GHL - Pattern Map

**Mapeado:** 2026-06-22
**Arquivos analisados:** 7 (6 modificações + 1 novo)
**Análogos encontrados:** 6 / 7 (1 sem análogo direto — `src/lib/zip.js`)

---

## Classificação de Arquivos

| Arquivo novo/modificado | Role | Data Flow | Análogo mais próximo | Qualidade |
|-------------------------|------|-----------|----------------------|-----------|
| `src/config/index.js` | config | — | `src/config/index.js` (próprio) | exact — só adicionar campos |
| `src/clients/clickup.js` | client/service | request-response | `src/clients/clickup.js` (próprio) | exact — adicionar método |
| `src/clients/ghl.js` | client/service | request-response | `src/clients/ghl.js` (próprio) | exact — adicionar métodos |
| `src/lib/zip.js` | utility | file-I/O | `src/lib/errors.js` (estrutura de módulo) | partial — sem análogo funcional |
| `src/scheduler/pipeline.js` | service/orchestrator | batch | `src/index.js` (boot sequencial + try/catch) | role-match |
| `src/index.js` | entrypoint | request-response | `src/index.js` (próprio) | exact — adicionar branch |
| `package.json` | config | — | `package.json` | exact — adicionar dep |

---

## Pattern Assignments

### `src/config/index.js` (config — modificação)

**Análogo:** `src/config/index.js` (próprio arquivo — adicionar 6 variáveis)

**Padrão de schema zod** (linhas 19–41 do arquivo atual):
```javascript
const EnvSchema = z.object({
  // ClickUp
  CLICKUP_TOKEN: z.string().startsWith('pk_', { message: 'CLICKUP_TOKEN deve começar com pk_' }),
  CLICKUP_LIST_ID: z.string().min(1, { message: 'CLICKUP_LIST_ID é obrigatório' }),

  // Custom fields do ClickUp (UUIDs) — nomes no .env usam prefixo CU_FIELD_
  CU_FIELD_LEGENDA: z.string().uuid({ message: 'CU_FIELD_LEGENDA deve ser um UUID válido' }),
  // … demais campos existentes …

  // LOG_LEVEL com default:
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
});
```

**Novos campos a inserir no EnvSchema** (copiar padrão `.uuid()` para campos UUID, `.min(1)` para strings simples, `.default()` para opcionais com valor padrão):
```javascript
// Phase 2 — custom fields novos
CU_FIELD_GHL_POST_ID:  z.string().uuid({ message: 'CU_FIELD_GHL_POST_ID deve ser um UUID válido' }),
CU_FIELD_LINK_DO_POST: z.string().uuid({ message: 'CU_FIELD_LINK_DO_POST deve ser um UUID válido' }),
CU_FIELD_FORMATO:      z.string().uuid({ message: 'CU_FIELD_FORMATO deve ser um UUID válido' }),
// Phase 2 — conta GHL e nomes de status
GHL_ACCOUNT_ID:    z.string().min(1, { message: 'GHL_ACCOUNT_ID é obrigatório' }),
STATUS_A_AGENDAR:  z.string().min(1).default('a agendar'),
STATUS_AGENDADO:   z.string().min(1).default('agendado'),
```

**Padrão de exportação Object.freeze + aliases CF_*** (linhas 73–87):
```javascript
export const config = Object.freeze({
  // … campos existentes …
  // Aliases CF_* (interfaces do plano) mapeados de CU_FIELD_*
  CF_LEGENDA:          env.CU_FIELD_LEGENDA,
  CF_DATA_PUBLICACAO:  env.CU_FIELD_DATA_PUBLICACAO,
  // … demais aliases existentes …
});
```

**Novos aliases a adicionar no Object.freeze** (mesma convenção `CF_* = env.CU_FIELD_*`; campos sem prefixo `CU_FIELD_` passam direto):
```javascript
CF_GHL_POST_ID:  env.CU_FIELD_GHL_POST_ID,
CF_LINK_DO_POST: env.CU_FIELD_LINK_DO_POST,
CF_FORMATO:      env.CU_FIELD_FORMATO,
GHL_ACCOUNT_ID:  env.GHL_ACCOUNT_ID,
STATUS_A_AGENDAR: env.STATUS_A_AGENDAR,
STATUS_AGENDADO:  env.STATUS_AGENDADO,
```

**Padrão de fail-fast** (linhas 43–50): não alterar — `safeParse` + `process.exit(1)` já cobre os novos campos automaticamente.

---

### `src/clients/clickup.js` (client — adicionar `getListTasks`)

**Análogo:** `src/clients/clickup.js` (próprio — mesmo arquivo; adicionar método ao objeto exportado)

**Padrão de método no objeto exportado** (linhas 117–166):
```javascript
export const clickup = {
  getList:       (listId)              => request('GET',  `/list/${listId}`),
  getListFields: (listId)              => request('GET',  `/list/${listId}/field`),
  getTask:       (taskId)              => request('GET',  `/task/${taskId}`),
  updateTask:    (taskId, patch)       => request('PUT',  `/task/${taskId}`, patch),
  setCustomField:(taskId, fieldId, value) =>
    request('POST', `/task/${taskId}/field/${fieldId}`, { value }),
};
```

**Novo método `getListTasks`** — copiar estrutura de `getListFields` para o wrapper simples, mas com lógica de paginação (loop `while (true)`) que deve ficar dentro do método (não no `request`):
```javascript
/**
 * Lista tasks de uma lista com filtro por status — paginação automática.
 * GET /list/{id}/task?statuses[]=...&page=N
 *
 * @param {string} listId
 * @param {string} statusFilter - valor exato do status (ex: config.STATUS_A_AGENDAR)
 * @returns {Promise<Array<object>>}
 */
getListTasks: async (listId, statusFilter) => {
  const tasks = [];
  let page = 0;
  while (true) {
    const params = new URLSearchParams();
    params.append('statuses[]', statusFilter);
    params.append('include_closed', 'false');
    params.append('subtasks', 'false');
    params.append('page', String(page));
    const result = await request('GET', `/list/${listId}/task?${params}`);
    if (!result?.tasks?.length) break;
    tasks.push(...result.tasks);
    page++;
  }
  return tasks;
},
```

**Padrão de throttle via Bottleneck** (linhas 26–31 + 43): todos os requests passam por `limiter.schedule(...)` — o novo método chama `request()` que já está envolto no limiter; sem alteração necessária no throttle.

**Padrão de retry/AbortError** (linhas 44–109): herdado automaticamente via `request()` — não replicar no método novo.

---

### `src/clients/ghl.js` (client — adicionar `uploadMedia` + expandir `createPost`)

**Análogo:** `src/clients/ghl.js` (próprio arquivo)

**Padrão `authHeaders()`** (linhas 26–33) — reutilizar para o upload multipart, mas **sem `Content-Type`** no caso do FormData:
```javascript
function authHeaders() {
  return {
    Authorization: `Bearer ${config.GHL_TOKEN}`,
    Version: config.GHL_API_VERSION,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}
```

**Novo método `uploadMedia`** — NÃO passa pelo `request()` wrapper (que adiciona `Content-Type: application/json`); faz fetch direto para preservar o boundary do FormData. Ainda envolve em `pRetry` para herdar o padrão de retry:
```javascript
/**
 * Faz upload de um arquivo para a media library do GHL.
 * POST /medias/upload-file (multipart/form-data)
 *
 * NÃO usa request() pois o Content-Type deve ser definido pelo FormData (boundary).
 *
 * @param {Buffer} fileBuffer
 * @param {string} fileName
 * @param {string} mimeType
 * @returns {Promise<{url: string, fileId: string}>}
 */
uploadMedia: (fileBuffer, fileName, mimeType) =>
  pRetry(
    async (attemptNumber) => {
      const form = new FormData();
      form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
      form.append('name', fileName);
      form.append('altType', 'location');
      form.append('altId', config.GHL_LOCATION_ID);
      // NÃO setar Content-Type — FormData define com boundary automaticamente
      const res = await fetch(`${BASE_URL}/medias/upload-file`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.GHL_TOKEN}`,
          Version: config.GHL_API_VERSION,
        },
        body: form,
      });
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter ? Number(retryAfter) * 1000 : 5_000;
        log.warn({ status: 429, waitMs, attempt: attemptNumber }, 'GHL rate limit (upload) — aguardando');
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        throw new Error(`Rate limited (429) — tentativa ${attemptNumber}`);
      }
      if (res.status >= 500) throw new Error(`GHL server error ${res.status}`);
      if (!res.ok) {
        const appErr = await AppError.fromGHL(res);
        log.warn({ status: appErr.status, code: appErr.code }, 'GHL upload erro não-retentável');
        throw new AbortError(appErr);
      }
      const data = await res.json();
      return { url: data.url, fileId: data.fileId };
    },
    { retries: 3, minTimeout: 1_000, factor: 2,
      onFailedAttempt(error) {
        if (error instanceof AbortError) return;
        log.warn({ attempt: error.attemptNumber, retriesLeft: error.retriesLeft }, 'GHL upload falhou — retentando');
      },
    },
  ),
```

**`createPost` existente** (linhas 118–119) — já aponta para o endpoint correto; o stub é suficiente para o payload real. Apenas expandir o JSDoc e confirmar que `response.post._id` é o campo correto:
```javascript
createPost: (payload) =>
  request('POST', `/social-media-posting/${config.GHL_LOCATION_ID}/posts`, payload),
// payload esperado: { accountIds, summary, type, scheduleDate, media, status: 'scheduled' }
// resposta: { post: { _id: '...', status: 'scheduled', ... } }
```

---

### `src/lib/zip.js` (utility — novo arquivo)

**Análogo funcional:** sem análogo direto no projeto (primeiro módulo de file-I/O). Usar como referência a estrutura de módulo de `src/lib/errors.js` (linhas 1–70): arquivo `.js` puro sem dependências circulares, exportações nomeadas, JSDoc por função.

**Padrão de estrutura de módulo lib** (de `src/lib/errors.js` linhas 1–10):
```javascript
/**
 * src/lib/zip.js
 *
 * [descrição do módulo]
 */

export class/function ... { ... }
```

**Conteúdo a implementar** (baseado em RESEARCH.md Pattern MinIO/Zip, linhas 554–616):
```javascript
import AdmZip from 'adm-zip';
import { tmpdir } from 'node:os';
import { join, relative, resolve, basename, extname } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';

const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',  '.mov': 'video/quicktime',
};

export function mimeFromFilename(filename) {
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

export async function downloadAndExtract(zipUrl) { /* ... */ }
export async function cleanupTmp(tmpDir) { /* ... */ }
```

**Pontos críticos obrigatórios no `downloadAndExtract`:**
1. Validar protocolo da URL (SSRF guard) — `new URL(zipUrl)` + checar `url.protocol === 'https:'`
2. Verificar magic bytes do zip antes de criar `AdmZip` — primeiros 4 bytes devem ser `PK\x03\x04`
3. Limite de 100 MB no download (zip-bomb guard) — checar `buf.byteLength` antes de descomprimir
4. ZIP-SLIP GUARD obrigatório — usar `basename(entry.entryName)` + validar `relative(tmpDir, resolve(tmpDir, name))` não começa com `..`
5. Filtrar `__MACOSX`, `.DS_Store` e diretórios
6. Ordenar por nome numérico: `files.sort((a, b) => parseInt(a.name) - parseInt(b.name))`

**`cleanupTmp`** — sempre silencioso (`.catch(() => {})`):
```javascript
export async function cleanupTmp(tmpDir) {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
```

---

### `src/scheduler/pipeline.js` (service/orchestrator — novo arquivo)

**Análogo:** `src/index.js` — passo a passo sequencial com `withContext`, try/catch por etapa, logging estruturado.

**Padrão de logging estruturado com ação** (de `src/index.js` linhas 27–35):
```javascript
const log = withContext({ action: 'boot' });
log.info({ step: 'config' }, 'Config carregada e validada do .env');
log.info({ step: 'clickup.getList', listId: config.CLICKUP_LIST_ID }, 'Autenticando no ClickUp...');
```

**Replicar para o pipeline:**
```javascript
// Topo do arquivo
const log = withContext({ module: 'scheduler', action: 'runSchedulerBatch' });

// Por task: child logger com taskId
const taskLog = withContext({ module: 'scheduler', taskId: task.id });
```

**Padrão de try/catch isolado por iteração** (de `src/index.js` linhas 52–88 — o catch do getListFields não interrompe o boot):
```javascript
// Cada task tem seu próprio try/catch; erro não aborta o batch
for (const task of eligibleTasks) {
  try {
    await processTask(task, formatoOptionsMap);
  } catch (err) {
    taskLog.error({ err: err?.message }, 'Falha ao processar task — continuando batch');
    // write-back do erro ao ClickUp (setCustomField CF_ERRO_PUBLICACAO)
  }
}
```

**Padrão de imports** (replicar de `src/index.js` linhas 14–17):
```javascript
import { config } from '../config/index.js';
import { withContext } from '../lib/logger.js';
import { clickup } from '../clients/clickup.js';
import { ghl } from '../clients/ghl.js';
import { AppError } from '../lib/errors.js';
import { downloadAndExtract, cleanupTmp, mimeFromFilename } from '../lib/zip.js';
```

**Função exportada principal:**
```javascript
/**
 * Executa uma passada batch sobre as tasks elegíveis.
 * @returns {Promise<void>}
 */
export async function runSchedulerBatch() { ... }
```

**Idempotência — verificar GHL Post ID antes de qualquer chamada ao GHL** (D-02):
```javascript
function readCF(task, fieldId) {
  return task.custom_fields?.find(f => f.id === fieldId)?.value ?? null;
}

// No filtro de elegibilidade (após getListTasks):
const eligible = tasks.filter(t => {
  const ghlPostId = readCF(t, config.CF_GHL_POST_ID);
  return !ghlPostId; // pular tasks que já têm GHL Post ID
});
```

**Mapeamento Formato → GHL** (de RESEARCH.md Pattern 5):
```javascript
const FORMATO_MAP = {
  'Reels':         { ghlType: 'reel',  mediaCount: 'single'   },
  'Carrossel':     { ghlType: 'post',  mediaCount: 'multiple' },
  'Feed estático': { ghlType: 'post',  mediaCount: 'single'   },
};
```

**Sequência obrigatória de write-back** (D-14 + anti-pattern do RESEARCH.md):
```javascript
// Sucesso: gravar status ANTES de setCustomField (atômico — ok falhar um dos dois)
await clickup.updateTask(task.id, { status: config.STATUS_AGENDADO });
await clickup.setCustomField(task.id, config.CF_GHL_POST_ID, post._id);

// Falha: NÃO mudar status; só gravar mensagem curta sem stack trace e sem URL
await clickup.setCustomField(task.id, config.CF_ERRO_PUBLICACAO, mensagemCurta);
```

**Conversão de data ClickUp → GHL** (de RESEARCH.md Pitfall 3):
```javascript
// epochMs vem como string do ClickUp
const scheduleDate = new Date(Number(epochMs)).toISOString(); // ex: "2026-06-25T14:00:00.000Z"
```

**Limpeza de tmp com try/finally** (D-11):
```javascript
let tmpDir;
try {
  const extracted = await downloadAndExtract(linkDoPost);
  tmpDir = extracted.tmpDir;
  // ... upload, createPost, write-back ...
} finally {
  if (tmpDir) await cleanupTmp(tmpDir);
}
```

---

### `src/index.js` (entrypoint — modificação)

**Análogo:** `src/index.js` (próprio — adicionar branch após boot)

**Padrão de entrypoint com isEntrypoint** (linhas 96–107):
```javascript
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const isEntrypoint = process.argv[1] === __filename;

if (isEntrypoint || process.env.DIRECT_RUN === '1') {
  const log = withContext({ action: 'boot' });
  boot().catch((err) => {
    log.fatal({ err }, 'Falha fatal no boot — encerrando');
    process.exit(1);
  });
}
```

**Extensão para Phase 2** — adicionar importação e chamada de `runSchedulerBatch()` após `boot()` quando `!process.env.SMOKE_ONLY`:
```javascript
import { runSchedulerBatch } from './scheduler/pipeline.js';

export async function boot() { /* … código existente … */ }

if (isEntrypoint || process.env.DIRECT_RUN === '1') {
  const log = withContext({ action: 'main' });
  (async () => {
    await boot();
    if (!process.env.SMOKE_ONLY) {
      await runSchedulerBatch();
    }
  })().catch((err) => {
    log.fatal({ err }, 'Falha fatal — encerrando');
    process.exit(1);
  });
}
```

---

## Shared Patterns (padrões transversais)

### Auth e Headers
**Fonte:** `src/clients/clickup.js` linhas 48–55; `src/clients/ghl.js` linhas 26–33
**Aplicar a:** todos os novos requests dentro dos clients
```javascript
// ClickUp — header direto (sem "Bearer")
Authorization: config.CLICKUP_TOKEN
// GHL — com "Bearer"
Authorization: `Bearer ${config.GHL_TOKEN}`
Version: config.GHL_API_VERSION
// Upload multipart — NÃO incluir Content-Type (FormData define com boundary)
```

### Retry com AbortError para 4xx
**Fonte:** `src/clients/clickup.js` linhas 83–88; `src/clients/ghl.js` linhas 69–73
**Aplicar a:** `uploadMedia` no `src/clients/ghl.js`
```javascript
if (!res.ok) {
  const appErr = await AppError.fromGHL(res);   // ou fromClickUp
  log.warn({ status: appErr.status, code: appErr.code, attempt: attemptNumber }, '…');
  throw new AbortError(appErr);   // não-retentável
}
```

### Logging estruturado com withContext
**Fonte:** `src/clients/clickup.js` linha 18; `src/index.js` linhas 28–35
**Aplicar a:** `src/scheduler/pipeline.js` e `src/lib/zip.js`
```javascript
// Por módulo (topo do arquivo):
const log = withContext({ module: 'scheduler' });

// Por ação/task (dentro da função):
const taskLog = withContext({ module: 'scheduler', taskId: task.id, action: 'processTask' });
taskLog.info({ step: 'resolveContent' }, 'Resolvendo conteúdo...');

// NUNCA logar URL pre-signed do MinIO — só taskId e fileName
taskLog.info({ step: 'downloadZip', fileName: '…' }, 'Zip baixado');
```

### Normalização de erro para `Erro de publicação`
**Fonte:** `src/lib/errors.js` linhas 34–69
**Aplicar a:** `src/scheduler/pipeline.js` — bloco catch de cada task
```javascript
// Extrair mensagem curta sem stack trace, sem URL, sem token
const mensagem = err instanceof AppError
  ? err.message                           // já normalizado pelo client
  : String(err?.message ?? 'Erro desconhecido').slice(0, 200);
await clickup.setCustomField(task.id, config.CF_ERRO_PUBLICACAO, mensagem);
```

### Leitura de custom fields da task
**Fonte:** RESEARCH.md Pattern 2 (linhas 261–285) — não existe helper no código Phase 1; criar em `pipeline.js`
```javascript
// Helper local (não exposto fora do pipeline)
function readCF(task, fieldId) {
  return task.custom_fields?.find(f => f.id === fieldId)?.value ?? null;
}
// date: Number(readCF(task, config.CF_DATA_PUBLICACAO))
// text: readCF(task, config.CF_LEGENDA)
// dropdown: orderindex → buscar nome em formatoOptionsMap
```

---

## Arquivos sem Análogo Funcional

| Arquivo | Role | Data Flow | Razão |
|---------|------|-----------|-------|
| `src/lib/zip.js` | utility | file-I/O | Nenhum módulo de file-I/O existe no projeto; primeiro helper de sistema de arquivos. Usar RESEARCH.md Pattern MinIO/Zip (linhas 554–616) como blueprint. Estrutura de módulo (exportações nomeadas, JSDoc) copiar de `src/lib/errors.js`. |

---

## Metadata

**Escopo de busca de análogos:** `src/` inteiro (6 arquivos da Phase 1)
**Arquivos lidos:** 6 (config, clickup, ghl, logger, errors, index)
**Data de extração:** 2026-06-22
