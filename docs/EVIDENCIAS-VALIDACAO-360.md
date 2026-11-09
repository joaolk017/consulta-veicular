# Evidências e limites de validação — Consulta Veicular 360

## O que a CI comprova
- Prévia HTTP no Render: rotas públicas e bloqueio de arquivos internos.
- Análise estática do código real: presença de contratos de checkout, webhook, comunicação comercial e sintaxe JavaScript inline.
- Fluxo de compra fictício: pacote, valor, saldo e consumo de créditos, sem cobranças.
- PostgreSQL descartável no GitHub Actions: transações SQL fictícias com tabelas mínimas, saldo, rollback, repetição e concorrência de confirmações.
- Função real `creditPaidPayment` extraída de `server.js`: quatro produtos, concorrência, idempotência e registro do funil, usando PostgreSQL descartável.
- Rota HTTP real de webhook extraída de `server.js`: valida segredo, ignora eventos inválidos, confirma status/valor com provedor simulado e credita uma única vez sob concorrência.

## O que NÃO foi comprovado
- O teste SQL inicial reproduz a lógica de crédito; o teste adicional executa a função real extraída de `server.js`, mas não inicializa o servidor completo.
- O teste adicional executa a rota HTTP real extraída do servidor, porém **não inicializa o aplicativo completo nem consulta a Woovi/OpenPix real**. O provedor é simulado.
- O banco gratuito do Render foi criado, mas o esquema `dev-preview/test-db-schema.sql` **não foi aplicado** nele.
- Não foi testado backup/restauração do banco de produção.
- Não foi concluído teste manual da interface real em navegador móvel/desktop.
- Não foi confirmada documentalmente a identidade comercial, cobertura de fontes ou políticas.
- A prévia usa páginas próprias e não substitui o aplicativo real.

## Critérios para liberar produção
1. Verificar identidade, CNPJ, contato, políticas, preços e cobertura com fontes verificáveis.
2. Confirmar backup restaurável e plano de rollback.
3. Testar a inicialização do `server.js` completo em ambiente isolado com Woovi simulada, PostgreSQL de teste e credenciais fictícias; as funções e rota já foram testadas isoladamente.
4. Testar visualmente as jornadas reais em celular e desktop.
5. Revisar segurança, autorizar merge e monitorar o deploy.
6. Não prometer aprovação do Google Ads.

Nenhum teste descrito aqui autoriza sozinho publicação automática.
