# Evidências e limites de validação — Consulta Veicular 360

## O que a CI comprova
- Prévia HTTP no Render: rotas públicas e bloqueio de arquivos internos.
- Análise estática do código real: presença de contratos de checkout, webhook, comunicação comercial e sintaxe JavaScript inline.
- Fluxo de compra fictício: pacote, valor, saldo e consumo de créditos, sem cobranças.
- PostgreSQL descartável no GitHub Actions: transações SQL fictícias com tabelas mínimas, saldo, rollback, repetição e concorrência de confirmações.

## O que NÃO foi comprovado
- O teste PostgreSQL reproduz a lógica de crédito em código de teste; **não executa** a função `creditPaidPayment` real do `server.js`.
- O teste não executa o webhook HTTP real nem confirma uma cobrança com a Woovi/OpenPix.
- O banco gratuito do Render foi criado, mas o esquema `dev-preview/test-db-schema.sql` **não foi aplicado** nele.
- Não foi testado backup/restauração do banco de produção.
- Não foi concluído teste manual da interface real em navegador móvel/desktop.
- Não foi confirmada documentalmente a identidade comercial, cobertura de fontes ou políticas.
- A prévia usa páginas próprias e não substitui o aplicativo real.

## Critérios para liberar produção
1. Verificar identidade, CNPJ, contato, políticas, preços e cobertura com fontes verificáveis.
2. Confirmar backup restaurável e plano de rollback.
3. Testar o `server.js` real em ambiente isolado com Woovi simulada, PostgreSQL de teste e credenciais fictícias.
4. Testar visualmente as jornadas reais em celular e desktop.
5. Revisar segurança, autorizar merge e monitorar o deploy.
6. Não prometer aprovação do Google Ads.

Nenhum teste descrito aqui autoriza sozinho publicação automática.
