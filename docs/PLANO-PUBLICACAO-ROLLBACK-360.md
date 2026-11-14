# Plano operacional de publicação e rollback — Consulta Veicular 360

> Documento de preparação. Não executar merge, deploy ou restauração automaticamente.

## Serviços conhecidos
- Produção Render: `srv-dal1180ae00c73f64lsg` (branch `main`, deploy automático).
- Prévia isolada Render: `srv-dbosagrl550s73aoe110` (branch `dev/transformacao-profissional-360`, deploy manual).
- Pull request de revisão: https://github.com/joaolk017/consulta-veicular/pull/7

## Antes do merge
1. Registrar SHA exato de `main` e do commit candidato; conferir que PR não inclui segredos.
2. Verificar os resultados dos testes e revisar a interface real em celular e desktop.
3. Confirmar nome empresarial, CNPJ, suporte, cobertura das fontes, preços, reembolso e termos.
4. Confirmar backup restaurável do banco de produção **sem copiar dados pessoais para a prévia**.
5. Preparar uma janela de publicação e monitoramento do Render, logs e webhook.
6. Validar Pix, confirmação, créditos, consultas e painel com integrações isoladas. Não usar Pix real na prévia.

## Publicação controlada (somente após aprovação)
1. Fazer merge do PR para `main` apenas com autorização e verificações concluídas.
2. Acompanhar deploy automático do serviço de produção no Render.
3. Verificar home, páginas institucionais, sessão, login, consulta, checkout e painel.
4. Acompanhar erros HTTP, falhas de consulta, confirmação de pagamento e crédito duplicado.
5. Se houver falha, interromper novas alterações e aplicar plano de rollback.

## Rollback de código
1. Identificar o SHA anterior de `main` registrado antes do merge.
2. Preferir `git revert` dos commits de publicação em novo commit auditável; isso dispara novo deploy automático.
3. Confirmar a versão anterior servida e monitorar rotas essenciais.
4. **Rollback de código não desfaz transações nem mudanças de banco.** Nunca restaurar banco sem análise de pagamentos ocorridos após o backup.
5. Se uma migração de banco for necessária, criar plano de reversão separado, com validação de integridade.

## Pendências bloqueantes
- [ ] Backup e restauração comprovados
- [ ] Testes integrados de pagamento e créditos em ambiente isolado
- [ ] Revisão manual de interface e acessibilidade
- [ ] Conferência de identidade, termos, reembolso e dados comerciais
- [ ] Autorização de publicação e acompanhamento do deploy
