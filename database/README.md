# Persistência em Google Sheets

A demonstração acadêmica usa uma planilha privada do proprietário do Google Apps Script. `SheetsFinanceRepository`, em `backend/repositories/sheets-finance-repository.ts`, implementa a persistência por uma porta síncrona; `AppsScriptSheetPort` adapta essa porta ao serviço `SpreadsheetApp`. As regras financeiras continuam em `FinanceService`, sem depender da interface ou da planilha.

## Configuração pelo proprietário

Execute `configurarCompasso_` no editor do Apps Script. A função cria **Compasso — Demonstração**, prepara as oito abas e grava o identificador na propriedade de script `COMPASSO_SPREADSHEET_ID`. Executá-la novamente reutiliza a planilha existente e verifica seus cabeçalhos. O código não compartilha a planilha nem recebe identificadores de planilha do navegador.

Os visitantes acessam somente as funções públicas `compassoBootstrap`, `compassoCreateDemoSession` e `compassoCommand`. A configuração termina em `_`, permanecendo privada para `google.script.run`.

## Abas e colunas

As seis abas de entidades começam com `sessionId`, `snapshotId` e `revision`. Cada registro financeiro ocupa uma linha com campos próprios; o estado completo não fica dentro de uma célula JSON.

| Aba | Conteúdo das demais colunas |
| --- | --- |
| `Contas` | `id`, nome, tipo, saldo inicial em centavos e data de criação. |
| `Categorias` | `id`, nome, natureza e cor. |
| `Lancamentos` | `id`, descrição, natureza, centavos, categoria, conta, ocorrência, vencimento, situação, pagamento, versão e metadados de vínculo com o planejamento/fatura. |
| `Planejamentos` | `id`, tipo, descrição, centavos, mês inicial/final, dia de vencimento, conta/categoria/cartão, parcela atual/total, versão e encerramento. |
| `RegistrosMensais` | `id`, plano, mês, situação, lançamento vinculado e colunas separadas para o retrato histórico: tipo, descrição, valor, vencimento, cartão, parcela, quantidade restante, saldo futuro e último vencimento. |
| `Preferencias` | Identificador, nome de exibição e modo da demonstração. |
| `Sessoes` | `id`, `tokenHash`, `ponteiroCommit`, `createdAt`, `expiresAt`, `status`. |
| `Comandos` | `sessionId`, `snapshotId`, `revision`, `parentSnapshotId`, `commandId`, `resultJson`, `createdAt`, `fingerprint`. |

Os cabeçalhos exatos estão na constante `SHEET_HEADERS`. Identificadores e datas ISO permanecem texto; valores monetários são inteiros em centavos. Somente o pequeno ponteiro `{revision,snapshotId}` e o resultado variável de um comando usam JSON em células próprias.

## Publicação consistente de uma revisão

O Google Sheets não oferece uma transação entre todas as abas. A aplicação publica snapshots completos usando um **ponteiro de commit**, sempre sob `LockService.getScriptLock()`:

1. O controlador autentica a sessão e carrega somente seu snapshot ativo.
2. `FinanceService` valida o comando e produz uma nova cópia do estado, sem alterar a cópia anterior.
3. O repositório cria um `snapshotId` exclusivo para a tentativa e acrescenta as linhas de todas as entidades com a nova revisão.
4. Acrescenta o comando, seu resultado, a assinatura do conteúdo e o snapshot anterior.
5. `SpreadsheetApp.flush()` conclui as gravações preparatórias.
6. Uma única célula da linha da sessão, `ponteiroCommit`, passa a identificar a revisão e o novo snapshot.
7. Outro `flush()` confirma essa publicação antes da resposta e da liberação do lock.

Leituras filtram simultaneamente a sessão, o snapshot e a revisão ativos. Uma falha antes da publicação deixa linhas preparatórias invisíveis à aplicação. A próxima tentativa recebe outro `snapshotId`; linhas incompletas da tentativa anterior não se misturam à nova revisão.

Uma falha depois da troca do ponteiro pode deixar o comando aplicado sem confirmação no navegador. A resposta é um erro, e o cliente deve repetir **o mesmo identificador de comando**. A consulta de idempotência retorna o resultado já publicado, sem reaplicar o movimento. O sistema não promete reverter uma gravação já publicada.

O lock coordena as execuções deste script. Alterações manuais na planilha não participam desse protocolo; preserve os cabeçalhos e use a aplicação para editar os registros.

## Idempotência e tentativas interrompidas

`Comandos` liga cada snapshot ao anterior. O repositório percorre a cadeia alcançável a partir do ponteiro ativo e reconhece apenas comandos efetivamente publicados. Registros de tentativas interrompidas fora dessa cadeia são ignorados.

O controlador calcula SHA-256 de uma representação canônica de `type` e `payload`. Repetir o mesmo `commandId` com o mesmo conteúdo retorna o resultado anterior; usar esse identificador com outro conteúdo produz conflito `409`. A revisão também é conferida antes da publicação.

## Sessões e isolamento

O servidor gera um token aleatório para cada visitante. Apenas seu hash SHA-256 é persistido. As funções públicas não aceitam um `sessionId` para consultar outro visitante e não oferecem uma operação para listar sessões.

A validade é de **sete dias**, verificada em cada acesso. Reiniciar a demonstração cria e grava a nova sessão antes de invalidar a anterior autenticada. Um token anterior inválido ou vencido produz `401`; a recuperação no navegador solicita então uma sessão nova sem esse token.

Na criação de sessão, a limpeza remove linhas pertencentes a sessões vencidas/invalidadas e a criações interrompidas sem registro final em `Sessoes`. As exclusões ocorrem de baixo para cima, por identificador, mantendo as sessões ativas. Uma limpeza parcialmente interrompida não torna dados expirados acessíveis e pode ser repetida.

## Texto literal e limites da demonstração

O adaptador formata as células como texto antes de escrever e escapa entradas que começam com operadores de fórmula ou apóstrofo, inclusive após espaços. Isso preserva descrições como `=SUM(...)` como texto, sem executá-las, e evita conversão automática de datas. Números e booleanos continuam valores tipados. Cabeçalhos modificados ou valores incompatíveis interrompem a operação com erro.

Para manter o uso adequado à escala acadêmica gratuita:

- Até **50 sessões ativas** e **50.000 linhas de dados**, incluindo versões e tentativas preparadas.
- Por estado: até 20 contas, 100 categorias, 1.000 lançamentos, 1.000 planejamentos e 12.000 registros mensais.
- Cópias de segurança acadêmicas v1/v2 de até 2 MB; backups do aplicativo pessoal são recusados.

Versões anteriores e linhas preparatórias de sessões ainda ativas podem permanecer até a limpeza por validade. Esses limites não substituem as cotas oficiais do Google Apps Script/Sheets, que também se aplicam.

## Verificação

Os testes usam portas e serviços Google simulados para verificar isolamento, fórmulas literais, datas, expiração, fingerprint, falhas de staging/flush, ponteiro de publicação, limpeza e repetição segura. A execução no Google depende da configuração e autorização do proprietário; os testes locais não constituem uma implantação no Google.
