# Organização dos dados

A camada de dados é uma planilha Google Sheets criada pela configuração do aplicativo. Cada aba reúne um tipo de registro. A validação dos valores e dos vínculos é feita pelo código do servidor.

| Aba | Conteúdo |
| --- | --- |
| `Sessoes` | Identificação da sessão, hash do token, criação, expiração e ponteiro da versão confirmada. |
| `Contas` | Nome, tipo e saldo inicial das contas. |
| `Categorias` | Nome, natureza de receita/despesa e cor. |
| `Lancamentos` | Receitas/despesas, valor, conta, categoria, datas, situação e vínculo opcional com o planejamento. |
| `Planejamentos` | Tipo, descrição, valor previsto, período, vencimento e informações de parcelamento. |
| `RegistrosMensais` | Situação do compromisso em cada mês, lançamento vinculado e referência histórica da ocorrência. |
| `Preferencias` | Nome de apresentação e opções da sessão. |
| `Comandos` | Identificador da ação, resultado e referência da versão, para impedir execução duplicada. |

Os valores monetários são números inteiros de centavos. Datas financeiras usam o formato `AAAA-MM-DD`; criação e atualização usam instantes completos. As referências a contas, categorias e planos são identificadores verificados pelo servidor.

## Sessão e versões

As linhas de dados incluem a sessão, a revisão e um identificador da cópia de estado, chamado `snapshotId`. O repositório lê somente as linhas pertencentes à versão ativa daquela sessão.

A coluna `ponteiroCommit` da aba `Sessoes` contém a revisão e o `snapshotId` confirmados. Os registros financeiros continuam separados nas outras abas, em colunas próprias.

## Como uma gravação é confirmada

O servidor usa `ScriptLock` para coordenar operações simultâneas. Primeiro prepara uma nova cópia dos registros com outro `snapshotId`, incluindo o comando executado. Somente depois altera a célula que aponta para a versão ativa.

Se uma execução parar antes dessa confirmação, as linhas incompletas não passam a ser o estado atual. A consulta de comandos repetidos considera apenas as versões alcançáveis a partir do estado confirmado, ignorando gravações que ficaram sem confirmação.

Essa estratégia organiza as gravações nas abas e preserva a versão anterior até o novo estado ser confirmado. O projeto usa operações de planilha e validações em código, sem restrições de integridade fornecidas por um banco SQL.

## Integridade dos dados

- Receitas, despesas e planos usam valores positivos; o saldo inicial pode ser negativo.
- Uma conta, categoria ou plano referenciado precisa existir na mesma sessão.
- Cada compromisso pode ter apenas um lançamento vinculado no mês.
- Um lançamento pago precisa ter data de pagamento ou recebimento válida.
- Cartões e reservas usam conferências distintas de uma movimentação bancária.
- Um comando já confirmado devolve seu resultado anterior em vez de executar novamente a ação. Reutilizar seu identificador com dados diferentes é recusado.

## Exclusão e histórico

Excluir um lançamento o remove do estado ativo e desfaz seu vínculo mensal. Encerrar um plano conserva a regra e o histórico e interrompe novas previsões a partir do mês escolhido.

O primeiro registro ou conferência de uma ocorrência guarda sua referência de descrição, valor, vencimento e parcela. Um lançamento vinculado fornece o valor efetivamente registrado e não é reescrito por uma alteração posterior da previsão.

## Diagrama de classes

[Abrir SVG](diagramas/classes.svg) · [Abrir PNG](diagramas/classes.png) · [Editar PlantUML](diagramas/classes.puml)

As entidades são interfaces TypeScript. `FinanceService` aplica as regras e `SheetsFinanceRepository` acessa as abas. O diagrama apresenta os campos e vínculos principais do código.
