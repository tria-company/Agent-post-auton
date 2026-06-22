---
status: passed
phase: 02-agendamento-clickup-ghl
source: [02-VERIFICATION.md]
started: 2026-06-22
updated: 2026-06-22
---

## Current Test

(todos os testes concluídos — fase validada ao vivo em 2026-06-22)

## Tests

### 1. Validação dos UUIDs de custom field do ClickUp ao vivo
expected: |
  Os UUIDs pré-existentes da Fase 1 no .env (CU_FIELD_LEGENDA, CU_FIELD_DATA_PUBLICACAO,
  CU_FIELD_ERRO_PUBLICACAO, CU_FIELD_ID_TASK_MAE, CU_FIELD_IG_MEDIA_ID,
  CU_FIELD_LINK_PUBLICADO) batem com os campos reais da lista Auton 901327135553.
  Os testes unitários são mock-based e não cobrem isto. UUIDs de referência (ao vivo,
  coletados no Wave 0):
    Formato            = 24e0f126-589f-400c-a602-0e4abe19b809
    Data de publicação = d5107244-d044-4bd0-ae5c-c07f8a4f194e
    GHL Post ID        = 5e02e9dc-a7c9-4e0b-8ab2-bfcdac937ae3
    link do post       = 7e63be0c-5388-43d4-a7e8-ffd78f9ab1cd
    Legenda            = 91c07244-6ce6-42c7-bea2-ec49dba12fd3
    id da task mãe     = 3f37fbaa-93d0-4344-9fe2-f7c2c7320383
    Erro de publicação = 1137de68-9a0a-467e-8848-1d0e59844d5e
    IG Media ID        = cde1cd79-ecdc-43f7-b29e-7d0f42c2eed1
    Link publicado     = e98e36fe-1d17-48b7-a797-9ae9b1623d0f
result: passed — todos os 9 CU_FIELD_* do .env batem com os UUIDs reais da lista Auton 901327135553 (verificado 2026-06-22)

### 2. Execução end-to-end ao vivo (npm start)
expected: |
  Com uma task real em status `a agendar` + Data de publicação preenchida + link do post
  (zip MinIO) + Formato válido, rodar `npm start`:
  - a task transiciona para `agendado`
  - o campo GHL Post ID é preenchido com o post._id
  - um post agendado aparece no Social Planner da auton.app com legenda, mídia e horário corretos
  - (carrossel) um zip com N arquivos vira 1 post com as N mídias na ordem numérica
  - (erro) uma task com Formato='Stories'/data no passado/sem mídia preenche
    "Erro de publicação" e permanece em `a agendar`
result: |
  passed (2026-06-22) — validado ao vivo em produção. NOTA: durante a UAT o gatilho foi
  INVERTIDO por decisão do usuário (commits fb59e64/6673fc8/89d3d0e): o humano move a task
  para `agendado` (gatilho); sucesso mantém `agendado` + GHL Post ID + comentário; falha
  volta para `a agendar` + Erro de publicação + comentário; `publicado` é Phase 3.
  - SUCESSO: task 86aj5g8f2 (Carrossel, 10 imagens) → download+unzip MinIO → upload 1..10.png
    em ordem → createPost (type=post, mediaCount=10) → GHL Post ID `6a39a0be892064b3bddd4ece`
    gravado + comentário "✅ Agendado no GHL" + status mantido `agendado`.
  - FALHA: a mesma task, antes de ter Legenda/mídia, caiu em validação ("CF_LEGENDA/CF_LINK_DO_POST
    vazio") → voltou para `a agendar` + Erro de publicação + comentário "❌ Falha ao agendar".
  - Isolamento (D-18) e Formato real (Reels/Carrossel/Stories/Feed estático) confirmados em produção.

## Summary

total: 2
passed: 2
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
