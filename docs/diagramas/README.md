# Diagramas do Compasso Acadêmico

Estes diagramas resumem o projeto implementado e mostram seus conceitos principais.

| Diagrama | O que mostra | Imagens |
| --- | --- | --- |
| Classes e dados | Contas, categorias, lançamentos, planejamento e o serviço que aplica as regras. | [SVG](classes.svg) · [PNG](classes.png) |
| Casos de uso | O que o usuário pode fazer na demonstração. | [SVG](casos-de-uso.svg) · [PNG](casos-de-uso.png) |
| Arquitetura | A comunicação entre interface, API e banco de dados. | [SVG](arquitetura.svg) · [PNG](arquitetura.png) |

## Como ler o diagrama de classes

O título de cada bloco está em português. O nome entre parênteses é o identificador usado no código.

`Account`, `Category`, `Entry`, `PlanItem` e `PlanOccurrence` são **interfaces TypeScript**: descrevem o formato dos dados. Por isso, aparecem com `«interface»`. `FinanceService` é uma classe concreta; seu método `apply` recebe um estado e um comando, valida a operação e devolve o estado atualizado.

Os modelos de dados estão em `shared/domain/types.ts` e `shared/domain/planning-types.ts`. O serviço está em `backend/services/finance-service.ts`.

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

A interface React envia pedidos à API TypeScript. A API valida as operações e usa o banco SQL para guardar os dados. O banco é SQLite no ambiente local e Cloudflare D1 na publicação. O navegador mantém uma cópia somente para consulta sem internet; alterações precisam da API.

## Editar e gerar as imagens

Os arquivos `.puml` são as fontes editáveis do PlantUML. SVG e PNG foram gerados localmente com PlantUML e Graphviz. SVG permite ampliar sem perda de nitidez.

Com Java, Graphviz e o JAR do PlantUML instalados, execute a partir da raiz do projeto, ajustando o caminho do JAR:

```bash
java -jar /caminho/plantuml.jar -checkonly docs/diagramas/*.puml
java -jar /caminho/plantuml.jar -tsvg docs/diagramas/*.puml
java -jar /caminho/plantuml.jar -tpng docs/diagramas/*.puml
```

Em um terminal que não expanda `*.puml`, execute os comandos para cada arquivo.
