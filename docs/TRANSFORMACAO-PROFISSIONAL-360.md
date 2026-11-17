# Transformação profissional — Consulta Veicular 360

## Política de isolamento
- Branch de trabalho: `dev/transformacao-profissional-360`; branch de produção `main` permanece intacta.
- Não conectar ambientes de preview ao banco PostgreSQL de produção.
- Não copiar `DATABASE_URL`, tokens Falcon/FonteData, segredos de pagamento, webhook ou credenciais de administração para previews.
- Em desenvolvimento, usar dados fictícios e mocks de consulta, cobrança e webhook; nenhuma cobrança real.
- Não alterar esquema do banco nem executar migrations sem backup verificado e plano de rollback.
- Revisar configuração de auto-deploy do Render antes de associar qualquer branch a um serviço.
- Nunca expor placas, consultas, tokens, dados de clientes ou segredos em logs ou artefatos públicos.

## Inventário inicial (análise parcial)
- Node.js + Express 5; PostgreSQL via `pg`.
- `server.js` concentra rotas, integração e regras comerciais.
- Frontend principal em `index.html` com estilos inline.
- Preloads de segurança, integração e branding no script `npm start`.
- Provedores mencionados no código: Falcon, FonteData, APIFull, CredPro.
- Pagamentos via Woovi/OpenPix; valores e pacotes configurados no servidor.
- Não presumir que todas as integrações estejam ativas no ambiente publicado.

## Etapas
1. Mapear rotas, dependências, páginas e fluxos críticos; identificar testes existentes.
2. Definir tokens de design, acessibilidade, navegação, responsividade e componentes reutilizáveis.
3. Renovar landing page com clareza de serviço privado, cobertura real dos dados, preço e condições antes do pagamento.
4. Renovar resultados e relatórios sem prometer dados indisponíveis.
5. Melhorar checkout e estados de erro/retorno usando mocks; validar idempotência e autenticação de webhooks.
6. Modernizar painel administrativo e controles de acesso, sem expor informações pessoais.
7. Adicionar testes automatizados, verificação de segurança, performance e SEO.
8. Validar em ambiente isolado; publicar apenas após revisão e autorização explícita.

## Critérios mínimos antes de produção
- Testes de regressão de consulta, pagamento, entrega e administração.
- Confirmação de backup/restauração e plano de reversão.
- Auditoria de transparência comercial e políticas (incluindo Google Ads).
- Nenhuma chamada real de API paga ou Pix nos testes de desenvolvimento.
