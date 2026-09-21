# Arquitetura-alvo — Oficina standalone

## Decisão

O produto final não depende de Dolibarr. A experiência anterior com Dolibarr permanece apenas como referência de requisitos, riscos e regras de negócio.

## Camadas

### Web / PWA
- interface mobile-first;
- recepção, OS, vistoria, orçamento, estoque, mecânico e entrega;
- suporte a operação em celular;
- futura fila offline para ações de campo, com reconciliação pelo backend.

### API própria
Responsável por:
- autenticação e sessões;
- RBAC/perfis;
- clientes e veículos;
- ciclo de vida da OS;
- fotos e evidências;
- orçamento versionado;
- aprovação do cliente;
- estoque/reservas/consumos;
- auditoria.

### Banco próprio
Entidades mínimas:
- users, roles, permissions;
- customers;
- vehicles;
- work_orders;
- inspections;
- inspection_media;
- estimates;
- estimate_versions;
- estimate_items;
- approvals;
- products;
- stock_movements;
- stock_reservations;
- audit_events.

## Invariantes importantes

1. Orçamento aprovado não pode ser alterado silenciosamente. Nova alteração cria nova revisão.
2. Aprovação precisa registrar a revisão exata aprovada.
3. Vistoria finalizada torna evidências imutáveis; correção gera nova evidência/evento.
4. Estoque é movimentado por lançamentos, nunca por sobrescrita arbitrária de saldo.
5. Reserva, consumo, liberação e entrega devem ser transacionais e resistentes a concorrência.
6. Perfil mecânico não recebe informação financeira sem permissão explícita.
7. Operações sensíveis geram auditoria com usuário, data, entidade, ação e contexto.
8. Toda entidade de negócio usa autorização por objeto, não apenas autorização de tela.

## Fluxo

Cliente -> Veículo -> OS -> Entrada -> Diagnóstico -> Orçamento -> Aprovação -> Peças -> Execução -> Saída -> Entrega

## Estado da demo

O site publicado no GitHub Pages é propositalmente estático. Ele valida navegação e UX. Dados de demonstração podem usar localStorage e não devem ser tratados como persistência real.
