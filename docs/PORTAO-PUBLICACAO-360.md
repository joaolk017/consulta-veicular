# Portão de publicação — Consulta Veicular 360

**Estado:** BLOQUEADO para merge/deploy de produção até que todos os requisitos abaixo sejam verificados e documentados. PR #7 permanece em rascunho.

## Verificações confirmadas
- [x] Alterações isoladas em `dev/transformacao-profissional-360`; produção em `main`.
- [x] GitHub Actions #73: validações de interface, transparência, crédito e webhook com Woovi simulada aprovadas.
- [x] Banco Render de produção `consulta-veicular-db` identificado e disponível; PostgreSQL 18.
- [x] Preços de pacotes da vitrine de desenvolvimento alinhados ao servidor: R$ 18,90, R$ 32,90 e R$ 44,90.

## Bloqueios antes de publicar
- [ ] **Backup recuperável:** confirmar no painel Render o recurso disponível para o plano contratado; executar e registrar um teste de restauração em ambiente separado sem alterar dados reais. Status atual: não verificado. Não supor que um snapshot exista.
- [ ] **Identidade comercial:** confirmar CNPJ, razão social, responsável, telefone e e-mail de atendimento, inclusive compatibilidade com nome do recebedor no Pix.
- [ ] **Experiência de compra:** teste visual manual em celular e desktop, do anúncio à tela pré-Pix, cobrindo 1, 2 e 3 consultas. Confirmar que o preço efetivo corresponde ao anunciado.
- [ ] **Dados e provedores:** confirmar contratualmente quais campos são fornecidos e quais alegações podem ser comprovadas.
- [ ] **Woovi real:** teste controlado e autorizado de ponta a ponta, com plano de estorno, sem usar banco de produção para ensaios.
- [ ] **Release/rollback:** validar procedimento de reversão do deploy e de recuperação dos dados, com responsáveis e critérios de parada.
- [ ] **Aprovação explícita de publicação** após revisão do diff e evidências.

## Procedimento de publicação quando desbloqueado
1. Reexecutar GitHub Actions no commit exato candidato.
2. Registrar hash do commit de `main`, status do backup e horário de manutenção.
3. Revisar PR #7 e somente então fazer merge autorizado; confirmar comportamento do Render.
4. Fazer smoke tests públicos sem dados sensíveis e monitorar erros e cobranças.
5. Se falhar, interromper novas mudanças e aplicar rollback de aplicação conforme procedimento validado; não reverter dados sem análise.

**Não é autorização para merge, deploy, criar cobranças ou alterar o banco.**
