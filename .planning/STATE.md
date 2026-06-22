---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in-progress
stopped_at: Phase 02 Plan 03 — Wave 2 (carousel + error write-back) — ready to start
last_updated: "2026-06-22T19:23:00Z"
last_activity: 2026-06-22 -- Phase 02 Plan 02 complete; core pipeline 56/56 tests GREEN; batch ClickUp→GHL running
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 5
  completed_plans: 4
  percent: 53
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** Um post marcado "a agendar" no ClickUp aparece agendado no GHL para o Instagram, e quando publica o ClickUp reflete sozinho — sem cópia manual entre as ferramentas.
**Current focus:** Phase 02 — agendamento-clickup-ghl

## Current Position

Phase: 02 (agendamento-clickup-ghl) — IN PROGRESS
Plan: 3 of 3 (02-01 + 02-02 complete; 02-03 Wave 2 is next)
Status: Active — ready to execute 02-03-PLAN.md
Last activity: 2026-06-22 -- Plan 02-02 complete (core pipeline ponta-a-ponta; 56/56 tests GREEN)

Progress: [█████░░░░░] 53%

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

Last session: 2026-06-22T19:23:00Z
Stopped at: Completed 02-02-PLAN.md — ready to start 02-03-PLAN.md (Wave 2: carousel + error write-back)
Resume file: .planning/phases/02-agendamento-clickup-ghl/02-03-PLAN.md
