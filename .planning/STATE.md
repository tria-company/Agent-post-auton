---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: "Phase 03-01 checkpoint:human-verify — OQ1 smoke executado; aguardando shape real GHL /posts/:id e status publicado ClickUp (OQ4)"
last_updated: "2026-06-22T22:44:13Z"
last_activity: "2026-06-22 -- Phase 03-01 auto tasks complete (3/3 auto tasks, paused at checkpoint)"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 9
  completed_plans: 5
  percent: 50
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** Um post marcado "a agendar" no ClickUp aparece agendado no GHL para o Instagram, e quando publica o ClickUp reflete sozinho — sem cópia manual entre as ferramentas.
**Current focus:** Phase 03 — webhooks-bidirecionais-clickup-ghl

## Current Position

Phase: 03 (webhooks-bidirecionais-clickup-ghl) — EXECUTING
Plan: 1 of 4 (PAUSED AT CHECKPOINT — awaiting OQ1/OQ4 empirical data)
Status: Executing Phase 03 — checkpoint:human-verify
Last activity: 2026-06-22 -- Phase 03-01 auto tasks complete; smoke script ready for human run

Progress: [██████░░░░] 65%

## Performance Metrics

**Velocity:**

- Total plans completed: 4
- Average duration: ~57 min
- Total execution time: ~3.8 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| Phase 01 Fundacao | 2 | ~12min | ~6min |
| Phase 02 (so far) | 1 | ~120min | ~120min |

**Recent Trend:**

- Last 5 plans: Phase 01-P01 (8min), Phase 01-P02 (4min), Phase 02-P01 (120min)
- Trend: Phase 2 includes human checkpoints; pure automation tasks remain fast

*Updated after each plan completion*
| Phase 01 P01 | 8min | 3 tasks | 10 files |
| Phase 01-funda-o-config-clients-logging P02 | 4min | 3 tasks | 4 files |
| Phase 02-agendamento-clickup-ghl P01 | 120min | 3 tasks | 7 files |
| Phase 02-agendamento-clickup-ghl P02 | 90min | 3 tasks | 9 files |
| Phase 02-agendamento-clickup-ghl P03 | 15min | 2 tasks | 2 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [Setup]: Script Node.js standalone (vs n8n/Supabase) — mais controle
- [Setup]: Sync GHL→ClickUp via webhook (tempo real, sem polling)
- [Setup]: Gatilho de agendamento = status `a agendar` + `Data de publicação`
- [Setup]: Instagram só via GHL Social Planner, conta `auton.app`
- [Phase 02-01]: GHL createPost REQUIRES top-level userId field — 422 without it; use static GHL_USER_ID from .env
- [Phase 02-01]: createPost response shape: post id at results.post._id, NOT post._id (Pitfall 7 confirmed empirically)
- [Phase 02-01]: GHL token needs medias.write + medias.readonly + users.readonly scopes beyond social-media-posting.*
- [Phase 02-01]: Status names confirmed (a agendar / agendado) match defaults — no .env override needed
- [Phase 02-02]: GHL_USER_ID added to config EnvSchema (required); createPost payload MUST include userId
- [Phase 02-02]: CF_LEGENDA/CF_DATA_PUBLICACAO/CF_ID_TASK_MAE already in Phase 1 schema — no new env vars needed
- [Phase 02-02]: Formato orderindex from ClickUp dropdown; mapped via getListFields bootstrap each batch run
- [Phase 02-02]: Real Formato labels confirmed: Reels/Carrossel/Stories/Feed estático (Auton list 901327135553)
- [Phase 02-02]: GHL upload url (not fileId) used in createPost media[].url (A2 confirmed)
- [Phase 02-02]: Plano 02 handles single media (first file); Plano 03 extends to carousel
- [Phase 02-03]: Carousel uses type='post' + media[N] in numeric order — NEVER type='carousel' (Pitfall 1/A1 confirmed)
- [Phase 02-03]: Error write-back: CF_ERRO_PUBLICACAO with short safe message (AppError.message, <= 200 chars, no URL/token); NO status change on failure
- [Phase 02-03]: Stories/empty/unknown Formato rejected before any GHL call; date-past validation added (D-13/D-14)
- [Phase 02-03]: Batch isolation confirmed: per-task try/catch; failure → write-back + continue (D-18/SCH-07)
- [Phase 03-01]: D-08 revisado pós-pesquisa: ingress via Caddy direto (não smee.io); HMAC sempre ativo; SMEE_CHANNEL_ID/SKIP_SIGNATURE_VERIFY excluídos do config
- [Phase 03-01]: Config Phase 3: 4 campos adicionados (WEBHOOK_PORT/CLICKUP_WEBHOOK_SECRET/POLL_INTERVAL_MS/STATUS_PUBLICADO)
- [Phase 03-01]: ghl.getPost(postId) implementado — GET /social-media-posting/:locationId/posts/:id

### Pending Todos

[From .planning/todos/pending/ — ideas captured during sessions]

None yet.

### Blockers/Concerns

[Issues that affect future work]

- [Setup]: Keys ClickUp (`pk_…`) e GHL (`pit-…`) foram expostas em chat — rotacionar antes de produção
- [Phase 2]: Confirmar fonte real da mídia (task vs task mãe) e se o GHL exige upload prévio na media library
- [Phase 3]: Definir host público HTTPS para o webhook (VPS/Render/Railway/túnel) — a resolver no deploy

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Métricas | MET-01: coletar métricas do post em `monitorando` | v2 | Init |
| Métricas | MET-02: postar Primeiro comentário automático | v2 | Init |
| Multi-rede | MULTI-01: outras redes + múltiplas contas IG | v2 | Init |

## Session Continuity

Last session: 2026-06-22T22:44:13Z
Stopped at: Phase 03-01 checkpoint — OQ1 smoke ready, OQ4 pending (ClickUp status name)
Resume file: .planning/phases/03-webhooks-bidirecionais-clickup-ghl/03-01-PLAN.md (continue from checkpoint)
