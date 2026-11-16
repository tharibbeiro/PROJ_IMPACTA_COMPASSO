# Modelo de dados implementado

O esquema executável está em [`database/migrations/0001_initial.sql`](../database/migrations/0001_initial.sql). O mesmo modelo relacional é usado em SQLite local e Cloudflare D1.

| Tabela | Conteúdo e relações principais |
| --- | --- |
| `demo_sessions` | Sessão, hash da credencial, revisão e datas de criação/expiração. |
| `accounts` | Conta da sessão, nome, tipo e saldo inicial em centavos. |
| `categories` | Categoria da sessão, natureza de receita/despesa e cor. |
| `plans` | Regra de planejamento, tipo, valor, período, vencimento e referências opcionais a conta/categoria ou nome do cartão. |
| `entries` | Receita/despesa, conta, categoria, valor, ocorrência, vencimento, liquidação e versão. Pode se vincular a um plano e mês. |
| `plan_occurrences` | Situação de um plano no mês, lançamento vinculado e campos da referência histórica daquela ocorrência. |
| `preferences` | Nome de apresentação e opções da sessão. |
| `processed_commands` | Identificador da ação, revisão e resultado, usados para impedir execução duplicada. |

Os registros financeiros usam a chave composta `session_id + id`. As referências entre contas, categorias, lançamentos e planos incluem a sessão, impedindo vínculos entre demonstrações distintas.

## Integridade

- Valores de receitas, despesas e planos são centavos inteiros positivos; o saldo inicial pode ser negativo.
- Tipos, situações e dias de vencimento possuem restrições no SQL.
- Há um único lançamento vinculado por `sessão + plano + mês`.
- Há uma única ocorrência por `sessão + plano + mês` e um único vínculo de ocorrência para cada lançamento.
- Lançamento pago exige data de liquidação.
- Pagamento de fatura identificado deve ser uma despesa bancária sem vínculo com outro compromisso.
- A sessão limita o escopo das consultas e alterações.

O resultado de um comando é armazenado em JSON para idempotência; contas, lançamentos e planejamento possuem suas próprias colunas e tabelas. A aplicação não persiste o estado financeiro inteiro em uma coluna JSON.

## Exclusão e histórico

Excluir um lançamento o remove do estado persistido e desfaz seu vínculo mensal. Encerrar um plano conserva a regra e seu histórico, marcando a interrupção das previsões a partir do mês escolhido. Os dois comportamentos são distintos.

O primeiro registro ou conferência da ocorrência preserva sua referência de descrição, valor, vencimento e parcela. Um lançamento financeiro vinculado continua fornecendo seu valor real, sem ser reescrito por uma alteração posterior da previsão.

## Diagrama de classes

[Abrir SVG](diagramas/classes.svg) · [Abrir PNG](diagramas/classes.png) · [Editar PlantUML](diagramas/classes.puml)

As entidades são interfaces TypeScript com referências por identificador. `AcademicState` reúne as interfaces `FinanceSnapshot` e `PlanningSnapshot`. `FinanceService`, `D1FinanceRepository` e `NodeSqliteDatabase` são classes concretas. O diagrama omite alguns metadados e tipos auxiliares para manter a leitura.
