# Phase 2: Agendamento ClickUp → GHL - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-22
**Phase:** 2-agendamento-clickup-ghl
**Areas discussed:** Persistência do post GHL + idempotência, Fonte de legenda e mídia (task vs task mãe), Entrega da mídia ao GHL, Formato → tipo de post GHL + casos de borda, Origem/acesso da mídia (MinIO)

---

## Persistência do post GHL + idempotência (SCH-05/06)

| Option | Description | Selected |
|--------|-------------|----------|
| Novo campo 'GHL Post ID' | Custom field text dedicado + CU_FIELD_GHL_POST_ID no .env | ✓ |
| Reusar 'IG Media ID' | Sem campo novo, mas conflita com a Fase 3 e quebra idempotência | |
| Comentário/descrição da task | Sem campo novo, mas frágil de ler | |

**User's choice:** Novo campo 'GHL Post ID' (dedicado).
**Notes:** Idempotência via presença do id salvo; checagem antes de chamar o GHL. Usuário criará o campo no ClickUp e fornecerá o UUID.

---

## Fonte de legenda e mídia (task vs task mãe) (SCH-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Fallback p/ mãe quando vazio | Usa a filha; busca na mãe o que estiver vazio; campo a campo | ✓ |
| Sempre usar a task mãe | Ignora a filha | |
| Só a task filha (sem fallback) | Não olha a mãe | |

**User's choice:** Fallback p/ mãe quando vazio.
**Notes:** Legenda e referência de mídia resolvidas de forma independente. Após fallback, ausência de legenda/mídia → falha de validação (não agenda).

---

## Entrega / origem da mídia ao GHL (SCH-03)

| Option | Description | Selected |
|--------|-------------|----------|
| URL direta com upload de fallback | Tenta URL do anexo ClickUp; senão upload | |
| Sempre upload na media library | Sempre sobe pro GHL | (superado) |
| Sempre URL direta | Só passa URL | |

**User's choice (free-text):** "eu irei passar a url do minio do post que está zipado, vc vai deszipar e vai colocar o arquivo em ordem numerica pelo nome do post."
**Notes:** Redefine a fonte da mídia: NÃO são anexos do ClickUp, e sim um **zip no MinIO**. Fluxo: baixar zip → descompactar → ordenar por nome numérico → upload dos arquivos extraídos na media library do GHL. Follow-ups abaixo.

### Follow-ups (MinIO)

| Pergunta | Resposta |
|----------|----------|
| De onde vem a URL do zip? | Do custom field **`Link do post`** (distinto de `Link publicado`). Precisa de CU_FIELD_LINK_DO_POST no .env. |
| Nomeação/ordenação dos arquivos | Numérico (1, 2, 3…); ordem crescente. Carrossel usa todos na ordem; Reels/Feed usa o único/primeiro. |
| Acesso ao MinIO | URL pre-signed / pública — download direto, sem credencial. |

---

## Formato → tipo de post GHL + casos de borda (SCH-04/07)

| Option | Description | Selected |
|--------|-------------|----------|
| Conservador | Reels/Carrossel/Feed mapeados; Stories + inválidos → erro, mantém `a agendar` | ✓ |
| Incluir Stories se a API suportar | Tenta Stories também | |
| Default Feed quando Formato vazio | Assume Feed estático no vazio | |

**User's choice:** Conservador.
**Notes:** Stories não é agendado nesta fase. Tasks inválidas (Formato vazio/desconhecido, data no passado, sem mídia/legenda após fallback) → preenche `Erro de publicação`, mantém `a agendar`, não agenda.

## Claude's Discretion

- Estrutura dos módulos (orquestrador do pipeline), biblioteca de unzip, manejo de arquivos temporários.
- Endpoints exatos (query de tasks da lista, upload de media library do GHL, payload de createPost) — confirmados na pesquisa.
- Parsing de data ClickUp (epoch ms) → formato/timezone do GHL.
- Novos métodos nos clients ClickUp/GHL seguindo padrões da Fase 1.

## Deferred Ideas

- Webhook GHL→ClickUp e idempotência de webhook — Fase 3.
- Loop contínuo + backoff + README de deploy — Fase 4.
- IG Media ID / Link publicado / Primeiro comentário / métricas — Fase 3 / v2.
- Stories e outras redes/contas — fora do v1.
