# Testes

O projeto usa Vitest para verificar cálculos, regras de negócio, persistência e comunicação com a API.

```bash
npm test
```

## Cobertura

| Área | Comportamentos verificados |
| --- | --- |
| Cálculos | Valores em centavos, datas, saldos, períodos e parcelas. |
| Regras de negócio | Criação e edição de registros, pagamentos, vínculos do planejamento e preservação do histórico. |
| Cópias de segurança | Validação do formato, das referências e dos valores antes da restauração. |
| Persistência SQL | Gravação e leitura, isolamento por sessão, restrições e reenvio de comandos. |
| API e cache | Sessões, respostas dos comandos e atualização dos dados de consulta. |

Os testes do banco usam SQLite real. A suíte automatizada não substitui a conferência visual da interface em navegador.

A compilação verifica os tipos TypeScript e gera a interface e o servidor:

```bash
npm run build
```

A rotina em `.github/workflows/ci.yml` executa instalação, testes e compilação com Node.js 24.
