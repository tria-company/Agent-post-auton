# Requirements — Agent Posts Auton

Integração ClickUp → GHL (Instagram) com sincronização bidirecional de status.

## v1 Requirements

### Configuração & Infra (CFG)

- [x] **CFG-01**: Toda configuração (tokens, locationId, list id, ids de campos e status) é lida de `.env`; nenhum segredo no código
- [x] **CFG-02**: Cliente ClickUp com autenticação por token e tratamento de rate limit (100 req/min)
- [x] **CFG-03**: Cliente GHL com `Authorization: Bearer` + header `Version`, apontando para a location configurada
- [x] **CFG-04**: Logging estruturado de cada ação (agendou, publicou, erro) com id da task e id do post GHL

### Agendamento ClickUp → GHL (SCH)

- [ ] **SCH-01**: Detectar tasks da lista com status `a agendar` e `Data de publicação` preenchida
- [ ] **SCH-02**: Resolver o conteúdo do post — legenda (campo `Legenda`, com fallback para a task mãe via `id da task mãe`) e mídia (anexos da task/task mãe)
- [ ] **SCH-03**: Disponibilizar a mídia para o GHL (URL pública ou upload na media library do GHL) antes de agendar
- [ ] **SCH-04**: Criar o post agendado no GHL Social Planner para a conta Instagram, no horário de `Data de publicação`, respeitando o `Formato`
- [ ] **SCH-05**: Em caso de sucesso, mover a task para `agendado` e persistir o id do post GHL na task
- [ ] **SCH-06**: Idempotência — não reagenda task que já possui id de post GHL salvo
- [ ] **SCH-07**: Em caso de falha ao agendar, preencher `Erro de publicação` e manter a task em `a agendar` para retry

### Sincronização GHL → ClickUp (SYNC)

- [ ] **SYNC-01**: Loop de polling periódico consulta o GHL pelo status dos posts agendados (publicado/erro) — o GHL não emite webhook de post (confirmado na pesquisa Phase 3)
- [ ] **SYNC-02**: Validar autenticidade do webhook (segredo/assinatura) antes de processar
- [ ] **SYNC-03**: Mapear o post GHL recebido de volta para a task ClickUp (via id do post salvo)
- [ ] **SYNC-04**: Ao publicar, mover a task para `publicado` e preencher `IG Media ID` e `Link publicado`
- [ ] **SYNC-05**: Ao falhar a publicação no GHL, preencher `Erro de publicação` na task
- [ ] **SYNC-06**: Webhook idempotente — reentrega do mesmo evento não duplica atualização

### Gatilho ClickUp → GHL por Webhook (TRIG)

- [x] **TRIG-01**: Endpoint HTTP público recebe webhook do ClickUp para mudança de status de task na lista de agendamentos (901327135553)
- [x] **TRIG-02**: Validar autenticidade do webhook do ClickUp (assinatura HMAC/segredo) antes de processar
- [x] **TRIG-03**: Ao receber task que mudou para `agendado`, disparar o agendamento em tempo real reusando o pipeline existente (`processTask`)
- [x] **TRIG-04**: Idempotência — reentrega/duplicação do webhook não reagenda (reusa a guarda do GHL Post ID)
- [x] **TRIG-05**: O batch `npm start` (runSchedulerBatch) permanece disponível como fallback manual de varredura/reprocessamento

### Operação & Robustez (OPS)

- [ ] **OPS-01**: Processo de polling/agendador roda continuamente em intervalo configurável
- [ ] **OPS-02**: Erros de rede/API são re-tentados com backoff, sem travar o restante da fila
- [ ] **OPS-03**: README com setup, variáveis de ambiente e instruções de deploy do webhook

## v2 Requirements (deferred)

- [ ] **MET-01**: Coletar métricas do post (Alcance, Visualizações, Salvamentos, Comentários, Compartilhamentos, Engajamento, Cliques) e gravar nos campos ao entrar em `monitorando`
- [ ] **MET-02**: Postar `Primeiro comentário` automaticamente após publicação
- [ ] **MULTI-01**: Suporte a outras redes (LinkedIn, X, TikTok) e múltiplas contas IG

## Out of Scope

- Criação/edição de conteúdo (legenda, arte) — trabalho humano anterior ao script
- Dashboard/UI própria — o painel é o próprio ClickUp
- Multi-cliente genérico — v1 é específico do workspace Auton + location GHL fornecida

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CFG-01 | Phase 1 | Complete |
| CFG-02 | Phase 1 | Complete |
| CFG-03 | Phase 1 | Complete |
| CFG-04 | Phase 1 | Complete |
| SCH-01 | Phase 2 | Pending |
| SCH-02 | Phase 2 | Pending |
| SCH-03 | Phase 2 | Pending |
| SCH-04 | Phase 2 | Pending |
| SCH-05 | Phase 2 | Pending |
| SCH-06 | Phase 2 | Pending |
| SCH-07 | Phase 2 | Pending |
| SYNC-01 | Phase 3 | Pending |
| SYNC-02 | Phase 3 | Pending |
| SYNC-03 | Phase 3 | Pending |
| SYNC-04 | Phase 3 | Pending |
| SYNC-05 | Phase 3 | Pending |
| SYNC-06 | Phase 3 | Pending |
| TRIG-01 | Phase 3 | Pending |
| TRIG-02 | Phase 3 | Pending |
| TRIG-03 | Phase 3 | Pending |
| TRIG-04 | Phase 3 | Pending |
| TRIG-05 | Phase 3 | Pending |
| OPS-01 | Phase 4 | Pending |
| OPS-02 | Phase 4 | Pending |
| OPS-03 | Phase 4 | Pending |

**Cobertura:** 24/24 requirements v1 mapeados — sem órfãos, sem duplicatas.
