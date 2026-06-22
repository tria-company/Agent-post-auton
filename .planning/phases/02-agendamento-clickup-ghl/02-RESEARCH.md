# Phase 2: Agendamento ClickUp → GHL - Research

**Researched:** 2026-06-22
**Domain:** ClickUp API v2 (leitura de tasks + escrita de custom fields) + GHL Social Planner API (upload de mídia + criação de post agendado) + unzip de arquivos do MinIO
**Confidence:** MEDIUM (GHL Social Planner schema confirmado via implementação real de referência; ClickUp confirmado via docs oficiais; campos reais confirmados via codigo Phase 1)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Idempotência e persistência do post GHL (SCH-05/SCH-06)**
- D-01: O id do post GHL é gravado em um novo custom field dedicado "GHL Post ID" (text). Não reusar `IG Media ID`.
- D-02: Idempotência = se a task já tem "GHL Post ID" preenchido, pular.
- D-03 (setup): Usuário cria "GHL Post ID" no ClickUp e fornece UUID; planner adiciona `CU_FIELD_GHL_POST_ID` → alias `CF_GHL_POST_ID` no config.

**Fonte de legenda e mídia (SCH-02)**
- D-04: Resolução com fallback para task mãe quando vazio, campo a campo.
- D-05: Legenda vem do campo `Legenda` (`CF_LEGENDA`), fallback p/ mãe.
- D-06: Mídia NÃO vem de anexos do ClickUp. Vem de zip no MinIO, cuja URL está no campo `Link do post` (campo distinto de `Link publicado`). Planner adiciona `CU_FIELD_LINK_DO_POST` → `CF_LINK_DO_POST` no config.
- D-07: Se após o fallback faltar legenda ou mídia → falha de validação (não agenda).

**Entrega da mídia ao GHL (SCH-03)**
- D-08: URL do MinIO é pre-signed/pública — download direto, sem credenciais.
- D-09: Baixar zip → descompactar em tmp → ordenar numericamente → upload dos arquivos extraídos para a media library do GHL → usar referências retornadas ao criar o post.
- D-10: Carrossel = todos os arquivos em ordem numérica; Reels/Feed = único (ou primeiro). Tipo inferido por extensão.
- D-11: Limpar diretório temporário após agendar ou em falha.

**Formato → tipo de post GHL (SCH-04/SCH-07)**
- D-12: Mapear Formato do ClickUp → tipo/flags do post GHL para Reels, Carrossel e Feed estático.
- D-13: Stories NÃO agendado nesta fase — tratado como inválido.
- D-14: Task inválida/ambígua → não agenda, preenche `Erro de publicação`, mantém `a agendar`.
- D-15: Conteúdo de `Erro de publicação`: mensagem curta sem stack trace, sem segredos.

**Status e nomes (SCH-01/SCH-05)**
- D-16: Detecção: status `a agendar` + `Data de publicação` preenchida. Transição de sucesso: `a agendar` → `agendado`. Nomes viram config no `.env`.

**Conta GHL e tipo de execução**
- D-17: Conta Instagram `auton.app` (account id já no PROJECT.md). O account id vira config no `.env`.
- D-18: Passada batch única, acionável manualmente. Falha isolada em uma task não aborta as demais.

### Claude's Discretion

- Estrutura interna dos módulos (ex.: `scheduler`/`pipeline` que orquestra a passada).
- Biblioteca de unzip e manejo de arquivos temporários.
- Métodos novos nos clients ClickUp e GHL.
- Formato exato do payload de `createPost` e endpoint de upload de mídia.
- Parsing/normalização da data do ClickUp → formato do GHL.
- Logging estruturado de cada ação.

### Deferred Ideas (OUT OF SCOPE)

- Webhook GHL→ClickUp (Fase 3).
- Loop contínuo, backoff resiliente, README de deploy (Fase 4).
- `IG Media ID`, `Link publicado`, `Primeiro comentário`, métricas — Fase 3/v2.
- Suporte a Stories e outras redes/contas — fora do v1.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCH-01 | Detectar tasks da lista com status `a agendar` e `Data de publicação` preenchida | ClickUp GET /list/{id}/task com `statuses[]=a%20agendar` + custom_fields filter IS NOT NULL para o campo Data de publicação |
| SCH-02 | Resolver conteúdo do post — legenda (CF_LEGENDA, fallback task mãe) e mídia (CF_LINK_DO_POST, fallback task mãe) | clickup.getTask(parentId) para fallback; leitura de custom_fields no response da task |
| SCH-03 | Disponibilizar a mídia para o GHL (upload na media library) | Fetch pre-signed URL → unzip → POST /medias/upload-file multipart → URLs retornadas usadas no createPost |
| SCH-04 | Criar post agendado no GHL Social Planner para a conta Instagram, no horário correto, respeitando o Formato | POST /social-media-posting/{locationId}/posts com campos confirmados; Formato mapeado para type='reel'\|'post' + contagem de arquivos para carrossel |
| SCH-05 | Em sucesso: mover task para `agendado` + persistir id do post GHL no campo CF_GHL_POST_ID | clickup.updateTask(id, {status: 'agendado'}) + clickup.setCustomField(id, CF_GHL_POST_ID, post._id) |
| SCH-06 | Idempotência — não reagenda task que já tem id de post GHL | Verificar CF_GHL_POST_ID preenchido antes de qualquer chamada ao GHL |
| SCH-07 | Em falha: preencher Erro de publicação e manter `a agendar` | clickup.setCustomField(id, CF_ERRO_PUBLICACAO, mensagem curta) — status não muda |
</phase_requirements>

---

## Summary

A Phase 2 implementa o fluxo de valor principal: ler tasks `a agendar` do ClickUp com data de publicação, resolver legenda e mídia (via zip no MinIO com fallback para task mãe), fazer upload da mídia para a media library do GHL, criar o post agendado no Social Planner e sincronizar o status de volta.

A pesquisa confirmou o schema real do payload GHL via implementação de referência (MCP server oficial). Os campos críticos são: `accountIds` (array de strings), `summary` (legenda), `type` ('post' para feed/carrossel, 'reel' para Reels), `scheduleDate` (ISO string), `media` (array de objetos `{url, caption?, type?}`), `status: 'scheduled'`. O id do post criado é retornado em `response.post._id`. Para carrossel, o GHL usa multiplos objetos no array `media` com `type: 'post'` — não existe um tipo 'carousel' separado; a presença de múltiplas mídias cria o carrossel automaticamente no Instagram.

O upload de mídia usa `POST /medias/upload-file` (multipart/form-data) com o campo `file` (binário), retorna `{fileId, url, ...}`. A URL retornada é passada no campo `media[].url` do create post. Para o unzip, a biblioteca recomendada é `adm-zip` (17M downloads/semana, OK no audit, ESM-compatível via import padrão em Node 24, API síncrona simples para buffers em memória), com guarda explícita de zip-slip usando `path.relative` + `startsWith`.

**Primary recommendation:** Implementar um módulo `src/scheduler/pipeline.js` que orquestra: queryEligibleTasks → para cada task: resolveContent → downloadAndExtractZip → uploadMediaToGHL → createScheduledPost → writeBackToClickUp. Erros isolados por task com `try/catch` e write-back para `Erro de publicação`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Leitura de tasks elegíveis (status + data) | API client ClickUp | — | Já existe client autenticado; novo método `getListTasks` |
| Resolução de conteúdo (legenda + mídia) com fallback | Pipeline / scheduler | ClickUp client | Lógica de negócio; usa `getTask` existente para buscar a mãe |
| Download do zip do MinIO | Pipeline / scheduler | Node fetch nativo | URL pre-signed pública; fetch direto sem credenciais |
| Descompactação e ordenação | lib/zip (novo helper) | — | Encapsula adm-zip + proteção zip-slip |
| Upload de mídia para GHL | GHL client (novo método) | — | Consistente com pattern de client autenticado existente |
| Criação de post agendado no GHL | GHL client (expande createPost) | — | Stub já existe; preencher payload real |
| Write-back para ClickUp (status + GHL Post ID + erro) | ClickUp client | — | Já existem `updateTask` e `setCustomField` |
| Orquestração da passada batch | src/scheduler/pipeline.js | src/index.js | Separação entre loop e lógica; index.js chama `runSchedulerBatch()` |
| Limpeza de arquivos temporários | lib/zip (mesmo helper) | — | Garante cleanup mesmo em caso de erro |

---

## Standard Stack

### Core (herdada da Phase 1 — nada muda)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.14.x | Runtime | Já instalado; `fetch` nativo; ESM nativo |
| `bottleneck` | 2.19.x | Rate limit ClickUp | Já no projeto |
| `p-retry` | 8.0.x | Retry/backoff | Já no projeto |
| `pino` | 10.3.x | Logging estruturado | Já no projeto |
| `zod` | 4.4.x | Validação de config | Já no projeto |

### Nova dependência — unzip
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `adm-zip` | 0.5.17 | Descompactar zip baixado do MinIO em buffer | API síncrona simples para buffer em memória; 17M downloads/semana; OK no audit de legitimidade; zero deps de stream que podem travar; zip-slip mitigado manualmente com `path.relative` |

**Versão verificada:**
```
adm-zip   0.5.17   (mod 2026-04-01)   verdict: OK
```
[VERIFIED: npm view + gsd-tools package-legitimacy audit]

### Alternativas de unzip consideradas

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `adm-zip` | `unzipper` 0.12.5 | unzipper usa streaming (melhor para arquivos grandes) mas flagged SUS por versão muito recente publicada em 2026-06-21 (mesmo que legítimo — tem ~15M downloads/semana e commit de segurança zip-slip em 10/jun). Pode ser usado se o planner confirmar, mas adm-zip é mais conservador para esta fase. |
| `adm-zip` | `node-stream-zip` 1.15.0 | Bom para streaming, API async; mas última publicação em 2021. Mantém funcional. Opção válida se streaming for crítico. |

**Nota sobre ESM:** Todos os três são CJS. Em projeto `"type": "module"`, o Node 24 permite importar CJS com `import AdmZip from 'adm-zip'` (default import). Funciona diretamente — não precisa de `createRequire`. [VERIFIED: Node.js ESM/CJS interop docs]

**Installation:**
```bash
npm install adm-zip
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads/semana | Source Repo | Verdict | Disposition |
|---------|----------|-----|-------------------|-------------|---------|-------------|
| `adm-zip` | npm | ~13 anos | 17,812,761 | github.com/cthackers/adm-zip | OK | Aprovado |
| `unzipper` | npm | ~9 anos | 15,203,095 | github.com/ZJONSSON/node-unzipper | SUS (too-new: última release 2026-06-21) | Sinalizado — verificar antes de usar |
| `node-stream-zip` | npm | ~5 anos | 4,889,969 | github.com/antelle/node-stream-zip | OK | Aprovado (alternativa) |

**Packages removed due to SLOP verdict:** none

**Packages flagged as suspicious (SUS):** `unzipper` — a versão 0.12.5 foi publicada em 2026-06-21 (ontem). O projeto GitHub tem 9 anos de histórico legítimo, commits regulares e o commit mais recente corrige um zip-slip. A flag SUS é técnica (too-new), não indica malícia. Se o planner escolher `unzipper`, inserir um `checkpoint:human-verify` antes da instalação.

---

## Architecture Patterns

### System Architecture Diagram

```
npm start
    │
    ▼
src/index.js
    │  chama
    ▼
src/scheduler/pipeline.js: runSchedulerBatch()
    │
    ├─1─► clickup.getListTasks(listId, {status:'a agendar'})
    │        └─ GET /list/{id}/task?statuses[]=...&subtasks=false&page=N
    │           (paginação automática até tasks=[])
    │
    ├─2─► para cada task elegível (GHL Post ID vazio):
    │        │
    │        ├─a─► resolveContent(task)
    │        │       ├── lê CF_LEGENDA da task filha
    │        │       ├── se vazio: clickup.getTask(CF_ID_TASK_MAE) → pega da mãe
    │        │       ├── lê CF_LINK_DO_POST da filha
    │        │       └── se vazio: pega da mãe
    │        │
    │        ├─b─► downloadAndExtract(linkDoPost)
    │        │       ├── fetch(pre-signed URL) → ArrayBuffer
    │        │       ├── AdmZip(buffer) → entries
    │        │       ├── filtrar arquivos (sem __MACOSX, sem diretórios)
    │        │       ├── GUARDAR ZIP-SLIP: path.relative check
    │        │       ├── ordenar por nome numérico crescente
    │        │       └── retorna [{name, buffer, mimeType}]
    │        │
    │        ├─c─► uploadMediaToGHL(files[])
    │        │       ├── para cada file: POST /medias/upload-file (multipart)
    │        │       └── retorna [{url, fileId}]
    │        │
    │        ├─d─► ghl.createPost(payload)
    │        │       ├── POST /social-media-posting/{locationId}/posts
    │        │       ├── accountIds: [config.GHL_ACCOUNT_ID]
    │        │       ├── summary: legenda
    │        │       ├── type: 'reel' (Reels) | 'post' (Carrossel/Feed)
    │        │       ├── scheduleDate: new Date(epochMs).toISOString()
    │        │       ├── media: [{url, type: mimeType}]
    │        │       └── status: 'scheduled'
    │        │
    │        └─e─► write-back ao ClickUp
    │               ├── sucesso: updateTask(status:'agendado')
    │               │           + setCustomField(CF_GHL_POST_ID, post._id)
    │               └── falha: setCustomField(CF_ERRO_PUBLICACAO, mensagem)
    │                          (status permanece 'a agendar')
    │
    └─3─► limpeza de arquivos temporários (try/finally)
```

### Recommended Project Structure
```
src/
├── clients/
│   ├── clickup.js       # + novo método getListTasks (Phase 2)
│   └── ghl.js           # + método uploadMedia, expande createPost
├── config/
│   └── index.js         # + 4 novas vars: CU_FIELD_GHL_POST_ID, CU_FIELD_LINK_DO_POST,
│                        #                  CU_FIELD_FORMATO, GHL_ACCOUNT_ID,
│                        #                  STATUS_A_AGENDAR, STATUS_AGENDADO
├── lib/
│   ├── logger.js        # inalterado
│   ├── errors.js        # inalterado
│   └── zip.js           # novo: downloadAndExtract, cleanup (adm-zip + zip-slip guard)
├── scheduler/
│   └── pipeline.js      # novo: runSchedulerBatch, processTask
└── index.js             # + chama runSchedulerBatch() se !isSmoke
```

### Pattern 1: Listagem paginada de tasks elegíveis

**What:** GET /list/{id}/task aceita `statuses[]` como parâmetro repetido na query string. Paginação com `page=0,1,2...` até o retorno ter `tasks: []`.

**When to use:** Sempre que precisar listar tasks de uma lista por status.

```javascript
// Source: developer.clickup.com/reference/gettasks (verificado)
async function getListTasks(listId, statusFilter) {
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
}
```

### Pattern 2: Leitura de custom field em uma task

**What:** O array `custom_fields` de cada task retorna objetos `{id, value, ...}`. O `value` depende do tipo:
- **text/url**: `string` (ou `null` se vazio)
- **date**: epoch ms como `string` (ex: `"1751241600000"`) — ou `null` se não preenchido
- **drop_down**: `orderindex` como número (ex: `0` = primeira opção) — ou `null` se não selecionado

```javascript
// Source: developer.clickup.com/docs/customfields + community examples
function readCF(task, fieldId) {
  const field = task.custom_fields?.find(f => f.id === fieldId);
  return field?.value ?? null;
}

// Para dropdown: converter orderindex para nome da opção
function readDropdown(task, fieldId, listFieldDef) {
  const orderindex = readCF(task, fieldId);
  if (orderindex == null) return null;
  const opts = listFieldDef?.type_config?.options ?? [];
  return opts.find(o => String(o.orderindex) === String(orderindex))?.name ?? null;
}

// Para data: epoch ms string → Date
function readDate(task, fieldId) {
  const epochMs = readCF(task, fieldId);
  return epochMs ? new Date(Number(epochMs)) : null;
}
```

**IMPORTANTE — escrita vs leitura de dropdown:**
- **Leitura (GET task)**: `value` = `orderindex` (posição numérica da opção selecionada)
- **Escrita (POST field)**: `value` = `id` da opção (UUID), NÃO o orderindex

[VERIFIED: developer.clickup.com/docs/customfields]

### Pattern 3: Gravação de custom field no ClickUp

```javascript
// Source: developer.clickup.com/docs/customfields
// text/url: { value: "string" }
await clickup.setCustomField(taskId, CF_GHL_POST_ID, ghlPostId);

// date: { value: epochMs (integer) } — já existe no client como setCustomField(id, fid, value)
// (o setCustomField existente envolve o value em { value } — correto para text)

// Para date com horário: payload especial (não usado nesta fase p/ escrita, só leitura)
// { value: 1565993299379, value_options: { time: true } }
```

### Pattern 4: GHL — Upload de mídia e criação de post

```javascript
// Source: github.com/mastanley13/GoHighLevel-MCP (implementação de referência) [MEDIUM]
//         marketplace.gohighlevel.com/docs/ghl/medias/upload-media-content [MEDIUM]

// Passo 1: upload multipart para media library
async function uploadMedia(fileBuffer, fileName, mimeType) {
  const form = new FormData();
  form.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);
  form.append('name', fileName);
  form.append('altType', 'location');
  form.append('altId', config.GHL_LOCATION_ID);
  // NÃO passar Content-Type manualmente (FormData define o boundary)
  const res = await fetch(`${BASE_URL}/medias/upload-file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.GHL_TOKEN}`, Version: config.GHL_API_VERSION },
    body: form,
  });
  const data = await res.json();
  return data.fileId ? { url: data.url, fileId: data.fileId } : null;
}

// Passo 2: criar post agendado
async function createPost(payload) {
  // payload.media = [{ url: '<url do upload>', type: '<mimeType>' }]
  // payload.type = 'reel' | 'post'
  // payload.scheduleDate = new Date(epochMs).toISOString()   // ISO 8601 UTC
  // payload.status = 'scheduled'
  // payload.accountIds = [config.GHL_ACCOUNT_ID]
  return request('POST', `/social-media-posting/${config.GHL_LOCATION_ID}/posts`, payload);
  // Resposta: { post: { _id: '...', status: 'scheduled', ... } }
  // O ID do post é response.post._id
}
```

### Pattern 5: Mapeamento Formato ClickUp → tipo GHL

```javascript
// Source: CONTEXT.md D-12 + GHL type enum confirmado [MEDIUM]
// O campo Formato retorna como orderindex. Mapear pelo nome da opção.
// Valores reais das opções do campo Formato (do PROJECT.md / Phase 1):
//   Reels, Carrossel, Stories, Feed estático

const FORMATO_MAP = {
  'Reels':          { ghlType: 'reel',  mediaCount: 'single'   },
  'Carrossel':      { ghlType: 'post',  mediaCount: 'multiple' },
  'Feed estático':  { ghlType: 'post',  mediaCount: 'single'   },
  // 'Stories': inválido (D-13)
};

function mapFormato(formatoName) {
  const mapping = FORMATO_MAP[formatoName];
  if (!mapping) {
    throw new ValidationError(`Formato inválido ou não suportado: "${formatoName}"`);
  }
  return mapping;
}
```

### Anti-Patterns to Avoid

- **NÃO passar Content-Type: application/json** no request de upload multipart — o fetch com `FormData` define `Content-Type: multipart/form-data; boundary=...` automaticamente. Sobrescrever quebra o parsing.
- **NÃO usar `file.path` de entrada do zip sem validar zip-slip** — sempre checar `path.relative(tmpDir, resolvedPath).startsWith('..')`.
- **NÃO gravar status `agendado` antes do GHL responder 201** — a sequência correta é: createPost → sucesso → updateTask → setCustomField.
- **NÃO abortar o batch em falha de uma task** — cada task tem seu próprio `try/catch`; erro vai para `Erro de publicação` e o loop continua.
- **NÃO logar a URL pre-signed do MinIO em nível info/debug** — pode expor tokens de acesso temporários. Logar somente `taskId` e `fileName`.
- **NÃO interpretar o `value` de dropdown como UUID** — na leitura da task, `value` é o `orderindex` (número); o UUID da opção está em `type_config.options[i].id` e é usado somente para escrita.
- **NÃO hardcodar `accountIds`** — vira `config.GHL_ACCOUNT_ID` (D-17).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Leitura de zip em memória | Parser de ZIP próprio | `adm-zip` | Formato ZIP tem vários flavores (ZIP64, deflate, stored); edge cases em nomes de arquivo, encoding UTF-8 vs CP437, diretórios internos |
| Detecção de MIME type por extensão | Tabela manual de extensões | `mimeType` por extensão via mapa simples (ou lib leve) | Extensões ambíguas (`.jpg` vs `.jpeg`), case sensitivity — tabela precisa de manutenção |
| FormData/multipart no Node | Montar boundary e buffers manualmente | `FormData` nativo do Node 24 (global) | Node 24 expõe `FormData` e `Blob` globalmente via undici; zero dependências adicionais |
| Paginação da lista de tasks | Loop manual cheio de edge cases | `getListTasks` wrapper com `page++` | A API retorna 100 por página; loop até `tasks.length === 0` |
| Ordenação numérica de nomes de arquivo | `arr.sort()` com comparação string | `arr.sort((a, b) => parseInt(a) - parseInt(b))` após basename sem extensão | Ordenação lexicográfica `"10" < "2"` quebraria a ordem do carrossel |

---

## GHL Social Planner — Schema Completo

### POST /social-media-posting/{locationId}/posts

**Headers obrigatórios:**
```
Authorization: Bearer pit-...
Version: 2021-07-28
Content-Type: application/json
```

**Campos do request body** [MEDIUM — confirmado via github.com/mastanley13/GoHighLevel-MCP]:
```typescript
{
  accountIds:    string[];          // OBRIGATÓRIO — array com o ID da conta IG
  summary:       string;            // OBRIGATÓRIO — legenda do post
  type:          'post' | 'story' | 'reel';  // OBRIGATÓRIO
  status:        'draft' | 'scheduled' | 'published';  // usar 'scheduled' p/ agendar
  scheduleDate?: string;            // ISO 8601 UTC — ex: "2026-06-25T14:00:00.000Z"
  media?:        Array<{
    url:          string;           // URL do arquivo na media library do GHL
    caption?:     string;           // legenda por arquivo (opcional)
    type?:        string;           // MIME type do arquivo
    thumbnail?:   string;           // URL de thumbnail (para vídeo)
  }>;
  followUpComment?: string;         // comentário pós-publicação (Phase 3+)
  tags?:            string[];
  categoryId?:      string;
  userId?:          string;
}
```

**Response body** [MEDIUM]:
```json
{
  "post": {
    "_id": "abc123...",
    "status": "scheduled",
    "summary": "...",
    "accountIds": ["..."],
    "scheduleDate": "2026-06-25T14:00:00.000Z",
    "media": [...],
    "createdAt": "..."
  }
}
```

**O id do post GHL é `response.post._id`** — gravar esse valor em `CF_GHL_POST_ID`.

**Mapeamento Formato → `type`:**
| Formato ClickUp | GHL `type` | Qtd. de mídias |
|----------------|------------|----------------|
| `Reels` | `'reel'` | 1 (vídeo — primeiro arquivo) |
| `Carrossel` | `'post'` | N (todos os arquivos, em ordem numérica) |
| `Feed estático` | `'post'` | 1 (único ou primeiro arquivo) |
| `Stories` | INVÁLIDO (D-13) | — |

**Nota sobre Carrossel:** O GHL não tem um tipo `'carousel'` separado. Feed com múltiplas mídias (`type: 'post'` + `media: [{...}, {...}, ...]`) cria automaticamente um carrossel no Instagram. [ASSUMED — inferido do comportamento do Meta API via GHL]

**Nota sobre `scheduleDate`:** A string ISO 8601 UTC é a representação direta de `new Date(epochMs).toISOString()`. O ClickUp devolve a Data de publicação como epoch ms em string — converter com `Number()` antes de passar para `new Date()`.

### POST /medias/upload-file

**Endpoint:** `POST https://services.leadconnectorhq.com/medias/upload-file`
**Content-Type:** `multipart/form-data` (boundary definido pelo FormData)

**Campos do form:**
```
file          binary   OBRIGATÓRIO (se hosted=false)
name          string   nome do arquivo
altType       string   'location'
altId         string   {locationId}
hosted        boolean  false (para upload direto de arquivo binário)
```

**Response:**
```json
{ "fileId": "...", "url": "https://...", "name": "...", "mimeType": "..." }
```

A `url` retornada é passada diretamente em `media[i].url` no createPost. [MEDIUM — confirmado via marketplace.gohighlevel.com/docs/ghl/medias/upload-media-content + MCP reference]

---

## ClickUp — Schema Crítico

### GET /list/{id}/task — Filtros e Paginação

```
GET /api/v2/list/{listId}/task
  ?statuses[]=a%20agendar
  &include_closed=false
  &subtasks=false
  &page=0
```

[VERIFIED: developer.clickup.com/reference/gettasks]

- `statuses[]` aceita múltiplos valores: `&statuses[]=a%20agendar&statuses[]=outra`
- Retorna max 100 tarefas por página; incrementar `page` até `tasks === []`
- `subtasks=false` é o default — incluir explicitamente para deixar claro
- `include_closed=false` — status `a agendar` é um status aberto (open), mas deixar explícito

**Filtro adicional recomendado (opcional mas mais eficiente):**
```
&custom_fields=[{"field_id":"d5107244-d044-4bd0-ae5c-c07f8a4f194e","operator":"IS NOT NULL"}]
```
(Campo `Data de publicação` = UUID do PROJECT.md — deixar o filtro no `getListTasks`)

### Formato de custom fields no response da task

```json
{
  "custom_fields": [
    { "id": "91c07244-...", "name": "Legenda",              "type": "text",      "value": "Texto da legenda" },
    { "id": "24e0f126-...", "name": "Formato",              "type": "drop_down", "value": 0 },
    { "id": "d5107244-...", "name": "Data de publicação",   "type": "date",      "value": "1751241600000" },
    { "id": "3f37fbaa-...", "name": "id da task mãe",       "type": "text",      "value": "86aj32mwf" },
    { "id": "1137de68-...", "name": "Erro de publicação",   "type": "text",      "value": null }
  ]
}
```

**Tipos e leitura:**
- `text/url`: `value` é `string | null`
- `date`: `value` é epoch ms como **string** (ex: `"1751241600000"`) ou `null`
- `drop_down`: `value` é `orderindex` como **número** (0, 1, 2…) ou `null`

**Escrita com `setCustomField`:**
- `text/url`: `value` = string
- `date`: `value` = número epoch ms (o client existente envolve em `{ value }` — correto)
- `drop_down`: `value` = **UUID da opção** (`type_config.options[i].id`) — NÃO o orderindex

[VERIFIED: developer.clickup.com/docs/customfields]

### Formato de dropdown `Formato` — valores reais

Descoberto no boot da Phase 1 (src/index.js lines 58-79):
- O campo `Formato` retorna `type_config.options` com `{id, label, orderindex}`
- Mapeamento precisa ser construído em runtime: `options.find(o => String(o.orderindex) === String(value))?.label`
- Os valores exatos de label confirmados do PROJECT.md: `Reels`, `Carrossel`, `Stories`, `Feed estático`

**O Phase 2 NÃO precisa escrever no campo Formato** — só ler para mapear o tipo de post GHL.

### Variáveis de config a adicionar no `src/config/index.js`

| Env var | Alias CF_* | Tipo | Descrição |
|---------|-----------|------|-----------|
| `CU_FIELD_GHL_POST_ID` | `CF_GHL_POST_ID` | UUID | Campo "GHL Post ID" (a criar pelo usuário) |
| `CU_FIELD_LINK_DO_POST` | `CF_LINK_DO_POST` | UUID | Campo "Link do post" (zip no MinIO) |
| `CU_FIELD_FORMATO` | `CF_FORMATO` | UUID | Campo "Formato" (já tem UUID em PROJECT.md: `24e0f126-589f-400c-a602-0e4abe19b809`) |
| `GHL_ACCOUNT_ID` | — | string | ID da conta IG `auton.app` no Social Planner |
| `STATUS_A_AGENDAR` | — | string | Nome do status de detecção (default: `a agendar`) |
| `STATUS_AGENDADO` | — | string | Nome do status de sucesso (default: `agendado`) |

---

## MinIO / Zip — Fluxo e Segurança

### Download e extração

```javascript
// Source: padrões Node.js + docs adm-zip [ASSUMED]
import AdmZip from 'adm-zip'; // funciona em ESM (CJS default export)
import { tmpdir } from 'node:os';
import { join, relative, resolve, basename, extname } from 'node:path';
import { mkdir, rm, writeFile } from 'node:fs/promises';

async function downloadAndExtract(zipUrl) {
  // 1. Validar URL antes de fetch (SSRF guard)
  const url = new URL(zipUrl); // lança se inválida
  if (!['https:', 'http:'].includes(url.protocol)) {
    throw new ValidationError('URL de mídia com protocolo inválido');
  }
  // Opcionalmente: verificar que domínio é o MinIO esperado (via config)
  
  // 2. Download com limite de tamanho (zip-bomb guard)
  const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB
  const res = await fetch(zipUrl);
  if (!res.ok) throw new Error(`Download falhou: ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new ValidationError(`Zip excede limite de ${MAX_DOWNLOAD_BYTES} bytes`);
  }

  // 3. Extrair com adm-zip
  const zip = new AdmZip(Buffer.from(buf));
  const entries = zip.getEntries();

  // 4. Filtrar e ordenar (zip-slip guard incluído)
  const tmpDir = join(tmpdir(), `post-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const name = basename(entry.entryName); // toma só o nome base
    if (name.startsWith('.') || name.startsWith('__')) continue; // pular __MACOSX, .DS_Store

    // ZIP-SLIP GUARD obrigatório
    const destPath = resolve(tmpDir, name);
    const rel = relative(tmpDir, destPath);
    if (rel.startsWith('..') || require('node:path').isAbsolute(rel)) {
      throw new SecurityError(`Zip-slip detectado: ${entry.entryName}`);
    }

    const content = entry.getData();
    await writeFile(destPath, content);
    files.push({ name, path: destPath, buffer: content });
  }

  // 5. Ordenar por nome numérico crescente (1.jpg, 2.jpg, 3.jpg…)
  files.sort((a, b) => {
    const numA = parseInt(a.name, 10);
    const numB = parseInt(b.name, 10);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.name.localeCompare(b.name);
  });

  return { files, tmpDir };
}

async function cleanupTmp(tmpDir) {
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
```

### Inferência de MIME type por extensão

```javascript
// Source: ASSUMED — tabela padrão de extensões de imagem/vídeo
const MIME_BY_EXT = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.png': 'image/png',  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',  '.mov': 'video/quicktime',
};

function mimeFromFilename(filename) {
  const ext = extname(filename).toLowerCase();
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}
```

---

## Common Pitfalls

### Pitfall 1: GHL não aceita carrossel com `type: 'carousel'`

**What goes wrong:** Tentar enviar `type: 'carousel'` no payload — a API retorna 422.
**Why it happens:** O GHL não tem tipo 'carousel' explícito. Um post com `type: 'post'` e `media: [{}, {}, ...]` (múltiplos itens) cria carrossel automaticamente no Instagram via Meta API.
**How to avoid:** Sempre usar `type: 'post'` para Feed e Carrossel; `type: 'reel'` para Reels. [ASSUMED — inferido do type enum confirmado como 'post'|'story'|'reel']
**Warning signs:** Erro 422 com mensagem sobre tipo de post inválido.

### Pitfall 2: Leitura de dropdown como UUID (não é)

**What goes wrong:** Ler `custom_fields[i].value` de um campo dropdown e comparar com UUIDs ou usá-lo como nome da opção — o valor é o `orderindex` numérico, não o UUID nem o label.
**Why it happens:** A API ClickUp retorna orderindex na leitura; só aceita UUID na escrita.
**How to avoid:** Para ler o nome/label da opção selecionada, buscar `type_config.options` (da `getListFields`) e usar `options.find(o => o.orderindex == value)?.name`. O Phase 2 lê o Formato com `getListFields` no bootstrap da passada.
**Warning signs:** Mapeamento de Formato sempre retornando `undefined` ou lançando erro de "formato desconhecido".

### Pitfall 3: Date no ClickUp tem timezone implícito

**What goes wrong:** Assumir que o epoch ms da `Data de publicação` está em UTC quando o usuário não preencheu a hora — o ClickUp default é 04:00 no timezone do usuário, não meia-noite UTC.
**Why it happens:** "API will return a value in Unix time in milliseconds of 4:00 am in the authorized user's timezone." [VERIFIED: developer.clickup.com/docs/general-time.md]
**How to avoid:** Documentar no `Erro de publicação` se a data calculada está no passado. Para `scheduleDate` do GHL, usar `new Date(Number(epochMs)).toISOString()` — a conversão é exata independente de timezone. O GHL recebe a hora exata que o ClickUp guardou.
**Warning signs:** Posts agendados aparecendo na hora errada no GHL.

### Pitfall 4: Upload multipart com Content-Type manual

**What goes wrong:** Setar `headers['Content-Type'] = 'multipart/form-data'` explicitamente — o boundary não é incluído e o GHL rejeita com erro de parsing.
**Why it happens:** O boundary (`----FormBoundaryXXX`) é gerado pelo FormData e incluído automaticamente em `Content-Type: multipart/form-data; boundary=...`. Setar manualmente sobrescreve sem o boundary.
**How to avoid:** Nunca setar Content-Type em requests com `FormData`. Deixar o fetch calcular.
**Warning signs:** Erro 400 do GHL com mensagem sobre body malformado.

### Pitfall 5: `setCustomField` com value errado para dropdown

**What goes wrong:** Chamar `setCustomField(taskId, CF_FORMATO, orderindex)` — a API aceita o request mas não atualiza o campo.
**Why it happens:** A escrita de dropdown exige o UUID da opção, não o orderindex.
**How to avoid:** Para escrever dropdown, usar `type_config.options.find(o => o.name === 'Reels').id`. Esta fase não escreve no campo Formato — só lê — então não há risco direto. Mas o Formato dos campos que SÃO escritos (`GHL Post ID`, `Erro de publicação`) são `text` — sem problema.
**Warning signs:** Campo não atualiza no ClickUp após a escrita (sem erro, mas `getTask` mostra null).

### Pitfall 6: Zip-slip com arquivos como `../../../etc/passwd`

**What goes wrong:** Extrair entry com nome `../../config.json` — sobrescreve arquivo fora do `tmpDir`.
**Why it happens:** Arquivos ZIP podem ter qualquer string como `entryName`, incluindo `../`.
**How to avoid:** Validar `path.relative(tmpDir, resolve(tmpDir, basename(entry.entryName)))` — deve começar com `.` (não com `..` ou ser absoluto). `adm-zip` 0.5.17+ tem check interno desde 2024, mas defesa em camadas é mais segura.
**Warning signs:** Arquivos modificados fora do diretório de trabalho; erros de permissão.

### Pitfall 7: GHL `post._id` vs `post.id`

**What goes wrong:** Ler `response.post.id` (sem underscore) e gravar `undefined` no `CF_GHL_POST_ID`.
**Why it happens:** O MongoDB/GHL usa `_id` como campo de identificador primário.
**How to avoid:** Usar `response?.post?._id` e validar que não é `undefined` antes de gravar.
**Warning signs:** `CF_GHL_POST_ID` aparece vazio no ClickUp após sucesso aparente; task re-agendada na próxima passada.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Polling GHL para verificar status | Webhook GHL→ClickUp (Fase 3) | v1 desta integração | Fase 2 só cria o post; a confirmação de publicação vem via webhook |
| Passar URL do MinIO diretamente ao GHL | Download zip → upload para media library | Decisão D-09 | GHL não aceita URL externa de MinIO pre-signed como fonte de mídia; upload prévio é obrigatório |
| Usar `IG Media ID` para idempotência | Novo campo `GHL Post ID` | Decisão D-01 | `IG Media ID` é do Instagram pós-publicação (Fase 3); usar campo separado evita colisão |

**Deprecated/outdated:**
- Anexos do ClickUp como fonte de mídia: o campo `Link do post` com zip no MinIO é a fonte canônica (D-06). Anexos não são lidos nesta fase.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Carrossel no GHL é criado automaticamente com `type: 'post'` + múltiplas mídias (sem tipo 'carousel' separado) | GHL Schema + Mapeamento Formato | Erro 422 no createPost; precisaria descobrir o tipo correto empiricamente |
| A2 | A `url` retornada por `/medias/upload-file` pode ser passada diretamente em `media[].url` do createPost | GHL upload → createPost | O GHL pode exigir o `fileId` em vez da URL; ambos estão no response, tentar URL primeiro |
| A3 | `scheduleDate` como ISO string UTC é o formato correto para o GHL | GHL Schema | Post agendado para hora errada; possível rejeição se formato for epoch ms |
| A4 | Upload multipart com `FormData` nativo do Node 24 + `Blob` funciona para o endpoint `/medias/upload-file` | GHL upload | Pode ser necessário usar `node-form-data` ou `FormData` de outro pacote; testar no Wave 0 |
| A5 | O `value` de um campo date na task response é epoch ms como `string` (não `number`) | ClickUp custom fields | Se for `number`, `parseInt` ainda funciona; risco mínimo |
| A6 | Múltiplos arquivos no `media[]` criam carrossel no Instagram via GHL | GHL + Instagram API | Se Instagram limitar via GHL (ex: só 1 mídia por chamada), carrossel precisaria de endpoint diferente |
| A7 | O `GHL_ACCOUNT_ID` da conta `auton.app` é o valor que termina em `_17841440215631995` (PROJECT.md) | GHL createPost | Se o accountId foi atualizado ou re-conectado, o post falha com 4xx; verificar no Wave 0 com `listAccounts` |

---

## Open Questions

1. **GHL aceita múltiplas mídias em um único createPost para carrossel?**
   - What we know: O type enum confirmado é `'post' | 'story' | 'reel'`; `media` é um array
   - What's unclear: Se Instagram carrossel via GHL exige uma única chamada com N mídias ou N chamadas
   - Recommendation: Testar com 2 mídias no Wave 0 antes de implementar a lógica de carrossel

2. **`scheduleDate` aceita timezone diferente de UTC?**
   - What we know: Campo é `string` (ISO format conforme docs)
   - What's unclear: Se o GHL interpreta no timezone da location ou sempre UTC
   - Recommendation: Sempre enviar UTC (`new Date(epochMs).toISOString()`) — safer

3. **Usuário ainda não criou o campo "GHL Post ID" no ClickUp**
   - What we know: D-03 diz que o usuário deve criar e fornecer o UUID
   - What's unclear: O UUID do campo — não está em PROJECT.md ainda
   - Recommendation: O planner deve criar uma task de setup (Wave 0) que instrui o usuário a criar o campo e adicionar `CU_FIELD_GHL_POST_ID` ao `.env`

4. **Usuário ainda não confirmou o UUID do campo "Link do post"**
   - What we know: D-06 diz que o campo existe e o UUID será fornecido
   - What's unclear: O UUID não está em PROJECT.md
   - Recommendation: Idem — Wave 0 setup task

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 24 | Runtime ESM | ✓ | 24.14.0 | — |
| `bottleneck` | ClickUp rate limit | ✓ | 2.19.5 (instalado) | — |
| `p-retry` | Retry/backoff | ✓ | 8.0.0 (instalado) | — |
| `pino` | Logging | ✓ | 10.3.1 (instalado) | — |
| `adm-zip` | Unzip do zip do MinIO | ✗ | não instalado | instalar: `npm install adm-zip` |
| `FormData` / `Blob` | Upload multipart GHL | ✓ | Nativo Node 24 (global) | — |
| MinIO pre-signed URL | Download do zip | Depende do usuário | — | URL pública — sem credenciais necessárias |
| GHL API (Social Planner) | Criação de posts | ✓ | v2021-07-28 (validado Phase 1) | — |
| ClickUp API | Leitura/escrita tasks | ✓ | v2 (validado Phase 1) | — |
| `os.tmpdir()` gravável | Extração do zip | ✓ | C:\Users\...\AppData\Local\Temp | — |

**Missing dependencies com fallback:**
- `adm-zip`: instalar via `npm install adm-zip` no Wave 0 (Wave de setup)

---

## Security Domain

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | sim (ClickUp + GHL) | Tokens em `.env`; nunca logados (já implementado Phase 1 — T-01-02) |
| V3 Session Management | não | Integração server-to-server sem sessão |
| V4 Access Control | não | Sem multi-tenant nesta fase |
| V5 Input Validation | sim | Validar URL do MinIO, tamanho do zip, nomes de arquivo (zip-slip) |
| V6 Cryptography | não | Não implementamos cripto; tokens são opacos |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Zip-slip (path traversal no unzip) | Tampering, Elevation of Privilege | `path.relative(tmpDir, resolve(tmpDir, basename(entryName)))` — deve começar com `.`; descartar entries com `..` |
| Zip-bomb (arquivo comprimido gigante) | Denial of Service | Limitar `res.arrayBuffer()` a 100 MB antes de descomprimir; verificar `entry.header.size` vs limite |
| SSRF via URL do MinIO | Server-Side Request Forgery | Validar protocolo (`https:` apenas em produção) e domínio esperado (config `MINIO_ALLOWED_DOMAIN`); lançar erro de validação antes do fetch |
| Log de URL pre-signed | Information Disclosure | Nunca logar `linkDoPost` em nível info — só logar `taskId` + nome do arquivo |
| Tokens GHL/ClickUp em mensagem de erro | Information Disclosure | `AppError.fromGHL` / `fromClickUp` já filtram (Phase 1). `Erro de publicação` NÃO deve conter URL do MinIO nem tokens |
| Download de conteúdo não-zip | Tampering | Verificar magic bytes do zip (`PK\x03\x04`) antes de passar ao AdmZip |

**Nota sobre `security_enforcement: true`, ASVS level 1, block_on: high` (config.json):** Todos os riscos HIGH listados acima têm mitigação concreta. O planner deve incluir tarefas explícitas de implementação para zip-slip guard e SSRF guard.

---

## Sources

### Primary (MEDIUM confidence — docs oficiais + implementação de referência)
- [developer.clickup.com/docs/customfields](https://developer.clickup.com/docs/customfields) — formatos de leitura/escrita de custom fields por tipo
- [developer.clickup.com/docs/general-time.md](https://developer.clickup.com/docs/general-time.md) — epoch ms + timezone UTC
- [developer.clickup.com/reference/gettasks](https://developer.clickup.com/reference/gettasks) — filtros, paginação
- [github.com/mastanley13/GoHighLevel-MCP](https://github.com/mastanley13/GoHighLevel-MCP) — implementação de referência com GHLCreatePostRequest, GHLUploadMediaFileRequest types
- [marketplace.gohighlevel.com/docs/ghl/medias/upload-media-content](https://marketplace.gohighlevel.com/docs/ghl/medias/upload-media-content) — POST /medias/upload-file
- [ideas.gohighlevel.com/changelog/public-apis-are-now-available-for-social-planner](https://ideas.gohighlevel.com/changelog/public-apis-are-now-available-for-social-planner) — escopos OAuth, endpoints confirmados

### Secondary (LOW-MEDIUM confidence — informações complementares)
- [npmjs.com/package/adm-zip](https://www.npmjs.com/package/adm-zip) — versão e API
- [github.com/ZJONSSON/node-unzipper](https://github.com/ZJONSSON/node-unzipper) — histórico legítimo, commit de zip-slip
- [developer.clickup.com/docs/taskfilters.md](https://developer.clickup.com/docs/taskfilters.md) — IS NOT NULL filter
- [help.gohighlevel.com/.../instagram-reels-publishing-guide](https://help.gohighlevel.com/support/solutions/articles/155000000441-instagram-reels-publishing-guide-for-the-social-planner) — requisitos de Reels
- [snyk/zip-slip-vulnerability](https://github.com/snyk/zip-slip-vulnerability) — padrão de mitigação
- [nodejs.org/api/esm.html](https://nodejs.org/api/esm.html) — ESM/CJS interop para `import AdmZip from 'adm-zip'`

---

## Metadata

**Confidence breakdown:**
- GHL create post schema: MEDIUM — confirmado via implementação de referência open-source (MCP server), não via docs oficiais interativos (SPA inacessível via fetch)
- GHL media upload endpoint: MEDIUM — confirmado via docs oficiais + MCP reference
- ClickUp custom field formats: MEDIUM — docs oficiais (VERIFIED); comportamento de dropdown (orderindex vs UUID) confirmado por múltiplas fontes
- Unzip library: HIGH — npm registry + GitHub audit + Node ESM interop docs
- Security mitigations: MEDIUM — padrões documentados do OWASP/Snyk

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (GHL API evolui; verificar `type` enum se novo tipo aparecer)
