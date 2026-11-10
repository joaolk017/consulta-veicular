# Validação segura do backup de produção — Consulta Veicular 360

**Situação:** NÃO COMPROVADO. Este documento não autoriza backup, restauração, mudança de plano ou acesso ao banco de produção.

## Inventário confirmado em 09/11/2026
- Banco: `consulta-veicular-db` (Render ID `dpg-dal9fjlbedkc73bo4npg-a`).
- PostgreSQL 18, plano `0.1c-256mb`, armazenamento configurado 1 GB, região Oregon.
- Status `available`; sem alta disponibilidade; `ipAllowList=[]` (acesso externo não liberado).
- Página do banco: https://dashboard.render.com/d/dpg-dal9fjlbedkc73bo4npg-a
- **Os metadados da API não mostram backups disponíveis nem comprovam capacidade de restauração.**

## Verificação manual, somente leitura
1. Abrir o painel do banco no Render, com conta autorizada, e localizar a seção de backups/recuperação.
2. Registrar em documento privado: modalidade de backup, política de retenção, ponto mais recente recuperável e restrições do plano. Não copiar URLs de conexão, tokens, senhas ou dados de clientes.
3. Se não houver backups ou restauração disponíveis, marcar o portão como **BLOQUEADO** e planejar alternativa antes de publicar. Não contratar serviços ou alterar plano sem aprovação explícita.
4. Se houver backup, verificar se há restauração para **instância separada** e custo envolvido. Não iniciar restauração sem autorização específica e avaliação de custos.
5. Em ambiente isolado e autorizado, realizar teste de restauração e verificar integridade de dados sem publicar informações sensíveis em logs.
6. Registrar responsável, data, evidência, método, resultado e tempo de recuperação. Confirmar procedimento de reversão da aplicação separadamente.

## Critérios de aprovação
- [ ] Existência de ponto de recuperação verificável.
- [ ] Retenção e janela de recuperação documentadas.
- [ ] Restauração bem-sucedida em ambiente separado.
- [ ] Integridade verificada sem vazamento de dados.
- [ ] Responsável e procedimento de emergência definidos.
- [ ] Custo e eventual janela de manutenção aprovados.

**Se algum item falhar, não mesclar PR #7 nem publicar alterações na produção.**
