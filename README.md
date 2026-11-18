# Compasso — Controle Financeiro

Sistema web de controle financeiro pessoal desenvolvido como projeto acadêmico. A interface organiza receitas, despesas e compromissos mensais no celular e no computador. A aplicação é servida pelo **Google Apps Script**, com os dados em uma planilha **Google Sheets**.

**Aplicativo:** [Abrir demonstração do Compasso](https://script.google.com/macros/s/AKfycbx4a-Dm3k47NKpYvZJI2rAYjW3y-nrNimP6uPbyebMGfwHjn17QdVPJ9s1fhsYMLtQ/exec)

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

A demonstração usa dados fictícios e uma sessão separada para cada visitante. Para abrir a aplicação e salvar alterações, é necessário ter conexão com o Google. Os dados já carregados podem ser consultados na tela, mesmo se a conexão for interrompida.

## Tecnologias e três camadas

```text
React (interface) → Apps Script (regras) → Google Sheets (dados)
```

| Camada | Tecnologias e responsabilidade |
| --- | --- |
| Apresentação | React, TypeScript e CSS, reunidos em `Index.html` e servidos pelo `HtmlService`. |
| Aplicação | Regras em TypeScript compiladas para `Code.gs`, executadas pelo Apps Script V8. |
| Dados | Abas do Google Sheets para sessões, contas, categorias, lançamentos e planejamento. |

A interface chama o servidor por `google.script.run`. O servidor valida as ações e acessa a planilha privada. Os cálculos compartilhados ficam em `shared/domain/`.

## Usar no Google Apps Script

Os arquivos prontos estão na pasta [`apps-script/`](apps-script/):

- [`Code.gs`](apps-script/Code.gs): código do servidor.
- [`Index.html`](apps-script/Index.html): interface com seus scripts e estilos incluídos, sem CDN.
- [`appsscript.json`](apps-script/appsscript.json): configuração do projeto.

Não é necessário instalar Node.js para copiar esses arquivos para o editor do Google. Crie o projeto, copie os três arquivos, configure a planilha pelo procedimento do guia e publique como aplicativo da Web. O [guia de publicação](docs/publicacao.md) apresenta os passos completos.

## Organização do projeto

```text
apps-script/  Arquivos prontos para copiar no editor do Google
frontend/     Interface React e comunicação com o servidor
backend/      Funções Apps Script, serviços e acesso à planilha
database/     Estrutura das abas e estratégia de armazenamento
shared/       Tipos e cálculos compartilhados
scripts/      Compilação dos arquivos de publicação
docs/         Documentação e diagramas
```

## Testar e alterar o código-fonte

Para desenvolver a partir dos arquivos TypeScript, use **Node.js 24** e npm:

```bash
npm ci
npm test
npm run build
```

A compilação atualiza os três arquivos em `apps-script/`. Depois de alterar o código-fonte, copie a versão gerada para o Apps Script e atualize a implantação. A execução completa da aplicação acontece no ambiente do Google.

## Documentação e diagramas

- [Arquitetura](docs/arquitetura.md)
- [Organização dos dados](docs/modelo-dados.md)
- [Regras do planejamento](docs/planejamento.md)
- [Testes](docs/validacao.md)
- [Diagrama de classes](docs/diagramas/classes.svg) · [Fonte editável](docs/diagramas/classes.puml)
- [Diagrama de casos de uso](docs/diagramas/casos-de-uso.svg) · [Fonte editável](docs/diagramas/casos-de-uso.puml)
- [Visão das três camadas](docs/diagramas/arquitetura.svg)

## Escopo da versão

A aplicação registra pagamentos integrais. Conferir um item do cartão não equivale a pagar a fatura, e separar uma reserva não cria uma despesa de consumo. Integração bancária, importação de extratos, juros e pagamentos parciais não fazem parte desta versão.

As cópias JSON são próprias da demonstração acadêmica. A restauração substitui os dados da sessão depois de validar o arquivo.
