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

## Datas e confirmação no formulário

A previsão usa um único campo com dia, mês e ano. Essa data define o primeiro vencimento e o dia da repetição mensal; compromissos anuais repetem o mês e o dia nos anos seguintes. O último mês, quando informado, limita a repetição. Ao editar um item com dia 31 cujo primeiro mês tem menos dias, salvar sem alterar a data conserva a regra original do dia 31.

O formulário permite marcar **Já recebido**, **Já pago**, **Já conferido na fatura** ou **Valor já separado**, conforme o tipo. Pagamentos e recebimentos usam um campo de data completo, que não aceita data futura. Cartões e reservas usam somente a conferência e não criam um movimento bancário.

Na inclusão, a confirmação pertence ao mês da primeira data escolhida. Na edição, ela pertence ao mês consultado no painel, mesmo quando o recebimento ou pagamento ocorreu em outro mês. A interface pede uma confirmação adicional quando as datas pertencem a meses diferentes.

A previsão e uma eventual alteração da confirmação são enviadas em um único comando e gravadas juntas. Se qualquer validação falhar, nenhuma das duas alterações é aplicada. Ao editar somente a previsão, o estado do pagamento existente não é reenviado. Alterar explicitamente a data ou desmarcar um pagamento atualiza o lançamento vinculado, sem criar outro; seus valores, descrição e vencimento continuam preservados.

## Evitar duplicações

Cada item bancário tem no máximo um lançamento vinculado por mês. O usuário pode registrar um novo pagamento/recebimento ou escolher um lançamento compatível já existente. Vincular um lançamento pendente não o transforma em pago.

Um recebimento manual não é somado automaticamente à renda prevista, pois pode ser o próprio salário já cadastrado. O vínculo é explícito. O valor real vinculado fica separado do valor previsto: o orçamento usa a previsão e o saldo da conta usa o recebimento efetivo.

Por exemplo, uma receita prevista de R$ 200,00 pode estar vinculada a um recebimento de R$ 180,00. O Planejamento mantém R$ 200,00 no orçamento, enquanto o lançamento e o saldo consideram R$ 180,00. O vínculo também informa a situação e a data reais sem substituir o vencimento planejado.

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

A primeira confirmação/conferência guarda a previsão daquela competência, separada do lançamento real. Editar a regra atualiza nome, valor e vencimento da previsão no mês consultado e nos meses posteriores em que ela continuar ativa, inclusive quando já existe confirmação. A lista e os totais do Planejamento usam essa previsão atualizada. Os lançamentos vinculados mantêm seu valor, sua descrição, suas datas e sua situação até serem editados explicitamente.

As referências registradas nos meses anteriores ao mês consultado são preservadas. Se a nova regra deixar de vencer em uma competência já registrada, por mudança do início, término ou calendário anual, a referência histórica daquela competência também permanece. O servidor recebe o mês consultado em `referenceMonth`; chamadas que não informam esse campo usam o mês atual do servidor.

Registros antigos sem uma previsão ativa nem uma referência salva continuam visíveis pelos dados do lançamento vinculado. Encerrar interrompe novas previsões a partir do mês selecionado, incluindo esse mês, sem apagar as referências já registradas.

Marcar uma reserva como separada registra seu acompanhamento no planejamento, mas não cria despesa ou movimentação bancária.

Na edição da conta, o saldo inicial é a base do cálculo realizado. Alterá-lo não cria uma receita ou um ajuste financeiro independente.
