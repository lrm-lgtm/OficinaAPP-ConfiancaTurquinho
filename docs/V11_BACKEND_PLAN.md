# v11 — Backend real do OficinaAPP

Objetivo desta fase: sair da demonstração local e fechar um fluxo real persistente:

**Nova OS → 4 fotos → orçamento → link público → assinatura do cliente → aprovação volta para a OS → liberar execução.**

## O que já foi preparado

- Migration PostgreSQL/Supabase em `supabase/migrations/001_v11_core.sql`.
- Bucket privado `oficina-evidence` para fotos e assinaturas.
- Edge Function `public-budget` para ler um orçamento pelo token público, sem expor as tabelas.
- Edge Function `approve-budget` para validar token, salvar assinatura, gravar aprovação e mudar o status da OS.
- RLS ativado nas tabelas; o link do cliente não ganha acesso direto ao banco.

## Modelo principal

- `customers`
- `vehicles`
- `work_orders`
- `inspection_photos`
- `budget_revisions`
- `budget_items`
- `approval_tokens`
- `approvals`
- `activity_log`

## Segurança do link

O frontend público recebe somente um token aleatório. A consulta e a aprovação passam por Edge Functions com service role no servidor. A service role nunca fica no GitHub Pages.

A assinatura aprovada é salva no Storage e um SHA-256 é registrado em `approvals.signature_sha256`.

## Próximo passo de execução

1. Criar/conectar o projeto Supabase.
2. Rodar a migration.
3. Deploy das duas Edge Functions.
4. Criar primeiro usuário interno.
5. Substituir no frontend os arrays/localStorage por chamadas reais.
6. Teste físico no Android com uma OS real.

## Critério de v11 concluída

- Fechar/reabrir o navegador e a OS continuar disponível.
- Abrir a mesma OS em outro aparelho e ver os mesmos dados.
- Fotos realmente no Storage.
- Link de aprovação funcionar em outro celular.
- Assinatura aparecer na aprovação persistida.
- Status aprovado voltar para a OS interna sem depender do mesmo navegador.
