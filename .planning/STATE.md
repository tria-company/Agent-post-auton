---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: awaiting-checkpoint
stopped_at: "Phase 03-04 — Task 3 live checkpoint (Tasks 1+2 committed; awaiting operator VPS smoke)"
last_updated: "2026-06-23T01:00:00Z"
last_activity: "2026-06-23 -- Phase 03-04 Tasks 1+2 DONE: poller wired (84a1480) + setup-webhooks+Caddyfile+deploy README (13acdfd); stopped at live smoke checkpoint"
progress:
  total_phases: 4
  completed_phases: 2
  total_plans: 9
  completed_plans: 8
  percent: 78
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-06-22)

**Core value:** Um post marcado "a agendar" no ClickUp aparece agendado no GHL para o Instagram, e quando publica o ClickUp reflete sozinho — sem cópia manual entre as ferramentas.
**Current focus:** Phase 03 — webhooks-bidirecionais-clickup-ghl

## Current Position

Phase: 03 (webhooks-bidirecionais-clickup-ghl) — AWAITING CHECKPOINT
Plan: 4 of 4 (03-04 Tasks 1+2 DONE — stopped at live smoke checkpoint)
Status: Awaiting operator live smoke on VPS — Tasks 1+2 committed (poller wired, setup:webhooks + Caddyfile + deploy README); continuation agent writes SUMMARY after smoke resolves
Last activity: 2026-06-23 -- Phase 03-04 Tasks 1+2 DONE: poller wired (84a1480) + setup-webhooks+Caddyfile+deploy README (13acdfd)

Progress: [████████░░] 78%

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
| Phase 03-webhooks-bidirecionais-clickup-ghl P01 | ~60min+human | 3 tasks | 6 files |
| Phase 03-webhooks-bidirecionais-clickup-ghl P02 | ~12min | 3 tasks | 6 files |
| Phase 03-webhooks-bidirecionais-clickup-ghl P03 | ~25min | 2 tasks | 2 files |
| Phase 03-webhooks-bidirecionais-clickup-ghl P04 | ~25min | 2 tasks | 7 files | (partial — awaiting live checkpoint)

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
- [Phase 03-01 OQ1]: GHL GET /posts/:id response wrapper is results.post (same as createPost — Pitfall 7 generalization)
- [Phase 03-01 OQ1]: Confirmed status field: results.post.status (string, observed 'scheduled'); published/failed values not yet observed
- [Phase 03-01 OQ1]: Primary published signal: results.post.publishedAt (null → ISO timestamp) — prefer over status string alone
- [Phase 03-01 OQ1]: Deleted posts: results.post.deleted (bool) + deletedAt — poller must skip deleted posts
- [Phase 03-01 OQ1]: instagramPostDetails was {} on scheduled post — IG media id/permalink/failureReason unconfirmed until post published
- [Phase 03-01 OQ4]: ClickUp 'publicado' confirmed as published status — STATUS_PUBLICADO default correct, no override needed
- [Phase 03-02]: HMAC testability pattern: handler skips HMAC when neither webhookSecret nor skipSignatureVerify===false in deps (test mode); production always passes webhookSecret → HMAC always active
- [Phase 03-02]: loadFormatoOptionsMap() called per-webhook event (no cache); mirrors runSchedulerBatch bootstrap; acceptable within rate limits
- [Phase 03-02]: DedupeStore TTL 10min; key webhook_id:history_item_id (TRIG-04)
- [Phase 03-02]: POLLER_INTEGRATION_POINT comment in server/index.js for Plan 03-04 to add ghlStatusPoller setInterval
- [Phase 03-03]: SYNC-02 N/A documented — no GHL webhook, polling uses outbound GHL token
- [Phase 03-03]: Published signal: publishedAt != null (primary); failed: status=failed AND publishedAt==null
- [Phase 03-03]: On failure: clear CF_GHL_POST_ID ('') to enable retry (D-01)
- [Phase 03-03]: Dedup key: postId:published|failed; TTL 2h; module-level singleton
- [Phase 03-03]: IG fields defensive: instagramPostDetails.igMediaId first, then top-level candidates
- [Phase 03-03]: Test deviation: unique post IDs per test case required to avoid module-level dedup collision
- [Phase 03-04]: In-flight guard (_pollInFlight flag) prevents overlapping poll passes if a pass runs longer than POLL_INTERVAL_MS
- [Phase 03-04]: Initial poll pass runs immediately on server boot (no wait for first interval)
- [Phase 03-04]: PUBLIC_WEBHOOK_URL is optional in config (only setup:webhooks needs it; server does not require it)
- [Phase 03-04]: setup:webhooks idempotent: GET team webhooks → find by endpoint+list_id (Number() cast) → PUT if exists / POST if new
- [Phase 03-04]: Caddy reverse_proxy preserves raw body → HMAC works in production (D-08 confirmed; no smee.io)

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

Last session: 2026-06-23T01:00:00Z
Stopped at: Phase 03-04 Tasks 1+2 committed; stopped at live smoke checkpoint (Task 3 — blocking-human gate)
Resume file: .planning/phases/03-webhooks-bidirecionais-clickup-ghl/03-04-PLAN.md (continuation: Task 3 checkpoint + SUMMARY after smoke)
