# Agent Posts Auton — ClickUp → GHL Instagram Scheduler

## What This Is

Um serviço Node.js que sincroniza posts de Instagram entre o ClickUp e o GoHighLevel (GHL). Ele lê os cards da lista de produção de conteúdo no ClickUp que estão prontos para agendar, cria os posts agendados no Social Planner do GHL (conta Instagram `auton.app`), e mantém o status sincronizado nos dois sentidos — quando o GHL publica ou muda o estado de um post, o card correspondente no ClickUp é atualizado automaticamente.

## Core Value

Um post marcado como "a agendar" no ClickUp aparece agendado no GHL para o Instagram, e quando ele é publicado o ClickUp reflete isso sozinho — sem ninguém copiar nada à mão entre as duas ferramentas.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — ship to validate)

### Active

<!-- Current scope. Building toward these. -->

- [ ] Ler tasks da lista "Agendamentos & Publicações" (ClickUp) com status `a agendar` e `Data de publicação` preenchida
- [ ] Resolver o conteúdo do post (legenda + mídia), buscando na task e/ou na task mãe (`id da task mãe`)
- [ ] Criar/agendar o post no GHL Social Planner para a conta Instagram, na data de publicação definida
- [ ] Ao agendar com sucesso: mover a task no ClickUp para `agendado` e gravar o id do post GHL
- [ ] Receber webhook do GHL quando o status do post muda (publicado/erro) e atualizar a task no ClickUp (`publicado` / preencher `Erro de publicação`)
- [ ] Ao publicar: preencher `IG Media ID`, `Link publicado` e `Primeiro comentário` (se houver) na task
- [ ] Idempotência: nunca agendar o mesmo post duas vezes (controle via id do post GHL salvo na task)
- [ ] Tratamento de erros e logs: falha de agendamento/publicação registrada no campo `Erro de publicação` e visível em log
- [ ] Configuração 100% via `.env` (tokens, locationId, list id, ids de campos/status) — nada de segredo no código

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Coleta de métricas de performance (Alcance, Salvamentos, Engajamento etc.) — campos existem na lista mas ficam para um milestone posterior; foco v1 é agendar + sincronizar status
- Criação/edição de conteúdo (legenda, arte) — isso é trabalho humano feito antes, fora do escopo do script
- Outras redes além do Instagram (LinkedIn, X, TikTok) — GHL suporta, mas v1 é só Instagram `auton.app`
- Interface gráfica / dashboard próprio — o "frontend" é o próprio ClickUp
- Multi-workspace / multi-cliente genérico — v1 é específico do workspace Auton e da location GHL fornecida

## Context

**Integração entre duas ferramentas SaaS, sem UI própria.** O ClickUp é o painel de operação do time de conteúdo; o GHL é o publicador. O script é a cola entre eles.

**ClickUp (workspace "Auton", id `90132819023`):**
- Space "Marketing" → folder "MOTOR 02 — Instagram" → lista **"Agendamentos & Publicações"** (`901327135553`)
- Statuses: `a agendar` (open) → `agendado` (custom) → `publicado` (custom) → `monitorando` (closed)
- Custom fields relevantes:
  - `Legenda` (text) — `91c07244-6ce6-42c7-bea2-ec49dba12fd3`
  - `Formato` (drop_down: Reels, Carrossel, Stories, Feed estático) — `24e0f126-589f-400c-a602-0e4abe19b809`
  - `Data de publicação` (date) — `d5107244-d044-4bd0-ae5c-c07f8a4f194e`
  - `Conta IG` (text) — `bb68ffc9-1892-438d-a364-9c7d9b7da352`
  - `IG Media ID` (text) — `cde1cd79-ecdc-43f7-b29e-7d0f42c2eed1`
  - `Link publicado` (url) — `e98e36fe-1d17-48b7-a797-9ae9b1623d0f`
  - `Primeiro comentário` (text) — `eb164fea-7dc2-48ba-9420-e7002c6c2ec6`
  - `Erro de publicação` (text) — `1137de68-9a0a-467e-8848-1d0e59844d5e`
  - `id da task mãe` (text) — `3f37fbaa-93d0-4344-9fe2-f7c2c7320383`
- Observação: na task de exemplo (`86aj5g8fq`) a `Legenda` está vazia e há 0 anexos, mas existe `id da task mãe` (`86aj32mwf`). A legenda final e a arte/vídeo provavelmente vivem na task mãe — **confirmar fonte da mídia na fase de implementação.**

**GHL (GoHighLevel):**
- locationId: `zEFpdSK1pMIC9d8aY4Lm`
- Conta Instagram conectada no Social Planner: **`auton.app`** (account id `…_17841440215631995`, platform `instagram`)
- API base: `https://services.leadconnectorhq.com`, header `Version: 2021-07-28`
- Auth: Private Integration Token (`pit-…`), escopos de Social Planner habilitados (verificado: `GET /social-media-posting/{locationId}/accounts` → 200)

**Mídia:** o GHL Social Planner precisa da mídia (imagem/vídeo) como URL/arquivo. Anexos do ClickUp expõem URL; pode ser necessário enviar a mídia para a media library do GHL antes de agendar. A resolver na implementação.

## Constraints

- **Tech stack**: Node.js standalone (decisão do usuário). Sem framework de UI. Provável uso de `node-fetch`/`undici` + um pequeno servidor HTTP (Express/Fastify) para receber o webhook do GHL.
- **Security**: tokens ClickUp (`pk_…`) e GHL (`pit-…`) e locationId ficam em `.env` (gitignored). **As keys foram expostas em chat — rotacionar antes de produção.**
- **Hospedagem**: o webhook do GHL exige endpoint público (HTTPS). Definir host (VPS, Render, Railway, túnel) — a resolver.
- **Sync GHL→ClickUp**: via **webhook do GHL** (tempo real), não polling (decisão do usuário).
- **Gatilho ClickUp→GHL**: status `a agendar` + `Data de publicação` preenchida.
- **Idempotência**: cada task guarda o id do post GHL para evitar duplicidade.
- **API limits**: respeitar rate limits do ClickUp (100 req/min por token) e do GHL.

## Key Decisions

<!-- Decisions that constrain future work. Add throughout project lifecycle. -->

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Script Node.js standalone (vs n8n/Supabase) | Escolha do usuário; mais controle | — Pending |
| Sync GHL→ClickUp via webhook | Tempo real, sem polling | — Pending |
| Gatilho de agendamento = status `a agendar` + `Data de publicação` | Espelha o fluxo de produção existente no ClickUp | — Pending |
| Instagram só via GHL Social Planner (conta `auton.app`) | Conta já conectada e validada na location | ✓ Good |
| Métricas de performance fora do v1 | Foco em agendar + status; métricas depois | — Pending |
| Segredos em `.env`, rotacionar keys expostas | Keys vazaram no chat de setup | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-06-22 after initialization*
