<!-- GSD:project-start source:PROJECT.md -->

## Project

**Agent Posts Auton — ClickUp → GHL Instagram Scheduler**

Um serviço Node.js que sincroniza posts de Instagram entre o ClickUp e o GoHighLevel (GHL). Ele lê os cards da lista de produção de conteúdo no ClickUp que estão prontos para agendar, cria os posts agendados no Social Planner do GHL (conta Instagram `auton.app`), e mantém o status sincronizado nos dois sentidos — quando o GHL publica ou muda o estado de um post, o card correspondente no ClickUp é atualizado automaticamente.

**Core Value:** Um post marcado como "a agendar" no ClickUp aparece agendado no GHL para o Instagram, e quando ele é publicado o ClickUp reflete isso sozinho — sem ninguém copiar nada à mão entre as duas ferramentas.

### Constraints

- **Tech stack**: Node.js standalone (decisão do usuário). Sem framework de UI. Provável uso de `node-fetch`/`undici` + um pequeno servidor HTTP (Express/Fastify) para receber o webhook do GHL.
- **Security**: tokens ClickUp (`pk_…`) e GHL (`pit-…`) e locationId ficam em `.env` (gitignored). **As keys foram expostas em chat — rotacionar antes de produção.**
- **Hospedagem**: o webhook do GHL exige endpoint público (HTTPS). Definir host (VPS, Render, Railway, túnel) — a resolver.
- **Sync GHL→ClickUp**: via **webhook do GHL** (tempo real), não polling (decisão do usuário).
- **Gatilho ClickUp→GHL**: status `a agendar` + `Data de publicação` preenchida.
- **Idempotência**: cada task guarda o id do post GHL para evitar duplicidade.
- **API limits**: respeitar rate limits do ClickUp (100 req/min por token) e do GHL.

<!-- GSD:project-end -->

<!-- GSD:stack-start source:STACK.md -->

## Technology Stack

Technology stack not yet documented. Will populate after codebase mapping or first phase.
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
