# Planejamento e movimentos reais

O planejamento mostra a destinação prevista da renda mensal. Os lançamentos registram receitas, despesas e sua liquidação. Nesta demonstração, o servidor Apps Script valida essas informações e as grava nas abas do Google Sheets. As alterações dependem de conexão; os dados já carregados podem ser consultados na tela.

## Tipos de item

| Tipo | Funcionamento |
| --- | --- |
| Receita prevista | Salário e adiantamento são itens separados quando representam recebimentos distintos. Registrar o recebimento cria ou liquida o lançamento vinculado. |
| Conta fixa | Compromisso mensal pago por uma conta, com categoria e vencimento. |
| Fixo no cartão | Assinatura mensal com nome do cartão; a marcação significa conferência na fatura. |
| Parcelamento | Valor de cada parcela, mês de referência, número atual `n` e total `N`. |
| Compromisso anual | Previsão somente no mês de vencimento, repetida nos anos seguintes até o término configurado. |
| Reserva | Destinação mensal do orçamento, sem ser despesa de consumo ou transferência automática. |

Quando o dia escolhido não existe no mês, o calendário usa o último dia real. Não há ajuste automático por feriado ou dia útil.

## Evitar duplicações

Cada item bancário tem no máximo um lançamento vinculado por mês. O usuário pode registrar um novo pagamento/recebimento ou escolher um lançamento compatível já existente. Vincular um lançamento pendente não o transforma em pago.

Um recebimento manual não é somado automaticamente à renda prevista, pois pode ser o próprio salário já cadastrado. O vínculo é explícito. O valor real vinculado substitui a previsão correspondente.

Se o pagamento ocorrer fora do mês de referência, o orçamento permanece no mês planejado, enquanto o caixa usa a data real informada. A interface pede confirmação dessa diferença.

## Orçamento disponível

```text
Receitas previstas
  − contas fixas e anuais do mês
  − assinaturas e parcelas do cartão
  − reservas
  − despesas variáveis registradas no mês
  = disponível no orçamento
```

Uma despesa já vinculada ao planejamento não entra novamente como variável. Pagar um compromisso não devolve seu valor ao orçamento daquele mês. O saldo realizado da conta é calculado separadamente.

## Parcelas e cartões

`n/N` representa a parcela que vence no mês inicial informado. O saldo futuro considera somente as parcelas posteriores ao mês consultado, e a data final é o vencimento previsto da última parcela.

**“Conferido na fatura” não representa pagamento.** Para registrar a saída bancária de uma fatura já integralmente prevista nos compromissos do cartão, use a opção **“Pagamento de fatura já previsto no Planejamento”** no lançamento. Ela mantém a saída no caixa e no histórico, excluindo-a dos gastos variáveis do orçamento.

Compras não previstas ainda precisam ser incluídas no orçamento. Essa marcação é manual e não oferece conciliação automática, juros, distribuição de pagamentos ou gestão de faturas parciais.

## Edição, encerramento e reservas

A primeira confirmação/conferência guarda uma referência do mês. Editar a regra ajusta previsões ainda não registradas e preserva as ocorrências anteriores. Encerrar interrompe novas previsões a partir do mês selecionado, incluindo esse mês.

Marcar uma reserva como separada registra seu acompanhamento no planejamento, mas não cria despesa ou movimentação bancária.

Na edição da conta, o saldo inicial é a base do cálculo realizado. Alterá-lo não cria uma receita ou um ajuste financeiro independente.
