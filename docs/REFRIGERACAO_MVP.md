# Luiz Miguel — App de Refrigeração (MVP)

## Origem

Esta branch deriva do OficinaAPP, mas o produto de refrigeração NÃO deve alterar a branch `main` da oficina.

A base atual é standalone/PWA + Supabase. Dolibarr foi apenas referência histórica e não é dependência do projeto.

## Objetivo

Transformar o fluxo automotivo em um prontuário técnico por cliente e equipamento:

Cliente -> Local -> Equipamento -> OS -> Diagnóstico -> Orçamento -> Aprovação -> Execução -> Fotos -> Assinatura -> Cobrança/Histórico

## O que reaproveitar

- autenticação e perfis;
- clientes;
- ordens de serviço;
- orçamento versionado;
- aprovação por link;
- assinatura;
- financeiro/recebíveis;
- catálogo de serviços e materiais;
- fotos/evidências;
- trilha de atividade;
- PWA mobile-first;
- Kanban operacional.

## O que remover do fluxo

- veículo, placa, chassi e quilometragem;
- vistoria automotiva de entrada e saída;
- quatro fotos obrigatórias do veículo;
- mapa de avarias;
- nomenclaturas específicas de oficina mecânica.

Fotos continuam existindo, mas como evidências livres do atendimento: antes, durante, depois, instalação, equipamento, etiqueta/serial e outras.

## Entidades do domínio

### customers
Reaproveitar. Acrescentar endereço/local quando necessário.

### customer_sites
Um cliente pode ter um ou mais locais.

Campos mínimos:
- id
- customer_id
- name
- address
- notes

### equipments
Substitui o conceito de veículo.

Campos mínimos:
- id
- customer_id
- site_id opcional
- type
- environment
- brand
- model
- serial_number
- capacity
- voltage
- refrigerant
- install_date
- notes
- active

Tipos iniciais:
- split
- janela
- cassete
- piso-teto
- geladeira
- freezer
- expositor
- balcão refrigerado
- câmara fria
- outro

### work_orders
Reaproveitar com vínculo a `equipment_id` em vez de `vehicle_id`.

Campos úteis:
- complaint
- diagnosis
- service_report
- status
- scheduled_at
- forecast_at
- assigned_to
- created_by
- closed_at

### service_media
Fotos/evidências da OS.

Campos:
- work_order_id
- phase: before | during | after | equipment | label | other
- storage_path
- caption
- created_at
- created_by

Nenhuma foto deve ser obrigatória no MVP.

### measurements
Opcional por OS:
- tensão
- corrente
- temperatura insuflamento
- temperatura retorno
- pressão baixa
- pressão alta
- observação livre

As medições não devem bloquear o fechamento.

### maintenance_plan
Para retorno/preventiva:
- equipment_id
- interval_months
- next_due_at
- notes
- active

## Fluxo MVP do técnico

1. Selecionar/criar cliente.
2. Selecionar/criar equipamento.
3. Informar problema relatado.
4. Abrir OS.
5. Registrar diagnóstico.
6. Adicionar serviço/material.
7. Adicionar fotos opcionais.
8. Definir valor/orçamento.
9. Aprovação/assinatura do cliente.
10. Registrar pagamento ou deixar como faturado/crediário.
11. Finalizar OS.
12. Histórico aparece no equipamento e no cliente.

## Tela principal do cliente

Cliente
- dados e contatos
- locais
- equipamentos
- OS abertas
- histórico completo
- valores/cobranças
- próximas preventivas

## Tela do equipamento

Cabeçalho:
- tipo + marca/modelo
- ambiente
- capacidade
- refrigerante
- tensão
- serial

Timeline:
- data
- OS
- diagnóstico
- serviço
- fotos
- materiais
- valor
- assinatura
- pagamento
- próxima preventiva

## Busca

Pesquisar por:
- cliente
- telefone
- endereço/local
- equipamento
- marca/modelo
- serial
- número da OS

## Segurança / separação

A adaptação não deve reutilizar o banco de produção da oficina. O app de refrigeração deve usar projeto Supabase/configuração próprios antes de qualquer teste com dados reais.

Nenhuma migration desta branch deve ser aplicada automaticamente no banco da oficina.

## Fases

### Fase 1 — demo funcional
- branding Luiz Miguel
- clientes
- equipamentos
- OS sem vistoria automotiva
- fotos opcionais
- histórico visual

### Fase 2 — backend
- schema próprio
- Storage
- persistência
- login
- RBAC
- orçamento/aprovação/assinatura

### Fase 3 — financeiro e recorrência
- cobrança/faturado
- recebíveis
- preventiva
- QR Code por equipamento
- WhatsApp/avisos
