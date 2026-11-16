# Compasso — Controle Financeiro

Sistema web de controle financeiro pessoal desenvolvido como projeto acadêmico. Permite organizar receitas, despesas e compromissos mensais em uma interface para celular e computador.

**Aplicativo:** [Acessar o Compasso](https://compasso-academico.tallflame4.chatgpt.site)

**Código-fonte:** [PROJ_IMPACTA_COMPASSO](https://github.com/tharibbeiro/PROJ_IMPACTA_COMPASSO)

## Objetivo

Facilitar o acompanhamento do dinheiro recebido e gasto, das contas a pagar e dos valores comprometidos nos próximos meses. O sistema separa o saldo realizado das contas do orçamento previsto, ajudando a entender quanto ainda está disponível.

## Funcionalidades

- Cadastro e edição de contas financeiras; cadastro de categorias.
- Registro, edição e exclusão de receitas e despesas.
- Controle de pagamentos, recebimentos e vencimentos.
- Painel financeiro e histórico mensal e anual.
- Planejamento de salário, adiantamento, contas fixas e despesas anuais.
- Acompanhamento de assinaturas, parcelas e reservas.
- Vinculação entre compromissos e lançamentos para evitar duplicações.
- Exportação em CSV e cópia de segurança em JSON, com restauração.

A demonstração começa com dados fictícios e mantém uma sessão separada para cada visitante. As alterações precisam de conexão com a API; o cache do navegador permite consultar os dados já carregados.

## Tecnologias

| Parte do sistema | Tecnologias |
| --- | --- |
| Interface | React, TypeScript, Vite e CSS |
| API e regras de negócio | TypeScript, Hono e Node.js 24 no ambiente local |
| Banco de dados | SQLite local e Cloudflare D1 na versão publicada |
| Cache de consulta | IndexedDB com Dexie |
| Testes | Vitest |

## Arquitetura em três camadas

```text
React (interface) → API TypeScript (regras) → SQLite / D1 (dados)
```

1. **Apresentação:** exibe telas e envia as ações pela API.
2. **Aplicação:** valida os dados e aplica as regras financeiras.
3. **Persistência:** armazena contas, lançamentos e planejamento em tabelas SQL.

O navegador não acessa o banco diretamente. O repositório no servidor concentra as consultas SQL, e os cálculos comuns ficam em `shared/domain/`.

## Organização do projeto

```text
frontend/   Interface, formulários e cliente HTTP
backend/    API, serviços e repositórios
database/   Migração e estrutura do banco
shared/     Tipos e cálculos compartilhados
docs/       Documentação e diagramas
```

## Executar localmente

Requisitos: **Node.js 24** e npm.

```bash
npm ci
npm run dev
```

Abra **http://localhost:3000**. A aplicação prepara o banco SQLite local em `.local/` durante a inicialização.

Para executar os testes e compilar o projeto:

```bash
npm test
npm run build
```

Para iniciar a versão compilada, execute `npm start`.

## Documentação e diagramas

- [Arquitetura](docs/arquitetura.md)
- [Modelo de dados](docs/modelo-dados.md)
- [Regras do planejamento](docs/planejamento.md)
- [Testes](docs/validacao.md)
- [Diagrama de classes](docs/diagramas/classes.svg) · [Fonte editável](docs/diagramas/classes.puml)
- [Diagrama de casos de uso](docs/diagramas/casos-de-uso.svg) · [Fonte editável](docs/diagramas/casos-de-uso.puml)
- [Visão das três camadas](docs/diagramas/arquitetura.svg)

## Escopo da versão

A aplicação registra pagamentos integrais. Conferir um item do cartão não equivale a pagar a fatura, e separar uma reserva não cria uma despesa de consumo. Integração bancária, importação de extratos, juros e pagamentos parciais não fazem parte desta versão.

As cópias JSON são próprias da demonstração acadêmica. A restauração substitui os dados da sessão depois de validar o arquivo.
