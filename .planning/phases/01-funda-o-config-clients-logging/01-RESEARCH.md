# Phase 1: Fundação (Config + Clients + Logging) - Research

**Researched:** 2026-06-22
**Domain:** Serviço Node.js standalone — bootstrap de config (.env), clients HTTP autenticados (ClickUp v2 + GHL Social Planner) e logging estruturado
**Confidence:** HIGH (stack e padrões) / MEDIUM (formatos exatos das duas APIs — alguns confirmados ao vivo, outros via docs)

## Summary

Esta fase é pura fundação: nenhuma regra de negócio de agendamento, só a base sobre a qual as Phases 2-4 vão construir. O objetivo é que, ao subir o processo, ele (1) leia 100% da config de `.env` e **falhe cedo e com mensagem clara** se faltar variável, (2) tenha um client ClickUp e um client GHL prontos, autenticados e com tratamento de erro/rate-limit consistente, e (3) escreva logs estruturados com campos `taskId`, `ghlPostId`, `action`.

A stack recomendada para 2026 é minimalista e alinhada ao constraint "Node.js standalone": **Node 24 LTS + ESM**, **`fetch` nativo (undici embutido)** como HTTP client (sem axios/got), **zod** para validar o env, **dotenv** para carregar o `.env` (ou `node --env-file`), **pino** para logging, e **bottleneck** para o rate-limit do ClickUp (100 req/min) combinado com **p-retry** para backoff. Cada API recebe um "client wrapper" fino: um módulo que centraliza base URL, headers de auth, e um único ponto de tratamento de erro que normaliza os shapes (bem diferentes) de erro do ClickUp e do GHL.

O maior risco da fase não é a stack — é a **fidelidade aos formatos das duas APIs**. Os fatos validados ao vivo (auth headers, endpoint `accounts` 200) devem virar testes de fumaça nesta fase. Os formatos que ainda NÃO foram exercidos ao vivo (PUT de custom field do ClickUp, body de create-post do GHL, header `Version` v3 vs `2021-07-28`) ficam como `[ASSUMED]` e são as principais assunções a confirmar.

**Primary recommendation:** Node 24 LTS + ESM, `fetch` nativo, zod p/ validar env, pino p/ logs, bottleneck + p-retry nos clients. Faça da Phase 1 a fase que prova a autenticação das duas APIs com um "smoke test" (1 GET autenticado em cada) antes de qualquer lógica.

## Project Constraints (from CLAUDE.md / PROJECT.md)

Diretivas com autoridade equivalente a decisões travadas — o planner NÃO pode recomendar abordagens que contradigam:

- **Tech stack: Node.js standalone, sem framework de UI.** (CLAUDE.md → Constraints)
- **Segurança: todos os segredos (`pk_…`, `pit-…`, locationId) em `.env` gitignored — nada de segredo no código.** As keys foram expostas em chat e devem ser rotacionadas antes de produção. (CLAUDE.md → Constraints / PROJECT Key Decisions)
- **Respeitar rate limits: ClickUp 100 req/min por token; GHL também tem limites.** (CLAUDE.md → Constraints)
- **GSD workflow enforcement:** edições só dentro de comandos GSD. (CLAUDE.md → Workflow)
- **`security_enforcement: true`, ASVS level 1, block_on high** (config.json) → seção Security Domain obrigatória.
- **`nyquist_validation: false`** (config.json) → seção Validation Architecture OMITIDA por configuração.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Carregar + validar config (.env) | Process bootstrap (Node) | — | Roda uma vez no startup, antes de qualquer client existir |
| Autenticação ClickUp | API client wrapper (Node) | — | Headers/token são responsabilidade do client, não do caller |
| Autenticação GHL | API client wrapper (Node) | — | Idem; isola `Version` header e `Bearer pit-…` num lugar |
| Rate limiting (100 req/min) | API client wrapper (ClickUp) | — | Limite é por token → pertence ao client que detém o token |
| Retry/backoff de rede | API client wrapper (ambos) | — | Política de resiliência fica colada à chamada HTTP |
| Logging estruturado | lib/logger (cross-cutting) | clients consomem | Logger é singleton injetado; clients e callers logam com child loggers |
| Normalização de erro de API | API client wrapper (ambos) | lib/errors | Cada client mapeia seu shape para um erro interno comum |

**Nota:** Tudo nesta fase vive no tier "backend/process" — não há browser nem SSR. A divisão relevante é entre *bootstrap* (roda 1x) e *clients* (cross-cutting, reutilizados por todas as fases seguintes).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.x LTS | Runtime | Active LTS em jun/2026, suportado até 2027+; já instalado (`v24.14.0`). Traz `fetch`/undici global e `--env-file` nativo. `[VERIFIED: endoflife.date + node --version local]` |
| `fetch` nativo (undici embutido) | (runtime) | HTTP client p/ ambos os clients | Zero dependência, estável desde Node 21, API padrão Web. Evita axios/got. `[VERIFIED: Node 24 runtime]` |
| `zod` | 4.4.x | Validação de schema do env | Falha cedo com mensagem clara se faltar/estiver inválida uma variável; tipos inferidos. `[VERIFIED: npm registry]` |
| `dotenv` | 17.4.x | Carregar `.env` em `process.env` | Padrão de fato; ou usar `node --env-file=.env` nativo (sem dep). `[VERIFIED: npm registry]` |
| `pino` | 10.3.x | Logging estruturado JSON | Logger mais rápido do ecossistema; child loggers com campos fixos (taskId, ghlPostId, action). `[VERIFIED: npm registry]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `bottleneck` | 2.19.x | Rate limiting do client ClickUp (100 req/min) | Quando precisar throttle determinístico por token. `reservoir`/`minTime` mapeiam direto p/ "100 por minuto". `[VERIFIED: npm registry]` |
| `p-retry` | 8.0.x | Retry com backoff exponencial em falhas de rede/5xx/429 | Envolver as chamadas dos clients; respeitar `Retry-After`. `[VERIFIED: npm registry]` |
| `pino-pretty` | 13.1.x | Pretty-print de logs em dev (devDependency) | Só em desenvolvimento; em prod, log JSON puro. `[VERIFIED: npm registry]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `fetch` nativo | `axios` 1.18 / `got` 15 | axios traz interceptors/erros prontos, got tem retry/hooks embutidos; mas ambos adicionam dependência e o projeto é deliberadamente minimalista. `fetch` nativo é suficiente para 2 clients simples. `[ASSUMED]` |
| `bottleneck` | `p-ratelimit` 1.0.1 | p-ratelimit é mais simples mas sem release desde 2022 (sinal de abandono); bottleneck é mais robusto e mantido. `[VERIFIED: npm registry — datas]` |
| `dotenv` | `node --env-file=.env` nativo | Nativo = zero dep mas menos flexível (sem expand de variáveis, sem multiline robusto em versões antigas). dotenv dá controle e mensagens melhores. Recomendar `dotenv`; mencionar o nativo como opção válida. `[ASSUMED]` |
| `pino` | `winston` | winston é mais configurável/transports prontos, porém mais lento e verboso; pino é o padrão atual para JSON structured logging em serviços. `[ASSUMED]` |
| `zod` | `envalid` | envalid é específico p/ env (mais enxuto p/ esse caso), zod é genérico e reusável em todo o projeto (validar payloads de webhook na Phase 3). Recomendar zod pela reutilização. `[ASSUMED]` |

**Installation:**
```bash
npm install zod dotenv pino bottleneck p-retry
npm install --save-dev pino-pretty
# fetch é nativo no Node 24 — NÃO instalar node-fetch nem undici
```

**Version verification (executada nesta sessão, 2026-06-22):**
```
pino        10.3.1   (mod 2026-02-09)
dotenv      17.4.2   (mod 2026-04-24)
zod          4.4.3   (mod 2026-05-04)
p-retry      8.0.0   (mod 2026-03-26)
bottleneck  2.19.5   (mod 2023-02-22 — estável, maduro)
pino-pretty 13.1.3   (mod 2025-12-01)
```

## Package Legitimacy Audit

Executado via `gsd-tools query package-legitimacy check --ecosystem npm`:

| Package | Registry | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----------|-------------|---------|-------------|
| pino | npm | ~37M/sem | github.com/pinojs/pino | OK | Aprovado |
| dotenv | npm | ~148M/sem | github.com/motdotla/dotenv | OK | Aprovado |
| zod | npm | ~206M/sem | github.com/colinhacks/zod | OK | Aprovado |
| p-retry | npm | ~42M/sem | github.com/sindresorhus/p-retry | OK | Aprovado |
| bottleneck | npm | ~12M/sem | (mantido, sem postinstall) | OK | Aprovado |
| pino-pretty | npm | ~17M/sem | (pinojs) | OK | Aprovado |
| undici | npm | ~135M/sem | github.com/nodejs/undici | SUS | **NÃO instalar** — é built-in no Node 24; o flag SUS é falso-positivo do heurístico. Use `fetch` global. |

**Packages removidos por veredito SLOP:** none
**Packages flagged como suspeitos [SUS]:** `undici` — mas a disposição é não instalá-lo (já vem no runtime). Nenhum postinstall malicioso detectado em qualquer pacote.

## Architecture Patterns

### System Architecture Diagram

Fluxo de bootstrap e de uma chamada de API (escopo Phase 1):

```
                       ┌──────────────────────────────┐
   process start ─────▶│  src/config/index.js         │
                       │  1. dotenv.config()          │
                       │  2. zod.parse(process.env)    │──── falta var? ──▶ log fatal + process.exit(1)
                       │     → objeto `config` tipado  │     (FAIL FAST)
                       └──────────────┬────────────────┘
                                      │ config (imutável)
                       ┌──────────────▼────────────────┐
                       │  src/lib/logger.js (pino)      │
                       │  logger raiz + child(fields)   │
                       └──────────────┬────────────────┘
                                      │ injeta logger + config
            ┌─────────────────────────┴─────────────────────────┐
            ▼                                                     ▼
┌──────────────────────────┐                      ┌──────────────────────────┐
│ src/clients/clickup.js   │                      │ src/clients/ghl.js        │
│ baseURL api/v2           │                      │ baseURL leadconnectorhq   │
│ header Authorization:pk_ │                      │ header Bearer pit_ +      │
│ bottleneck (100/min) ────┼── request() ──┐      │ Version: 2021-07-28       │
│ p-retry (backoff/429)    │               │      │ p-retry (backoff/429)     │
│ mapError() → AppError    │               │      │ mapError() → AppError     │
└──────────┬───────────────┘               │      └──────────┬────────────────┘
           │ fetch (nativo)                 │                 │ fetch (nativo)
           ▼                                ▼                 ▼
   GET /list/{id}                  (smoke test)        GET /social-media-posting/
   GET /task/{id}                                          {loc}/accounts  → 200
   POST /task/{id}/field/{fid}
   PUT  /task/{id}
```

### Recommended Project Structure
```
.
├── .env.example          # template versionado (sem valores reais)
├── .env                  # gitignored — segredos reais
├── .gitignore            # DEVE conter .env e node_modules
├── package.json          # "type": "module"  → ESM
├── src/
│   ├── config/
│   │   └── index.js      # carrega .env + valida com zod → exporta `config` congelado
│   ├── clients/
│   │   ├── clickup.js    # wrapper ClickUp v2
│   │   └── ghl.js        # wrapper GHL Social Planner
│   ├── lib/
│   │   ├── logger.js     # pino root + helper child(fields)
│   │   └── errors.js     # AppError + mapeadores de erro por API
│   └── index.js          # entrypoint: bootstrap + smoke test das 2 APIs
└── README.md             # setup, variáveis de ambiente (OPS-03 começa aqui)
```

### Pattern 1: Config validada que falha cedo (CFG-01)
**What:** Um único módulo carrega `.env`, valida com um schema zod, e exporta um objeto `config` congelado. Variável faltando/má = crash imediato com mensagem listando o que falta.
**When to use:** Sempre — importado por todo o resto antes de qualquer I/O.
**Example:**
```javascript
// src/config/index.js
// Source: zod docs (https://zod.dev) + dotenv docs — [CITED]
import 'dotenv/config';          // ou rodar com: node --env-file=.env src/index.js
import { z } from 'zod';

const Schema = z.object({
  CLICKUP_TOKEN: z.string().startsWith('pk_'),
  CLICKUP_LIST_ID: z.string().min(1),
  GHL_TOKEN: z.string().startsWith('pit-'),
  GHL_LOCATION_ID: z.string().min(1),
  GHL_API_VERSION: z.string().default('2021-07-28'),
  // ids de custom fields e status (CFG-01: nada hardcoded)
  CF_LEGENDA: z.string().uuid(),
  CF_DATA_PUBLICACAO: z.string().uuid(),
  CF_IG_MEDIA_ID: z.string().uuid(),
  CF_LINK_PUBLICADO: z.string().uuid(),
  CF_ERRO_PUBLICACAO: z.string().uuid(),
  CF_ID_TASK_MAE: z.string().uuid(),
  LOG_LEVEL: z.enum(['fatal','error','warn','info','debug','trace']).default('info'),
});

const parsed = Schema.safeParse(process.env);
if (!parsed.success) {
  // mensagem clara, ANTES de qualquer client subir
  console.error('Config inválida:', z.treeifyError(parsed.error));
  process.exit(1);
}
export const config = Object.freeze(parsed.data);
```

### Pattern 2: Client wrapper com auth + rate-limit + retry + erro normalizado (CFG-02/CFG-03)
**What:** Cada client expõe um `request()` privado que injeta headers de auth, passa por throttle (ClickUp), tenta com backoff, e converte erro HTTP num `AppError` interno.
**When to use:** Toda chamada às APIs nas Phases 2-4 passa por aqui.
**Example:**
```javascript
// src/clients/clickup.js  — [CITED: developer.clickup.com] + [ASSUMED: formato exato a confirmar]
import Bottleneck from 'bottleneck';
import pRetry from 'p-retry';
import { config } from '../config/index.js';
import { logger } from '../lib/logger.js';
import { AppError } from '../lib/errors.js';

const limiter = new Bottleneck({ reservoir: 100, reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60_000, maxConcurrent: 5 });
const BASE = 'https://api.clickup.com/api/v2';

async function request(method, path, body) {
  return limiter.schedule(() => pRetry(async () => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { Authorization: config.CLICKUP_TOKEN, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {                       // rate limited → retentar
      const wait = Number(res.headers.get('X-RateLimit-Reset')) || 5;
      throw new pRetry.AbortError ? new Error('rate') : new Error('rate'); // retry
    }
    if (!res.ok) throw await AppError.fromClickUp(res); // 4xx não-429 → erro
    return res.status === 204 ? null : res.json();
  }, { retries: 3, minTimeout: 1000, factor: 2 }));
}

export const clickup = {
  getList: (id) => request('GET', `/list/${id}`),
  getListFields: (id) => request('GET', `/list/${id}/field`),
  getTask: (id) => request('GET', `/task/${id}`),
  updateTask: (id, patch) => request('PUT', `/task/${id}`, patch),
  setCustomField: (taskId, fieldId, value) =>
    request('POST', `/task/${taskId}/field/${fieldId}`, { value }),
};
```

```javascript
// src/clients/ghl.js  — [VERIFIED ao vivo: accounts → 200] + [CITED: marketplace.gohighlevel.com]
const BASE = 'https://services.leadconnectorhq.com';
function ghlHeaders() {
  return {
    Authorization: `Bearer ${config.GHL_TOKEN}`,
    Version: config.GHL_API_VERSION,   // 2021-07-28 (validado ao vivo)
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}
export const ghl = {
  listAccounts: () => request('GET',
    `/social-media-posting/${config.GHL_LOCATION_ID}/accounts`),
  // Phase 2 usará: POST /social-media-posting/{loc}/posts
};
```

### Pattern 3: Logger estruturado com campos de domínio (CFG-04)
**What:** Logger pino raiz; helper que cria child loggers carregando `taskId`, `ghlPostId`, `action` para que toda linha de log de uma operação herde esses campos.
**Example:**
```javascript
// src/lib/logger.js — Source: getpino.io [CITED]
import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.LOG_LEVEL,
  base: { service: 'agent-posts-auton' },
  ...(process.env.NODE_ENV !== 'production'
    ? { transport: { target: 'pino-pretty' } } : {}),
});

// uso: const log = logger.child({ taskId, ghlPostId, action: 'schedule' });
//      log.info('agendado com sucesso');
export const withContext = (fields) => logger.child(fields);
```

### Anti-Patterns to Avoid
- **Ler `process.env.X` espalhado pelo código:** centraliza tudo em `config/index.js`. Caso contrário, faltas de env só aparecem em runtime tardio, não no boot.
- **Hardcodar ids de campo/status do ClickUp:** viola CFG-01. Todos vêm do `.env` (já há ids reais no PROJECT.md para popular `.env.example`).
- **Instalar `node-fetch`/`undici`/`axios`:** desnecessário no Node 24; aumenta superfície de dependência.
- **`console.log`:** viola CFG-04 (não é estruturado). Tudo via pino.
- **Logar tokens/headers:** nunca logar `Authorization`. Configurar redaction no pino (`redact: ['*.authorization']`).
- **Retry cego em 4xx:** só retentar 429 e 5xx/erros de rede; 400/401/422 são erros do caller, não retentáveis.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Validação de env | parser de `process.env` com ifs | `zod` (+ dotenv) | Casos de borda (tipos, defaults, mensagens) já resolvidos |
| Rate limit 100/min | contador + setTimeout manual | `bottleneck` (reservoir) | Concorrência, fila e refill por janela são sutis e fáceis de errar |
| Retry/backoff | loop com `await sleep` | `p-retry` | Backoff exponencial, jitter, AbortError, contagem correta |
| Logging JSON | `JSON.stringify` + `console` | `pino` | Performance, níveis, child loggers, redaction de segredos |
| Carregar `.env` | leitor de arquivo + split | `dotenv` ou `node --env-file` | Quoting, multiline, comentários, ordem de precedência |

**Key insight:** Phase 1 inteira é "cola de infra" — exatamente o domínio onde bibliotecas maduras superam código próprio. O valor do time está na lógica ClickUp↔GHL (Phases 2-4), não em reimplementar throttling.

## Common Pitfalls

### Pitfall 1: Header `Version` do GHL — `2021-07-28` vs `v3`
**What goes wrong:** A doc atual do endpoint create-post mostra um seletor "Version: v3"; o header validado ao vivo no projeto foi `Version: 2021-07-28` (que retornou 200 no `accounts`).
**Why it happens:** GHL versiona a API e a doc do marketplace pode estar à frente do que o token PIT atual aceita.
**How to avoid:** Manter `GHL_API_VERSION` no `.env` (não hardcodar). Na Phase 1, o smoke test no `accounts` confirma que `2021-07-28` funciona. Se na Phase 2 o create-post exigir `v3`, basta trocar a env. `[ASSUMED — confirmar create-post na Phase 2]`
**Warning signs:** 401/422 só no create-post enquanto o GET accounts funciona.

### Pitfall 2: Formato do PUT/POST de custom field do ClickUp
**What goes wrong:** Cada tipo de campo tem body diferente: **date** = unix em **milissegundos** (com `"time": true/false`), **drop_down** = **id da opção** (não o label), **text/url** = string. Mandar o label do dropdown ou data em segundos falha silenciosamente ou com 400.
**Why it happens:** A API espera o id interno da opção, obtido via `GET /list/{id}/field` (type_config.options).
**How to avoid:** Na Phase 1, expor `clickup.getListFields(listId)` e usar no smoke test para mapear os ids das opções do `Formato`. Documentar o mapeamento. `[CITED: developer.clickup.com/reference/setcustomfieldvalue]`
**Warning signs:** PUT retorna 200 mas o campo não muda na UI; ou 400 "value is invalid".

### Pitfall 3: Rate limit do ClickUp é por token e responde 429
**What goes wrong:** Estourar 100 req/min retorna 429; sem throttle, a fila de agendamento (Phase 2/4) trava.
**Why it happens:** Limite por token no plano atual.
**How to avoid:** bottleneck com `reservoir:100 / refresh 60s`; p-retry honra `Retry-After`/`X-RateLimit-Reset`. `[VERIFIED: PROJECT.md — limite conhecido]` / formato exato do header `[ASSUMED — confirmar nome do header de reset]`
**Warning signs:** picos de 429 nos logs.

### Pitfall 4: ESM vs CJS
**What goes wrong:** Misturar `require` e `import`, ou esquecer `"type": "module"`, gera erros de import.
**Why it happens:** Node suporta ambos; precisa ser consistente.
**How to avoid:** `"type": "module"` no package.json, usar `import` em todo lugar, extensões `.js` explícitas em imports relativos. `[ASSUMED]`
**Warning signs:** `ERR_REQUIRE_ESM` / `Cannot use import statement outside a module`.

### Pitfall 5: `.env` vazar para o git
**What goes wrong:** Segredos commitados (e as keys já vazaram em chat).
**How to avoid:** `.gitignore` com `.env` ANTES do primeiro commit; versionar só `.env.example`. Rotacionar keys antes de produção (blocker ativo no STATE). `[VERIFIED: STATE.md blocker]`
**Warning signs:** `git status` listando `.env`.

## Code Examples

### Smoke test de boot (entrypoint) — prova auth das 2 APIs (CFG-02/03/04)
```javascript
// src/index.js
import { config } from './config/index.js';
import { logger } from './lib/logger.js';
import { clickup } from './clients/clickup.js';
import { ghl } from './clients/ghl.js';

const log = logger.child({ action: 'boot' });
try {
  const list = await clickup.getList(config.CLICKUP_LIST_ID);
  log.info({ listName: list.name }, 'ClickUp autenticado');
  const accounts = await ghl.listAccounts();
  log.info({ count: accounts?.accounts?.length }, 'GHL autenticado');
  log.info('Fundação OK — clients prontos');
} catch (err) {
  log.fatal({ err }, 'Falha no smoke test de boot');
  process.exit(1);
}
```

### `.env.example` (popular com os ids reais do PROJECT.md, sem tokens)
```dotenv
CLICKUP_TOKEN=pk_xxx
CLICKUP_LIST_ID=901327135553
GHL_TOKEN=pit-xxx
GHL_LOCATION_ID=zEFpdSK1pMIC9d8aY4Lm
GHL_API_VERSION=2021-07-28
CF_LEGENDA=91c07244-6ce6-42c7-bea2-ec49dba12fd3
CF_DATA_PUBLICACAO=d5107244-d044-4bd0-ae5c-c07f8a4f194e
CF_IG_MEDIA_ID=cde1cd79-ecdc-43f7-b29e-7d0f42c2eed1
CF_LINK_PUBLICADO=e98e36fe-1d17-48b7-a797-9ae9b1623d0f
CF_ERRO_PUBLICACAO=1137de68-9a0a-467e-8848-1d0e59844d5e
CF_ID_TASK_MAE=3f37fbaa-93d0-4344-9fe2-f7c2c7320383
LOG_LEVEL=info
```

## State of the Art

| Old Approach | Current Approach (2026) | When Changed | Impact |
|--------------|-------------------------|--------------|--------|
| `node-fetch` / `axios` para HTTP | `fetch` global nativo (undici) | estável desde Node 21 | menos uma dependência |
| `.env` só via `dotenv` | `node --env-file=.env` nativo opcional | Node 20.6+ / estável no 24 | dotenv ainda preferível p/ mensagens, mas nativo é viável |
| `winston` p/ logs | `pino` (JSON estruturado, rápido) | maduro há anos | logs JSON prontos p/ ingest |
| Throttle manual | `bottleneck` / `p-ratelimit` | — | p-ratelimit parado desde 2022 → preferir bottleneck |

**Deprecated/outdated:**
- `node-fetch`: desnecessário no Node 24 (fetch é global).
- `p-ratelimit`: sem release desde 2022 — preferir bottleneck.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Header `Version: 2021-07-28` funciona p/ create-post do GHL (validado só no `accounts`) | Pitfall 1 | Phase 2 falha no agendamento; mitigado por env configurável |
| A2 | Formato exato do PUT custom field (date=ms, dropdown=option id) conforme docs | Pitfall 2 | Updates de task no ClickUp silenciosamente erram |
| A3 | Nome do header de reset de rate limit do ClickUp (`X-RateLimit-Reset`) | Pattern 2 / Pitfall 3 | Backoff usa fallback fixo (5s) em vez do valor real — funcional mas subótimo |
| A4 | `dotenv` > `node --env-file` para este projeto | Stack/Alternatives | Baixo — ambos funcionam; troca trivial |
| A5 | `pino` > `winston`; `zod` > `envalid`; `fetch` nativo > axios/got | Stack/Alternatives | Baixo — preferências de stack, todas viáveis |
| A6 | GHL create-post retorna o post id no body (201) | (escopo Phase 2) | Idempotência (SCH-05/06) depende disso; confirmar na Phase 2 |

**Estas assunções devem ser confirmadas:** A1/A2/A3 idealmente nesta fase via smoke test estendido (1 GET de fields + 1 leitura de task real); A6 fica para Phase 2.

## Open Questions

1. **`node --env-file` nativo vs `dotenv`?**
   - Sabemos: Node 24 suporta `--env-file`; dotenv dá mensagens/expand melhores.
   - Incerto: preferência do time.
   - Recomendação: usar `dotenv` (decisão de baixo risco, reversível).

2. **Confirmar shapes de erro de cada API para `errors.js`?**
   - Sabemos: ClickUp retorna `{err, ECODE}`; GHL retorna `{message, statusCode}` (típico) — `[ASSUMED]`.
   - Incerto: exemplos reais de payload de erro.
   - Recomendação: capturar e logar o body bruto no smoke test desta fase para fixar os mapeadores.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | runtime | ✓ | v24.14.0 (LTS) | — |
| npm | gestão de deps | ✓ | 11.9.0 | — |
| Acesso de rede a `api.clickup.com` | client ClickUp | presumido ✓ | — | sem fallback |
| Acesso de rede a `services.leadconnectorhq.com` | client GHL | presumido ✓ (accounts deu 200 ao vivo) | — | sem fallback |
| Token ClickUp `pk_…` válido | CFG-02 | ✓ (validado ao vivo) | — | rotacionar (vazou) |
| Token GHL `pit-…` válido | CFG-03 | ✓ (validado ao vivo) | — | rotacionar (vazou) |

**Missing dependencies with no fallback:** nenhuma — runtime e tokens presentes.
**Missing dependencies with fallback:** nenhuma.

## Security Domain

`security_enforcement: true`, ASVS level 1, block_on: high.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Tokens via `.env`; nunca no código nem em logs (redaction pino) |
| V3 Session Management | no | Serviço sem sessão de usuário (token-to-API) |
| V4 Access Control | no | Sem multiusuário nesta fase |
| V5 Input Validation | yes (parcial) | `zod` valida config; validação de payload externo vem na Phase 3 (webhook) |
| V6 Cryptography | no (hand-roll) | Sem cripto própria; TLS é do `fetch`/HTTPS |
| V7 Error Handling & Logging | yes | Logs estruturados sem vazar segredos; erros normalizados em `AppError` |
| V8 Data Protection | yes | Segredos só em `.env` gitignored; `.env.example` sem valores reais |

### Known Threat Patterns for Node.js standalone + tokens

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Token vazado em commit/log | Information Disclosure | `.gitignore` `.env`; pino `redact` em `authorization`; rotacionar keys vazadas (blocker ativo) |
| Slopsquatting de dependência | Tampering | Package legitimacy audit (feito acima); lockfile commitado |
| Erro da API logado com PII/segredo | Information Disclosure | Mapeador de erro loga só status + código, não headers |
| Variável de config faltando em prod | DoS / mau funcionamento | Fail-fast com zod no boot |

**Ação de segurança obrigatória nesta fase:** garantir `.env` no `.gitignore` antes do primeiro commit e configurar redaction no logger. Rotação das keys vazadas é pré-produção (rastreada no STATE).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CFG-01 | Toda config via `.env`, nenhum segredo no código | Pattern 1 (zod + dotenv fail-fast), `.env.example` com ids reais, estrutura `src/config` |
| CFG-02 | Client ClickUp com auth por token + rate limit (100/min) | Pattern 2 (`src/clients/clickup.js`), bottleneck reservoir, p-retry em 429 |
| CFG-03 | Client GHL com `Bearer` + header `Version`, apontando p/ a location | Pattern 2 (`src/clients/ghl.js`), header `2021-07-28` validado ao vivo, locationId via env |
| CFG-04 | Logging estruturado de cada ação (agendou/publicou/erro) com taskId e ghlPostId | Pattern 3 (pino + child loggers com `{taskId, ghlPostId, action}`), redaction de segredos |

## Sources

### Primary (HIGH confidence)
- `node --version` local → v24.14.0; `npm view` (versões de pacotes, datas) — verificado nesta sessão
- `gsd-tools query package-legitimacy check` — verdicts dos pacotes
- PROJECT.md / REQUIREMENTS.md / STATE.md — fatos validados ao vivo (auth headers, accounts 200, ids reais)

### Secondary (MEDIUM confidence)
- endoflife.date/nodejs + nodejs.org — status do Node 24 LTS em 2026
- developer.clickup.com/reference/setcustomfieldvalue + /docs/customfields — formato de custom field
- marketplace.gohighlevel.com/docs/ghl/social-planner/create-post — endpoint create-post

### Tertiary (LOW confidence)
- Preferências de stack (pino vs winston, zod vs envalid, dotenv vs nativo) — conhecimento de treino, marcadas `[ASSUMED]`

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versões verificadas no registry nesta sessão; Node confirmado local
- Architecture: HIGH — padrões consolidados para serviços Node pequenos
- API formats: MEDIUM — auth validado ao vivo; create-post/custom-field via docs, marcados `[ASSUMED]`
- Pitfalls: MEDIUM/HIGH — derivados de docs oficiais + constraints do projeto

**Research date:** 2026-06-22
**Valid until:** ~2026-07-22 (stack estável; reverificar versões de pacotes se planejado após 30 dias)
