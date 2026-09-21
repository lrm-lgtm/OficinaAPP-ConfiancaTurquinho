# Migração do protótipo Dolibarr para o sistema próprio

## O que manter

Aproveitar como regra e teste:
- fluxo de OS;
- vistoria fotográfica de entrada/saída;
- mapa/registro de avarias;
- integridade das evidências;
- orçamento com revisões;
- aprovação presencial/remota;
- congelamento após aprovação;
- reserva/consumo/liberação de peças;
- travas antes da entrega;
- perfil técnico sem exposição financeira;
- trilha de auditoria;
- correções de concorrência identificadas durante o hardening.

## O que remover

Não carregar para a arquitetura nova:
- modOficina;
- main.inc.php / bootstrap Dolibarr;
- DoliDB;
- societe;
- Product::correct_stock();
- permissões hasRight() do Dolibarr;
- tabelas, constantes, hooks e entidades internas do Dolibarr.

## Substituições

| Protótipo | Sistema próprio |
|---|---|
| Dolibarr user | users + roles/permissions |
| societe | customers |
| produto Dolibarr | products |
| estoque Dolibarr | stock_movements + stock_reservations |
| DoliDB | camada SQL/ORM própria |
| hasRight() | autorização RBAC + escopo por objeto |
| módulo externo | aplicação standalone |

## Estratégia

A migração deve ser feita por domínio, não por tradução linha-a-linha do PHP antigo. Primeiro congelamos regras e testes; depois implementamos o backend novo com essas invariantes.
