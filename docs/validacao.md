# Testes

O projeto usa Vitest para verificar cálculos, regras financeiras, comunicação com o servidor e acesso às abas de dados.

Com Node.js 24 e as dependências instaladas:

```bash
npm test
```

## Áreas verificadas

| Área | Comportamentos |
| --- | --- |
| Cálculos | Centavos inteiros, datas, saldos, períodos e parcelas. |
| Regras financeiras | Criação e edição, pagamento junto à previsão em um único comando, vínculos do planejamento e preservação do histórico. |
| Cópias de segurança | Formato, valores e referências antes da restauração. |
| Repositório de planilha | Sessões, revisões, confirmação de versões, reenvio de comandos e cache de leituras restrito à requisição. |
| Comunicação | Primeiro acesso, recuperação de sessão, confirmação lenta de gravação e reenvio após prazo esgotado sem duplicação. |

Os testes locais usam substitutos dos serviços do Google. Eles permitem verificar as regras e o comportamento do código, mas não representam uma execução real na conta Google nem uma implantação publicada.

## Compilação

```bash
npm run build
```

A compilação verifica os tipos TypeScript e gera `apps-script/Code.gs`, `apps-script/Index.html` e `apps-script/appsscript.json`. A interface e seus estilos são incluídos no HTML, sem depender de CDN. O servidor usa sintaxe ES2018, e a compilação rejeita literais e chamadas BigInt para evitar incompatibilidade com o editor do Apps Script.

A execução completa deve ser feita no Apps Script, com a planilha configurada. As instruções estão no [guia de publicação](publicacao.md).
