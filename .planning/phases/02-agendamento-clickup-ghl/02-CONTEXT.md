# Phase 2: Agendamento ClickUp → GHL - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Entregar o fluxo de valor principal **ClickUp → GHL**, em uma passada de processamento (não o loop contínuo — isso é Fase 4):

1. Detectar tasks da lista "Agendamentos & Publicações" com status `a agendar` **e** `Data de publicação` preenchida (SCH-01).
2. Para cada task elegível, resolver **legenda** (campo `Legenda`, fallback p/ task mãe) e **mídia** (zip no MinIO referenciado pelo campo `Link do post`) — SCH-02.
3. Baixar o zip do MinIO, descompactar, ordenar os arquivos numericamente e disponibilizá-los ao GHL (upload na media library do GHL) — SCH-03.
4. Criar o post **agendado** no GHL Social Planner para a conta Instagram `auton.app`, no horário de `Data de publicação`, respeitando o `Formato` — SCH-04.
5. Em sucesso: mover a task para `agendado` e persistir o id do post GHL num campo dedicado; nunca reagendar task que já tem id salvo (SCH-05, SCH-06).
6. Em falha: preencher `Erro de publicação` e manter a task em `a agendar` p/ retry (SCH-07).

**Fora desta fase:** webhook GHL→ClickUp (Fase 3), loop contínuo + backoff resiliente + README de deploy (Fase 4), métricas e primeiro comentário (v2).

</domain>

<decisions>
## Implementation Decisions

### Idempotência e persistência do post GHL (SCH-05/SCH-06)
- **D-01:** O id do post GHL é gravado em um **novo custom field dedicado** no ClickUp, "GHL Post ID" (text). Não reusar `IG Media ID` (esse é o id da mídia do Instagram pós-publicação, escrito na Fase 3 — reuso quebraria a idempotência).
- **D-02:** Idempotência = se a task já tem "GHL Post ID" preenchido, **pular** (nunca reagendar). A checagem acontece antes de qualquer chamada ao GHL.
- **D-03 (ação de setup):** O usuário cria o custom field "GHL Post ID" no ClickUp e fornece o UUID; o planner adiciona `CU_FIELD_GHL_POST_ID` ao schema do `.env`/`config` (alias `CF_GHL_POST_ID`), seguindo o padrão existente de `src/config/index.js`.

### Fonte de legenda e mídia (SCH-02)
- **D-04:** Resolução com **fallback para a task mãe quando vazio**, campo a campo: usa a task filha; se um valor estiver vazio na filha, busca na task mãe via `id da task mãe` (`CF_ID_TASK_MAE`). Legenda e referência de mídia são resolvidas independentemente.
- **D-05:** A **legenda** vem do campo `Legenda` (`CF_LEGENDA`), com fallback p/ a mãe.
- **D-06:** A **mídia** NÃO vem de anexos do ClickUp. Vem de um **zip hospedado no MinIO**, cuja URL está no custom field **`Link do post`** (campo distinto de `Link publicado`), com o mesmo fallback p/ a mãe. O planner adiciona `CU_FIELD_LINK_DO_POST` ao `.env`/`config` (o usuário fornece o UUID do campo `Link do post`).
- **D-07:** Se, **após o fallback**, ainda faltar legenda ou mídia → trata como falha de validação (não agenda; ver D-14).

### Entrega da mídia ao GHL (SCH-03)
- **D-08:** A URL do MinIO é **pre-signed / pública** — download direto do zip, sem credencial (nada de keys de MinIO no `.env`).
- **D-09:** Fluxo de mídia: baixar o zip → descompactar em diretório temporário → **ordenar os arquivos por nome numérico crescente** (`1`, `2`, `3`, …) → fazer **upload dos arquivos extraídos para a media library do GHL** e usar as referências retornadas ao criar o post. (Como os arquivos vêm de dentro de um zip, não há URL pública por arquivo; passar URL direta ao GHL não se aplica — upload é o caminho.)
- **D-10:** O número de arquivos + o `Formato` determinam a composição: **Carrossel** usa todos os arquivos na ordem numérica; **Reels/Feed estático** usa o arquivo único (ou o primeiro). Tipo de mídia (imagem vs vídeo) inferido pela extensão do arquivo — Reels espera vídeo; Carrossel/Feed esperam imagem(ns).
- **D-11:** Limpar o diretório temporário (zip + extraídos) após agendar ou em falha.

### Formato → tipo de post GHL e casos de borda (SCH-04/SCH-07) — política conservadora
- **D-12:** Mapear `Formato` do ClickUp → tipo/flags do post GHL para **Reels**, **Carrossel** e **Feed estático** (valores exatos do payload GHL confirmados pela pesquisa).
- **D-13:** **Stories NÃO é agendado** nesta fase (tratado como inválido) — mesmo que a API suporte, fica fora do escopo v1 conservador.
- **D-14:** Toda task **inválida/ambígua** → **não agenda, preenche `Erro de publicação` (`CF_ERRO_PUBLICACAO`) com a causa e mantém `a agendar`** p/ correção humana e retry. Casos inválidos incluem: `Formato` vazio ou desconhecido (inclui Stories), `Data de publicação` no passado, legenda ausente após fallback, mídia ausente/zip inacessível após fallback.
- **D-15:** Conteúdo de `Erro de publicação`: mensagem humana curta com a causa (ex.: "Formato vazio", "Data no passado", "Sem mídia após fallback", ou o erro normalizado do GHL/MinIO). Sem stack trace; sem segredos.

### Status e nomes (SCH-01/SCH-05)
- **D-16:** Detecção: status exatamente `a agendar` + `Data de publicação` preenchida; demais tasks ignoradas. Transição de sucesso: `a agendar` → `agendado`. Os nomes de status (`a agendar`, `agendado`) viram config no `.env` (não hardcoded), seguindo o princípio CFG-01.

### Conta GHL e tipo de execução
- **D-17:** A conta de destino é a Instagram `auton.app` no Social Planner (account id já conhecido no PROJECT.md). O account id vira config (`.env`), não hardcoded.
- **D-18:** Esta fase roda como **uma passada (batch) sobre as tasks elegíveis**, acionável manualmente (ex.: `npm start` / script de entrada). O loop contínuo configurável fica para a Fase 4 (OPS-01). Uma falha isolada em uma task não deve abortar o processamento das demais.

### Claude's Discretion
- Estrutura interna dos módulos (ex.: um `scheduler`/`pipeline` que orquestra: query da lista → filtro de elegibilidade → resolução de conteúdo → mídia → createPost → write-back). Seguir os padrões de `src/clients/*` e `src/lib/*` da Fase 1.
- Biblioteca de unzip (ex.: `unzipper`/`adm-zip`/`yauzl`) e manejo de arquivos temporários — escolha do planner/pesquisa.
- Métodos novos nos clients: `clickup` (ex.: query de tasks da lista por status/filtro; já existem `getTask`/`updateTask`/`setCustomField`) e `ghl` (`createPost` já é stub; adicionar upload de mídia à media library).
- Formato exato do payload de `createPost` do GHL e do endpoint de upload de mídia — confirmados pela pesquisa.
- Parsing/normalização da data do ClickUp (epoch ms) → formato/timezone esperado pelo GHL.
- Logging estruturado de cada ação (reusar `withContext`), incluindo id da task e id do post GHL (CFG-04 já estabelecido).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projeto / decisões travadas
- `.planning/PROJECT.md` — IDs canônicos: lista ClickUp (`901327135553`), statuses, UUIDs dos custom fields (`Legenda`, `Formato` `24e0f126-589f-400c-a602-0e4abe19b809`, `Data de publicação`, `IG Media ID`, `Link publicado`, `Primeiro comentário`, `Erro de publicação`, `id da task mãe`), location GHL (`zEFpdSK1pMIC9d8aY4Lm`), conta `auton.app` (account id `…_17841440215631995`), base API + `Version: 2021-07-28`.
- `.planning/REQUIREMENTS.md` §SCH — requisitos SCH-01..SCH-07 desta fase.
- `.planning/ROADMAP.md` §"Phase 2" — goal e success criteria.

### Código existente (Fase 1 — fundação)
- `src/config/index.js` — schema zod do `.env`, padrão de aliases `CF_*`; aqui entram os novos campos (`CU_FIELD_GHL_POST_ID`, `CU_FIELD_LINK_DO_POST`, `CU_FIELD_FORMATO`, nomes de status, account id GHL).
- `src/clients/clickup.js` — client autenticado + rate limit; já expõe `getList`, `getListFields`, `getTask`, `updateTask`, `setCustomField`.
- `src/clients/ghl.js` — client autenticado; `listAccounts` + stub `createPost` (`POST /social-media-posting/{locationId}/posts`).
- `src/lib/logger.js` — `withContext` para logging estruturado (CFG-04).
- `src/lib/errors.js` — `AppError` + `fromClickUp`/`fromGHL` para erros normalizados (usar no preenchimento de `Erro de publicação`).
- `src/index.js` — entrypoint atual (smoke test); ponto de extensão p/ a passada de agendamento.

> Nota: campos `Formato`, `Link do post` e o novo `GHL Post ID` ainda **não** estão no `config` — o planner deve adicioná-los. UUIDs de `Formato` já em PROJECT.md; UUIDs de `Link do post` e `GHL Post ID` são fornecidos pelo usuário no `.env`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `clickup.getTask` / `updateTask` / `setCustomField`: leitura da task, transição de status e escrita de custom fields (GHL Post ID, Erro de publicação).
- `clickup.getListFields`: útil p/ validar/descobrir IDs de campos da lista.
- `ghl.createPost`: stub já apontando p/ o endpoint correto — só falta o payload real + upload de mídia.
- `AppError.fromClickUp` / `fromGHL`: normalização de erro → texto curto para `Erro de publicação`.
- `withContext` logger: padrão de log estruturado com `{ module, taskId, ghlPostId }`.

### Established Patterns
- Fetch nativo do Node 24 (sem axios/undici); retry via `p-retry`; ClickUp throttled via `Bottleneck` (100 req/min). Novos requests devem passar pelos clients existentes p/ herdar rate limit/retry.
- Config 100% via `.env` com fail-fast (zod) — nenhum segredo/ID hardcoded (CFG-01).
- 4xx não-429 viram `AbortError(AppError)` (não-retentável); 429/5xx retentáveis.

### Integration Points
- Listagem de tasks elegíveis: provável novo método no client ClickUp (query por lista + filtro de status), ou `getList`/endpoint de tasks da lista — a pesquisa confirma o endpoint (ex.: `GET /list/{id}/task` com filtros).
- Upload de mídia ao GHL: novo método no client `ghl` (endpoint de media library) — confirmar na pesquisa.
- Download do zip do MinIO: fetch nativo da URL pre-signed; unzip em tmp.

</code_context>

<specifics>
## Specific Ideas

- Task de exemplo real: `86aj5g8fq` (filha, Legenda vazia, 0 anexos) com `id da task mãe` = `86aj32mwf` — caso canônico do fallback p/ a mãe.
- Mídia chega como **zip no MinIO** via campo `Link do post`; arquivos nomeados numericamente (`1`, `2`, `3`…); ordenação numérica crescente define a ordem do Carrossel.
- URL do MinIO é pre-signed/pública (download direto).

</specifics>

<deferred>
## Deferred Ideas

- Webhook GHL→ClickUp (publicado/erro, idempotência de webhook) — **Fase 3**.
- Loop contínuo configurável, backoff resiliente que não trava a fila, README de deploy do webhook — **Fase 4**.
- `IG Media ID`, `Link publicado`, `Primeiro comentário`, métricas de performance — **Fase 3 / v2** (campos existem mas não são escritos nesta fase).
- Suporte a Stories e outras redes/contas — fora do v1.

None pendentes além das acima — discussão permaneceu no escopo da fase.

</deferred>

---

*Phase: 2-agendamento-clickup-ghl*
*Context gathered: 2026-06-22*
