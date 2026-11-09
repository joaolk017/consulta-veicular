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

## Auditoria adicional — 09/11/2026
- GitHub Actions #84, commit `f8cf49b2e1268b03b6e1a86d8d4da72bee91963b`: execução concluída com sucesso.
- Preços da vitrine, quadro comparativo, descontos, valores unitários, catálogo de quatro produtos e resumo do Pix cobertos por testes estáticos.
- Auditoria textual da página principal: não foram encontradas as expressões exatas `100% seguro`, `instantâneo`, `ilimitado`, `todos os dados` ou `histórico completo`. Essa busca textual **não comprova** conformidade integral com as políticas do Google Ads.
- A funcionalidade de comparativo é anunciada e vinculada a `/minhas-consultas.html#comparar`; ainda é necessário teste funcional real e confirmação de que não cobra créditos extras.
- Persistem os bloqueios de backup restaurável, identidade comercial e teste ponta a ponta do checkout real.

## Teste de isolamento HTTP entre contas — 09/11/2026
- Execução GitHub Actions #95, commit `0712381162e6ee6afb9107c78290c27532ee2dc0`: etapa `Testar isolamento HTTP de relatórios entre duas contas` concluída com sucesso; a execução global ainda estava em andamento no momento do registro.
- `dev-preview/report-ownership-http.test.js` extrai a rota real `GET /api/minhas-consultas/:id` do `server.js` e a executa em Express com PostgreSQL 18 descartável.
- Sete cenários: leitura autorizada por A e B, tentativas cruzadas A→B e B→A retornando 404, ausência de token retornando 401, relatório pendente retornando 409 e ID inexistente retornando 404.
- Limitação: a verificação do token é simulada e não testa o aplicativo completo nem o gerenciamento real de sessões. Nenhuma conta ou dado de produção foi usado.

## Autenticação real e isolamento — 09/11/2026
- Execução GitHub Actions #98 reprovou porque o teste ainda utilizava quatro tokens fictícios após a adoção da assinatura real; corrigido no commit `51bda7c2f8575c6dbb02e1eba5aae5b159a0a1a5`.
- Execução #100: `preview-tests` aprovado e etapa `Testar isolamento HTTP de relatórios entre duas contas` aprovada no job PostgreSQL; execução global ainda em andamento quando consultada.
- O teste usa as funções reais `signAccountToken` e `verifyAccountToken` extraídas do `server.js`, chave HMAC exclusiva de teste e banco PostgreSQL 18 descartável.
- Oito cenários HTTP incluem titularidade de duas contas, token ausente, token adulterado, relatório pendente e ID inexistente.
- Não houve teste com clientes reais, nem verificação completa de navegação, recuperação de conta ou pagamento real.
