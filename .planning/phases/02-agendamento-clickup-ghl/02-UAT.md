---
status: testing
phase: 02-agendamento-clickup-ghl
source: [02-VERIFICATION.md]
started: 2026-06-22
updated: 2026-06-22
---

## Current Test

number: 1
name: Validação dos UUIDs de custom field do ClickUp contra a lista Auton ao vivo
expected: |
  Cada CU_FIELD_* no .env corresponde ao UUID do campo de mesmo nome na lista
  "Agendamentos & Publicações" (901327135553, team Auton). Nenhum mismatch — caso
  contrário o pipeline lê null silenciosamente ou grava no campo errado.
awaiting: user response

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
result: [pending]

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
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
