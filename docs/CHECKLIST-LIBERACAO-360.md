# Checklist de liberação — Consulta Veicular 360

## Regra principal
A prévia em `dev-preview/` não é o sistema de produção. Não copiar automaticamente a página de demonstração sobre `index.html` do site principal. A integração deve preservar contratos das rotas, sessões, créditos, pagamentos e webhooks.

## Condições obrigatórias antes de qualquer migração
- [ ] Backup verificável do banco de produção e procedimento de restauração documentado.
- [ ] Inventário das rotas, preloads e middlewares do `server.js`, incluindo autenticação e permissões.
- [ ] Contratos dos provedores de dados e cobertura real confirmados; nunca prometer dados ausentes.
- [ ] Preços e pacotes conferidos com o checkout efetivo.
- [ ] Identidade empresarial, contato, termos, privacidade, cancelamento e reembolso verificados.
- [ ] Testes de regressão de consulta, carteira, crédito, pagamento, webhook e painel admin em ambiente isolado.
- [ ] Nenhuma chave real, banco de produção, webhook de produção ou Pix real na prévia.
- [ ] Avaliação manual de segurança e fluxo de rollback.
- [ ] Teste ponta a ponta no navegador móvel e desktop.
- [ ] Aprovação do Google Ads **não é garantida** por alterações de texto ou visual.

## Ordem de integração recomendada
1. Extrair componentes de apresentação sem alterar APIs e regras de negócio.
2. Aplicar identidade visual e acessibilidade às telas existentes em branch isolada.
3. Incorporar avisos de cobertura e transparência com informações verificadas.
4. Revisar checkout preservando correlação, idempotência, webhook e crédito.
5. Atualizar o painel administrativo sem alterar o modelo de autorização.
6. Validar migrações somente em banco de teste.
7. Fazer deploy controlado com monitoramento e plano de rollback.

## Testes locais da prévia
```sh
node --test dev-preview/preview.test.js
```

## Proteções atuais
O serviço Render de prévia usa `node dev-preview/server.js` e não carrega o `server.js` principal. Não há integração com banco, provedores ou cobrança. As páginas possuem aviso de demonstração e bloqueio de indexação.
