# Publicar no Google Apps Script

Os arquivos de `apps-script/` já estão compilados e podem ser copiados diretamente para o editor. Node.js é necessário somente para modificar o código-fonte e gerar novamente esses arquivos.

## Criar o projeto

1. Acesse [Google Apps Script](https://script.google.com/) com sua conta Google e crie um projeto.
2. No arquivo `Code.gs`, substitua o conteúdo pelo arquivo [`apps-script/Code.gs`](../apps-script/Code.gs) deste repositório.
3. Adicione um arquivo HTML com o nome **Index** e copie o conteúdo de [`apps-script/Index.html`](../apps-script/Index.html).
4. Nas configurações do projeto, habilite a exibição de `appsscript.json` no editor. Substitua seu conteúdo por [`apps-script/appsscript.json`](../apps-script/appsscript.json).
5. Salve o projeto.

## Configurar os dados

A função `configurarCompasso_` termina com sublinhado para impedir sua chamada pela interface pública. Esse nome também fica oculto na lista de execução do editor.

Antes da primeira implantação, acrescente temporariamente esta função ao final de `Code.gs`, fora das demais funções:

```javascript
function prepararCompasso() {
  const resultado = JSON.parse(configurarCompasso_());
  if (!resultado.configured) {
    throw new Error(resultado.error || 'Não foi possível configurar a planilha.');
  }
  console.log('Planilha configurada: ' + resultado.spreadsheetUrl);
}
```

1. Salve o arquivo com **Ctrl + S**.
2. Na lista de funções da barra superior, selecione **`prepararCompasso`**.
3. Clique em **Executar** e autorize o acesso às planilhas pela conta proprietária.
4. Confira o **Registro de execução**: a mensagem **Planilha configurada** inclui o endereço da planilha.
5. Depois do sucesso, apague somente a função temporária **`prepararCompasso`** e salve novamente, antes de publicar.

Mantenha a função original `configurarCompasso_` no código. A configuração cria a planilha de dados e guarda seu identificador nas propriedades do script. Executá-la novamente no mesmo projeto conserva a planilha configurada.

A ocultação de funções com sublinhado é descrita no [blog do Google Apps Script](https://googleappsscript.blogspot.com/2010/06/hiding-helper-functions.html), e a proteção contra chamadas da interface está documentada em [Comunicação cliente-servidor](https://developers.google.com/apps-script/guides/html/communication).

A planilha fica no Drive da conta que executou a configuração. Não é necessário torná-la pública para os visitantes usarem o aplicativo.

## Implantar o aplicativo

1. Selecione **Implantar → Nova implantação**.
2. Escolha **Aplicativo da Web** como tipo.
3. Em **Executar como**, escolha **Eu**, a conta que configurou a planilha.
4. Em acesso, escolha **Qualquer pessoa**, quando essa opção for permitida pela conta ou organização.
5. Confirme a implantação e use o endereço fornecido pelo Google, terminado em **`/exec`**.

As opções disponíveis dependem da conta e das políticas da organização. A implantação executada como proprietário permite que o servidor acesse a planilha privada com suas permissões. Consulte [Aplicativos da Web no Apps Script](https://developers.google.com/apps-script/guides/web?hl=pt-br).

O endereço de teste terminado em `/dev` é destinado a quem tem acesso de edição ao projeto. Para o uso publicado, utilize o endereço `/exec` gerado na implantação.

## Atualizar o código

Depois de alterar os arquivos TypeScript, execute `npm run build` e copie os três arquivos gerados novamente para o editor. Em **Implantar → Gerenciar implantações**, edite a implantação e selecione uma nova versão para disponibilizar as mudanças.

A configuração do projeto deve continuar apontando para a mesma planilha. Os dados são organizados pelo servidor; editar manualmente as abas de registros pode causar inconsistências.
