# Phase 3: Webhooks Bidirecionais — Discussion Log

**Date:** 2026-06-22
**Mode:** discuss (default)

## Áreas discutidas

### 1. Status no GHL→ClickUp (falha de publicação)
- **Opções:** volta pra `a agendar` + Erro de publicação / status próprio de falha / mantém `agendado` só com erro
- **Escolha:** **volta pra `a agendar` + Erro de publicação** (limpa GHL Post ID para re-tentativa)
- **Nota:** consistente com o state machine invertido da Phase 2 (`a agendar` = precisa ajuste)

### 2. Escopo de deploy no VPS
- **Opções:** deploy básico incluído na Phase 3 / só construir, deploy na Phase 4
- **Escolha:** **deploy básico incluído na Phase 3** (serviço rodando e recebendo webhooks ao fim da fase; endurecimento na Phase 4)

### 3. Setup/registro dos webhooks
- **Opções:** script automatizado idempotente / manual na UI
- **Escolha:** **script automatizado idempotente** (`npm run setup:webhooks` via APIs; segredos no `.env`)

### 4. Framework do servidor HTTP
- **Opções:** node:http nativo / Fastify / Express
- **Escolha:** **node:http nativo (zero deps)** — alinha com o projeto standalone; controle do raw body para HMAC

### 5. Ingress (input adicional do usuário: "use o smee.io")
- **Escolha:** ingress via **smee.io** — smee-client no VPS encaminha pro servidor local; dispensa HTTPS/domínio/TLS público inbound
- **Caveat:** smee.io é dev/best-effort; Phase 4 pode reavaliar reverse proxy próprio; HMAC mitiga canal público

## Decisões travadas antes da discussão (carregadas)
- Gatilho por webhook (não polling); VPS próprio; batch `npm start` mantido como fallback; reusa `processTask`; validação HMAC obrigatória.

## Deferred
- Phase 4: autostart, monitoring, runbook, resiliência de processo.
- Verificação ao vivo da capa de Reels (pendente da Phase 2; não bloqueia).

## Claude's Discretion
- Estrutura de arquivos do servidor, health check, store de dedup, porta via config.
