# Agent Posts Auton

Serviço Node.js que sincroniza posts de Instagram entre o **ClickUp** e o **GoHighLevel (GHL)**.

Lê os cards da lista de producao de conteudo no ClickUp com status "a agendar", cria os posts
agendados no Social Planner do GHL (conta Instagram `auton.app`), e mantém o status sincronizado
nos dois sentidos via webhook do GHL.

## Pre-requisitos

- **Node.js >= 24** (LTS). Verifique com `node --version`.
- **npm >= 10**. Incluido com o Node 24.
- Acesso de rede a `api.clickup.com` e `services.leadconnectorhq.com`.
- Tokens validos do ClickUp e do GHL (ver secao Configuracao abaixo).

## Configuracao

Copie `.env.example` para `.env` e preencha cada variavel:

```bash
cp .env.example .env
# Abra .env e preencha os tokens e ids reais
```

### Variaveis de ambiente

| Variavel | Descricao |
|---|---|
| `CLICKUP_TOKEN` | Token pessoal do ClickUp (`pk_...`). Obtido em *ClickUp → Settings → Apps → API Token*. |
| `CLICKUP_LIST_ID` | ID da lista de producao de conteudo no ClickUp (ex: `901327135553`). |
| `GHL_TOKEN` | Token PIT do GHL (`pit-...`). Obtido em *GHL → Settings → Private Integration Token*. |
| `GHL_LOCATION_ID` | Location ID da conta GHL (ex: `zEFpdSK1pMIC9d8aY4Lm`). |
| `GHL_API_VERSION` | Versao da API GHL. Padrao: `2021-07-28`. Nao altere sem testar. |
| `CU_FIELD_LEGENDA` | UUID do custom field "Legenda" no ClickUp. |
| `CU_FIELD_DATA_PUBLICACAO` | UUID do custom field "Data de publicacao" no ClickUp. |
| `CU_FIELD_IG_MEDIA_ID` | UUID do custom field "IG Media ID" no ClickUp. |
| `CU_FIELD_LINK_PUBLICADO` | UUID do custom field "Link publicado" no ClickUp. |
| `CU_FIELD_ERRO_PUBLICACAO` | UUID do custom field "Erro de publicacao" no ClickUp. |
| `CU_FIELD_ID_TASK_MAE` | UUID do custom field "ID da task mae" no ClickUp. |
| `LOG_LEVEL` | Nivel de log: `fatal`, `error`, `warn`, `info`, `debug`, `trace`. Padrao: `info`. |

Os UUIDs dos custom fields estao listados no `.env.example` com os valores do ambiente de producao.
Nao commite o `.env` real — ele esta no `.gitignore`.

## Como rodar

### Instalar dependencias

```bash
npm install
```

### Smoke test de boot (recomendado antes de qualquer deploy)

Autentica nas duas APIs, le a lista do ClickUp, lista as contas do GHL e mapeia os
custom fields (campo Formato) para confirmar que a fundacao esta funcionando:

```bash
npm start
```

Saida esperada (logs JSON estruturados):
```
{"level":"info","action":"boot","step":"config","msg":"Config carregada e validada do .env"}
{"level":"info","action":"boot","step":"clickup.getList","listName":"Agendamentos & Publicacoes","msg":"ClickUp autenticado"}
{"level":"info","action":"boot","step":"ghl.listAccounts","count":1,"msg":"GHL autenticado"}
{"level":"info","action":"boot","step":"clickup.getListFields","field":"Formato","labelToId":{...},"msg":"Campo Formato mapeado"}
{"level":"info","action":"boot","step":"done","msg":"Fundacao OK — clients prontos"}
```

### Testes unitarios

Testes de fail-fast da config e de normalizacao de AppError (sem necessidade de .env real):

```bash
node --test test/config.test.js test/errors.test.js
```

### Todos os testes (unit + smoke de integracao)

```bash
npm test
```

O smoke test de integracao (`test/smoke.test.js`) e pulado graciosamente se o `.env` nao
estiver configurado.

## Nota de seguranca — IMPORTANTE

**As chaves CLICKUP_TOKEN e GHL_TOKEN foram expostas em uma sessao de chat.**

Antes de qualquer deploy em producao:

1. **Rotacionar o `CLICKUP_TOKEN`**: acesse *ClickUp → Settings → Apps → API Token → Regenerate*.
2. **Rotacionar o `GHL_TOKEN`**: acesse *GHL → Settings → Private Integration Token → Regenerar*.
3. Atualize o `.env` com os novos tokens rotacionados.
4. Verifique que o `.env` nao foi commitado: `git status` nao deve listar `.env`.
5. Verifique o historico: `git log --all -p -- .env` nao deve retornar nada.

Este blocker esta rastreado no STATE.md e e pre-requisito para producao.
