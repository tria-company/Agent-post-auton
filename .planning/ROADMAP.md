# Roadmap: Agent Posts Auton — ClickUp ↔ GHL Instagram Scheduler

## Overview

O projeto entrega a "cola" entre o ClickUp (painel de produção de conteúdo) e o GHL Social Planner (publicador do Instagram `auton.app`). Começa estabelecendo a fundação — configuração via `.env`, clients autenticados de ClickUp e GHL, e logging — sobre a qual tudo se apoia. Em seguida entrega o fluxo de valor principal de ponta a ponta: detectar tasks `a agendar` no ClickUp, resolver legenda+mídia, agendar no GHL e devolver o status `agendado` com o id do post salvo. Depois fecha o laço inverso com o webhook GHL→ClickUp, que reflete publicação/erro de volta na task em tempo real. Por fim, torna o serviço operável e robusto: loop contínuo, retries com backoff e documentação de deploy. Cada fase entrega uma capacidade observável e verificável por uma pessoa usando o ClickUp e o GHL.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Fundação (Config + Clients + Logging)** - `.env`, clients autenticados de ClickUp e GHL e logging estruturado prontos para uso
- [ ] **Phase 2: Agendamento ClickUp → GHL** - Task `a agendar` vira post agendado no GHL e volta como `agendado` no ClickUp
- [ ] **Phase 3: Sincronização GHL → ClickUp (Webhook)** - Publicação/erro no GHL reflete automaticamente na task do ClickUp
- [ ] **Phase 4: Operação & Robustez** - Serviço roda continuamente, sobrevive a falhas de rede e é deployável via README

## Phase Details

### Phase 1: Fundação (Config + Clients + Logging)
**Goal**: Estabelecer a base do serviço: toda configuração vem do `.env`, os clients de ClickUp e GHL autenticam e respondem, e cada ação gera log estruturado.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: CFG-01, CFG-02, CFG-03, CFG-04
**Success Criteria** (what must be TRUE):
  1. O serviço sobe lendo tokens, locationId, list id e ids de campos/status exclusivamente do `.env` — não há nenhum segredo hardcoded no código
  2. Uma chamada de teste ao ClickUp com o token configurado retorna dados da lista "Agendamentos & Publicações" e respeita o rate limit (100 req/min)
  3. Uma chamada de teste ao GHL (`GET /social-media-posting/{locationId}/accounts`) com `Authorization: Bearer` + header `Version` retorna 200 e lista a conta Instagram `auton.app`
  4. Cada ação executada produz um log estruturado contendo id da task e (quando aplicável) id do post GHL
**Plans**: TBD

### Phase 2: Agendamento ClickUp → GHL
**Goal**: Entregar o fluxo de valor principal de ponta a ponta — uma task marcada `a agendar` com `Data de publicação` preenchida vira um post agendado no GHL Social Planner para o Instagram, e a task retorna como `agendado` com o id do post salvo.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: SCH-01, SCH-02, SCH-03, SCH-04, SCH-05, SCH-06, SCH-07
**Success Criteria** (what must be TRUE):
  1. O serviço detecta tasks da lista com status `a agendar` e `Data de publicação` preenchida e ignora as demais
  2. Para cada task elegível, a legenda é resolvida do campo `Legenda` (com fallback para a task mãe via `id da task mãe`) e a mídia é disponibilizada ao GHL (URL pública ou upload na media library)
  3. Um post agendado aparece no GHL Social Planner para a conta `auton.app` no horário de `Data de publicação`, respeitando o `Formato` (Reels/Carrossel/Stories/Feed)
  4. Ao agendar com sucesso, a task passa para `agendado` e o id do post GHL fica persistido nela; uma task que já tem id de post salvo nunca é reagendada
  5. Em caso de falha ao agendar, a task permanece em `a agendar` e o campo `Erro de publicação` é preenchido com a causa, permitindo retry
**Plans**: TBD

### Phase 3: Sincronização GHL → ClickUp (Webhook)
**Goal**: Fechar o laço inverso — quando o GHL publica ou falha um post, o webhook atualiza automaticamente a task correspondente no ClickUp em tempo real.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06
**Success Criteria** (what must be TRUE):
  1. Um endpoint HTTP público recebe o webhook do GHL para eventos de post e só processa eventos cuja autenticidade (segredo/assinatura) foi validada
  2. O evento recebido é mapeado de volta para a task ClickUp correta usando o id do post salvo na task
  3. Ao publicar, a task move para `publicado` e os campos `IG Media ID` e `Link publicado` são preenchidos
  4. Ao falhar a publicação no GHL, o campo `Erro de publicação` da task é preenchido
  5. A reentrega do mesmo evento de webhook não duplica nem corrompe a atualização da task (idempotência)
**Plans**: TBD

### Phase 4: Operação & Robustez
**Goal**: Tornar o serviço confiável e deployável para uso real — loop contínuo configurável, resiliência a falhas de rede/API e documentação completa de setup e deploy do webhook.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: OPS-01, OPS-02, OPS-03
**Success Criteria** (what must be TRUE):
  1. O agendador roda continuamente em intervalo configurável (via `.env`), processando novas tasks elegíveis sem intervenção manual
  2. Erros transitórios de rede/API são re-tentados com backoff e uma falha isolada não trava o processamento das demais tasks da fila
  3. O README permite a uma pessoa configurar o `.env`, subir o serviço e expor o endpoint do webhook do GHL seguindo apenas as instruções escritas
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Fundação (Config + Clients + Logging) | 0/TBD | Not started | - |
| 2. Agendamento ClickUp → GHL | 0/TBD | Not started | - |
| 3. Sincronização GHL → ClickUp (Webhook) | 0/TBD | Not started | - |
| 4. Operação & Robustez | 0/TBD | Not started | - |
