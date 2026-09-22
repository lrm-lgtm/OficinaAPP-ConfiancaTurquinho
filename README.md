# Auto Mecânica Confiança

Sistema próprio de gestão da **Auto Mecânica Confiança**, standalone e mobile-first.

> O Dolibarr foi usado como referência de fluxo e como experimento inicial. Ele **não é dependência** deste projeto e não faz parte da arquitetura-alvo.

## Estado atual

Esta primeira publicação contém uma **demo navegável** da experiência do produto para validar fluxo, nomenclatura e operação no celular antes de consolidar o backend.

Fluxo principal:

```
Cliente
  -> Veículo
  -> Ordem de Serviço
  -> Vistoria de entrada
  -> Diagnóstico
  -> Orçamento / revisão
  -> Aprovação do cliente
  -> Reserva / consumo de peças
  -> Execução do mecânico
  -> Vistoria de saída
  -> Entrega
```

## Princípios

- sistema próprio, sem dependência do core de outro ERP;
- PWA/mobile-first para balcão e mecânico;
- fotos/evidências como parte da OS;
- orçamento versionado e congelado após aprovação;
- estoque transacional e auditável;
- permissões por perfil;
- mecânico sem exposição de custos/preços quando não autorizado;
- trilha de auditoria para operações sensíveis;
- arquitetura preparada para API e banco próprios.

## Demo

A interface em `index.html` funciona sem backend e usa dados demonstrativos/localStorage.  
Ela existe para homologar **UX e fluxo**, não para representar persistência ou segurança de produção.

## Próxima camada

A implementação funcional será separada em:

- `web/`: PWA;
- `api/`: backend próprio;
- `db/`: schema/migrações;
- `docs/`: arquitetura, regras e homologação.

As regras úteis descobertas durante o protótipo Dolibarr serão migradas como requisitos e testes, e não como dependências de código.


## Identidade visual

A interface toma como referência a fachada real da oficina: base grafite/preta, tipografia clara/prateada, laranja/vermelho como acento principal e amarelo apenas para alertas/destaques. A marca visível do produto é **Auto Mecânica Confiança**.
