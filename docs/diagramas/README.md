# Diagramas do Compasso Acadêmico

Estes diagramas resumem o projeto implementado e mostram seus conceitos principais.

| Diagrama | O que mostra | Imagens |
| --- | --- | --- |
| Classes e dados | Contas, categorias, lançamentos, planejamento e o serviço que aplica as regras. | [SVG](classes.svg) · [PNG](classes.png) |
| Casos de uso | O que o usuário pode fazer na demonstração. | [SVG](casos-de-uso.svg) · [PNG](casos-de-uso.png) |
| Arquitetura | A comunicação entre interface, Google Apps Script e Google Sheets. | [SVG](arquitetura.svg) · [PNG](arquitetura.png) |

## Como ler o diagrama de classes

O título de cada bloco está em português. O nome entre parênteses é o identificador usado no código.

`Account`, `Category`, `Entry`, `PlanItem` e `PlanOccurrence` são **interfaces TypeScript**: descrevem o formato dos dados. Por isso, aparecem com `«interface»`. `FinanceService` é uma classe concreta; seu método `apply` recebe um estado e um comando, valida a operação e devolve o estado atualizado.

Os modelos de dados estão em `shared/domain/types.ts` e `shared/domain/planning-types.ts`. O serviço está em `backend/services/finance-service.ts` e é incluído no código executado pelo Apps Script.

Os números nas linhas indicam quantos registros podem estar relacionados:

- `1`: exatamente um.
- `0..1`: nenhum ou um.
- `0..*`: nenhum ou vários.

Cada lançamento pertence a uma conta e a uma categoria. Ele pode estar vinculado a um item do planejamento. Um item do planejamento pode ter vários lançamentos e registros mensais, ao longo dos meses. Cada registro mensal pode estar vinculado a um lançamento; cada lançamento pode ter, no máximo, um desses registros.

As linhas representam vínculos por identificador. Os respectivos campos de referência e outros detalhes foram omitidos dos blocos para facilitar a leitura. A seta tracejada indica que o serviço usa os dados para aplicar regras. Ele trata tanto lançamentos quanto planejamento.

### Campos mostrados

Os nomes dos campos foram mantidos iguais aos do código:

| Campo | Significado |
| --- | --- |
| `id` | Identificador do registro. |
| `name` / `description` | Nome / descrição. |
| `type` | Tipo da conta ou do item planejado. |
| `kind` | Receita (`income`) ou despesa (`expense`). |
| `openingBalanceCents` | Saldo inicial, em centavos. |
| `amountCents` | Valor, em centavos. |
| `occurredOn` / `dueOn` | Data do lançamento / vencimento. |
| `status` | Situação: pendente, pago/recebido ou conferido, conforme o registro. |
| `startMonth` / `month` | Mês inicial do planejamento / mês do registro. |
| `installmentNumber` / `totalInstallments` | Número da parcela / quantidade total de parcelas. |

O símbolo `?` indica um campo opcional. Uma conta pode ser bancária (`bank`) ou dinheiro em mãos (`cash`). No planejamento, `PlanType` diferencia salário, conta fixa, gasto no cartão, parcela, conta anual e reserva. As parcelas são representadas por itens `PlanItem`.

## Casos de uso e arquitetura

O ator **Usuário** representa quem testa a aplicação com dados fictícios. A sessão é individual e não exige login. “Gerenciar contas e categorias” resume criar/editar contas e cadastrar categorias. O planejamento reúne cadastro de compromissos, vínculo com lançamentos, conferência de itens do cartão e marcação de reservas.

As três camadas são:

1. **Interface:** telas React, HTML e CSS reunidos no arquivo `apps-script/Index.html`, servido pelo `HtmlService` do Apps Script.
2. **Aplicação:** funções do Google Apps Script que recebem as chamadas da interface, validam os dados e executam o `FinanceService`.
3. **Dados:** abas de uma planilha privada do Google Sheets, acessadas pelo código do servidor.

A interface usa `google.script.run` para chamar `compassoBootstrap`, `compassoCreateDemoSession` e `compassoCommand`. O acesso à planilha é organizado pelo `SheetsFinanceRepository`, implementado em `backend/repositories/sheets-finance-repository.ts`. O diagrama de classes mantém o foco nos cinco modelos de dados e no serviço financeiro.

As fontes TypeScript são compiladas para JavaScript. Os arquivos de publicação são `apps-script/Index.html`, `apps-script/Code.gs` e `apps-script/appsscript.json`.

A planilha guarda registros em abas com campos definidos, incluindo contas, categorias, lançamentos e planejamento. O usuário acessa a aplicação; o Apps Script lê e grava os dados na planilha. A aplicação precisa de conexão com a internet.

## Editar e gerar as imagens

Os arquivos `.puml` são as fontes editáveis do PlantUML. SVG e PNG foram gerados localmente com PlantUML e Graphviz. SVG permite ampliar sem perda de nitidez.

Com Java, Graphviz e o JAR do PlantUML instalados, execute a partir da raiz do projeto, ajustando o caminho do JAR:

```bash
java -jar /caminho/plantuml.jar -checkonly docs/diagramas/*.puml
java -jar /caminho/plantuml.jar -tsvg docs/diagramas/*.puml
java -jar /caminho/plantuml.jar -tpng docs/diagramas/*.puml
```

Em um terminal que não expanda `*.puml`, execute os comandos para cada arquivo.
