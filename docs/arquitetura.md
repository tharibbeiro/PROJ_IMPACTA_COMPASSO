# Arquitetura

O Compasso está organizado em três camadas: apresentação, aplicação e persistência.

![Arquitetura em três camadas](diagramas/arquitetura.svg)

## Apresentação

`frontend/` contém a interface React, os formulários e o cliente HTTP. A interface mostra os dados e envia as alterações para a API.

O IndexedDB guarda um cache do estado recebido. Sem conexão, os dados já carregados podem ser consultados, mas as alterações dependem da resposta do servidor para serem confirmadas.

## Aplicação

`backend/` contém a API Hono, a sessão da demonstração e as regras de negócio. A API recebe o comando, identifica a sessão e carrega os dados pelo repositório.

A classe `FinanceService` valida valores, referências e versões. Seu método `apply` recebe o estado e um comando e devolve o estado atualizado e o resultado. A classe não depende de React, HTTP ou SQL, o que permite testar as regras separadamente.

`shared/domain/` reúne os tipos e cálculos usados pelo servidor e pela interface.

## Persistência

`D1FinanceRepository` implementa o contrato `FinanceRepository` e concentra as consultas SQL parametrizadas. A migração em `database/migrations/0001_initial.sql` define tabelas, índices e restrições.

Na versão publicada, o banco é Cloudflare D1. No desenvolvimento e nos testes, `NodeSqliteDatabase` adapta o SQLite do Node.js ao mesmo contrato de acesso usado pelo repositório.

## Fluxo de uma alteração

1. A interface envia `{ id, type, payload }` para `POST /api/commands`.
2. A API verifica a sessão e carrega o estado atual.
3. O serviço valida e aplica a ação financeira.
4. O repositório grava os dados e o resultado do comando em um lote transacional.
5. A API responde com `{ state, revision, result }`, e a interface atualiza o cache.

O identificador do comando evita executar o mesmo reenvio duas vezes. A revisão da sessão e as versões dos registros protegem alterações concorrentes.

## Sessões da demonstração

O primeiro acesso cria uma sessão anônima com dados fictícios. As tabelas financeiras são vinculadas à sessão, e a credencial é validada pelo servidor. Reiniciar a demonstração cria uma nova sessão.

## Endpoints

| Método e caminho | Função |
| --- | --- |
| `GET /api/health` | Verificar a aplicação e a conexão SQL. |
| `POST /api/demo-sessions` | Criar uma sessão com dados fictícios. |
| `GET /api/bootstrap` | Consultar os dados persistidos da sessão. |
| `POST /api/commands` | Executar uma ação financeira validada. |
