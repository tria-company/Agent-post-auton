# Deploy — Agent Posts Auton (Phase 3)

Passos mínimos para colocar o serviço no ar em um VPS com Caddy.
Endurecimento (PM2/systemd, monitoring, runbook completo) é escopo da Phase 4.

---

## Pré-requisitos

- VPS com IP público (Ubuntu 22.04 / Debian 12 ou similar)
- Node.js >= 24 (`node --version`)
- npm >= 10
- [Caddy](https://caddyserver.com/docs/install) instalado (`caddy version`)
- Domínio com registro A apontando para o IP do VPS

---

## 1. Instalar dependências

```bash
# No diretório raiz do projeto:
npm ci
```

---

## 2. Configurar o .env

Crie (ou edite) o arquivo `.env` na raiz do projeto. Nunca commitar este arquivo.

```dotenv
# ClickUp
CLICKUP_TOKEN=pk_...
CLICKUP_LIST_ID=901327135553
CLICKUP_WEBHOOK_SECRET=  # preencher APÓS rodar npm run setup:webhooks (passo 6)

# GHL
GHL_TOKEN=pit-...
GHL_LOCATION_ID=...
GHL_ACCOUNT_ID=...
GHL_USER_ID=...

# Custom fields ClickUp (UUIDs — obter no Plano 01)
CU_FIELD_LEGENDA=...
CU_FIELD_DATA_PUBLICACAO=...
CU_FIELD_IG_MEDIA_ID=...
CU_FIELD_LINK_PUBLICADO=...
CU_FIELD_ERRO_PUBLICACAO=...
CU_FIELD_ID_TASK_MAE=...
CU_FIELD_GHL_POST_ID=...
CU_FIELD_LINK_DO_POST=...
CU_FIELD_FORMATO=...

# Servidor webhook
WEBHOOK_PORT=3000
POLL_INTERVAL_MS=300000   # 5 minutos (ajustar para testes, ex.: 60000 = 1 min)
STATUS_PUBLICADO=publicado
STATUS_AGENDADO=agendado
STATUS_A_AGENDAR=a agendar

# URL pública do VPS (usada pelo setup:webhooks para registrar o webhook ClickUp)
PUBLIC_WEBHOOK_URL=https://<seu-dominio>/webhook/clickup

# Logging
LOG_LEVEL=info
```

---

## 3. Ajustar o Caddyfile

Edite `deploy/Caddyfile`:

```
<seu-dominio> {
    ...
}
```

Substitua `<seu-dominio>` pelo domínio real (ex.: `auton.meudominio.com.br`).

Copie o Caddyfile para o local esperado pelo Caddy (ou passe via `--config`):

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
```

---

## 4. Subir o servidor Node.js

```bash
npm run serve
```

Este comando inicia:
- Servidor HTTP na porta `WEBHOOK_PORT` (default: 3000)
- Loop de polling GHL a cada `POLL_INTERVAL_MS` ms no mesmo processo

Confirme que o servidor está respondendo localmente:

```bash
curl http://localhost:3000/health
# → {"status":"ok","ts":"..."}
```

---

## 5. Subir o Caddy

```bash
sudo caddy run --config /etc/caddy/Caddyfile
```

O Caddy obtém automaticamente o certificado TLS via Let's Encrypt.

Confirme o HTTPS externo:

```bash
curl https://<seu-dominio>/health
# → {"status":"ok","ts":"..."}
```

---

## 6. Registrar o webhook ClickUp (idempotente)

```bash
npm run setup:webhooks
```

Este script:
1. Lista os webhooks existentes do team `90132819023`
2. Se já existe um webhook para `PUBLIC_WEBHOOK_URL` + list `901327135553`: **atualiza** (nao duplica)
3. Se nao existe: **cria** e imprime o `CLICKUP_WEBHOOK_SECRET` na tela

**Ao criar pela primeira vez:** copie o secret exibido e adicione ao `.env`:

```dotenv
CLICKUP_WEBHOOK_SECRET=<valor-impresso-pelo-script>
```

Depois reinicie o servidor:

```bash
# CTRL+C para parar o serve, depois:
npm run serve
```

Rode o script uma segunda vez para confirmar idempotência (deve mostrar "Webhook atualizado" sem criar novo).

---

## 7. Smoke test rápido

```bash
# Saúde do servidor via HTTPS
curl https://<seu-dominio>/health

# No ClickUp: mover uma task com Data de publicação preenchida para o status "agendado"
# Observe nos logs do serve:
#   → webhook chegou (POST /webhook/clickup)
#   → X-Signature presente e HMAC validado
#   → processTask rodou e gravou GHL Post ID na task
```

---

## Notas importantes

- **HMAC ativo em produção**: o Caddy repassa o raw body intacto, então a verificação
  HMAC-SHA256 do ClickUp funciona. Nao use smee.io em producao (re-serializa o body, quebrando o HMAC — D-08).
- **Polling GHL**: o mesmo processo do servidor verifica a cada `POLL_INTERVAL_MS` se
  posts agendados foram publicados ou falharam, e atualiza o ClickUp automaticamente.
- **PM2/systemd** (para restart automático) é escopo da Phase 4.
- **Segredos**: nunca commitar `.env`. Nunca logar tokens ou o webhook secret.
