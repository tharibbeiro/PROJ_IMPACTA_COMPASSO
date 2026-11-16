# Banco SQL da versão acadêmica

A demonstração acadêmica usa **SQLite**. Em produção, a API recebe um banco Cloudflare D1 pela variável de ambiente `DB`; no desenvolvimento e nos testes, `NodeSqliteDatabase` adapta o módulo `node:sqlite` do Node.js 24 à mesma interface utilizada pelo repositório.

## Migração

O arquivo `migrations/0001_initial.sql` cria o esquema. Aplique-o ao preparar o ambiente, uma única vez; os controladores HTTP não executam criação de tabelas durante requisições. No ambiente local, a ferramenta de desenvolvimento aplica a migração antes de iniciar a API.

Para um banco D1 já criado, é possível aplicar o arquivo com a ferramenta oficial:

```bash
npx wrangler d1 execute NOME_DO_BANCO --remote --file database/migrations/0001_initial.sql
```

`NOME_DO_BANCO` precisa corresponder ao recurso configurado no ambiente. O comando acima é uma instrução de configuração, não foi executado automaticamente por este documento.

## Entidades persistidas

- `demo_sessions`: sessão isolada, hash do token, validade e revisão para controle de concorrência.
- `accounts`, `categories`, `entries`: contas, categorias e lançamentos com valores inteiros em centavos.
- `plans`, `plan_occurrences`: previsões e registros mensais, incluindo as colunas do retrato histórico de cada ocorrência.
- `preferences`: nome de exibição e preferências da demonstração.
- `processed_commands`: resultado de comandos já aplicados para impedir reexecuções.

Os dados financeiros ficam em colunas estruturadas. O estado completo não é armazenado como um único JSON. Apenas a resposta variável de um comando usa `result_json` na tabela de idempotência.

## Integridade e isolamento

Cada entidade pertence a uma sessão de demonstração. As chaves estrangeiras compostas incluem `session_id`; um lançamento de uma sessão não pode apontar para a conta, categoria ou plano de outra. Duas sessões podem reutilizar identificadores de exemplo sem compartilhar seus registros.

O token original não é gravado no banco: o controlador calcula seu hash e usa somente esse valor nas consultas. A sessão tem validade máxima de 14 dias; `cleanupExpired()` remove sessões vencidas e suas entidades por exclusão em cascata.

## Transação e concorrência

`D1FinanceRepository.commit()` calcula as diferenças entre os estados anterior e posterior. Todas as alterações são executadas em um único lote transacional:

1. A revisão da sessão avança somente se ainda for a revisão esperada.
2. Cada alteração verifica se o lote conquistou essa revisão e se o comando ainda não foi processado.
3. O resultado do comando é registrado por último, no mesmo lote.
4. Uma falha de integridade reverte também a revisão da sessão.

Uma revisão antiga produz `applied: false`, permitindo que o controlador recarregue os dados e trate o conflito. Repetir o mesmo identificador de comando não reaplica as movimentações. O lote usa parâmetros para todos os valores; nomes de tabelas e colunas são constantes internas do repositório.

## Limites desta demonstração

A sessão de demonstração é adequada à avaliação acadêmica e ao teste de dados fictícios. Ela não substitui autenticação de usuários e compartilhamento de finanças pessoais. A versão pessoal original permanece em um projeto separado.
