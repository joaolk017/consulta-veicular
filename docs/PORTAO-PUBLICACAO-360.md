# Portão de publicação — Consulta Veicular 360

**Estado:** BLOQUEADO para merge/deploy de produção até que todos os requisitos abaixo sejam verificados e documentados. PR #7 permanece em rascunho.

## Verificações confirmadas
- [x] Alterações isoladas em `dev/transformacao-profissional-360`; produção em `main`.
- [x] GitHub Actions #73: validações de interface, transparência, crédito e webhook com Woovi simulada aprovadas.
- [x] Serviço Render de produção `consulta-veicular` identificado: branch `main`, publicação automática por commit ativada. **Qualquer merge em main pode disparar deploy.**
- [x] Banco Render de produção `consulta-veicular-db` identificado e disponível; PostgreSQL 18.
- [x] Preços de pacotes da vitrine de desenvolvimento alinhados ao servidor: R$ 18,90, R$ 32,90 e R$ 44,90.

## Bloqueios antes de publicar
- [ ] **Backup recuperável:** confirmar no painel Render o recurso disponível para o plano contratado; executar e registrar um teste de restauração em ambiente separado sem alterar dados reais. Status atual: não verificado. Não supor que um snapshot exista.
- [ ] **Identidade comercial:** confirmar CNPJ, razão social, responsável, telefone e e-mail de atendimento, inclusive compatibilidade com nome do recebedor no Pix.
- [ ] **Experiência de compra:** teste visual manual em celular e desktop, do anúncio à tela pré-Pix, cobrindo 1, 2 e 3 consultas. Confirmar que o preço efetivo corresponde ao anunciado.
- [ ] **Dados e provedores:** confirmar contratualmente quais campos são fornecidos e quais alegações podem ser comprovadas.
- [ ] **Woovi real:** teste controlado e autorizado de ponta a ponta, com plano de estorno, sem usar banco de produção para ensaios.
- [ ] **Release/rollback:** validar procedimento de reversão do deploy e de recuperação dos dados, com responsáveis e critérios de parada.
- [x] **Autorização do proprietário para publicação oficial:** concedida na conversa em 09/11/2026; a execução continua condicionada aos demais requisitos técnicos e comerciais deste documento.

## Procedimento de publicação quando desbloqueado
1. Reexecutar GitHub Actions no commit exato candidato.
2. Registrar hash do commit de `main`, status do backup e horário de manutenção.
3. Revisar PR #7 e somente então fazer merge autorizado; **o Render publica automaticamente commits em main**, portanto preparar janela de monitoramento e rollback antes do merge.
4. Fazer smoke tests públicos sem dados sensíveis e monitorar erros e cobranças.
5. Se falhar, interromper novas mudanças e aplicar rollback de aplicação conforme procedimento validado; não reverter dados sem análise.

**Autorização posterior:** o proprietário autorizou a publicação oficial, condicionada à verificação dos requisitos de segurança. Este documento não autoriza criar cobranças de teste ou alterar o banco real.

## Revisão do portão de publicação — 09/11/2026
- GitHub Actions #101: jobs `preview-tests` e `postgres-integration` concluídos com sucesso no commit `02f316e9541fa332cffc9e7292bb99b4e3a54957`.
- PR #7 continua aberto, em rascunho e não mesclado; branch de produção `main` permanece separada.
- Render confirma `autoDeploy=yes` por commit na `main`: qualquer merge pode publicar automaticamente. **Não mesclar sem liberação expressa e verificações finais.**
- PostgreSQL de produção `consulta-veicular-db` está disponível, PostgreSQL 18, 1 GB, sem alta disponibilidade. A consulta de metadados **não comprova backup restaurável**.
- Pendências de liberação: backup com restauração verificada, identidade empresarial e recebedor Pix, navegação real desktop/mobile, teste ponta a ponta de pagamento com credenciais isoladas, verificação de dados de provedores, rollback e revisão de políticas do Google Ads.
- Nenhuma alteração de infraestrutura ou de produção foi feita nesta revisão.

## Auditoria de conectividade do banco — 09/11/2026
- Consulta somente leitura ao catálogo `information_schema.columns` do PostgreSQL de produção foi **bloqueada** pelo Render: allowlist de IPs vazia impede conexões externas por esta integração.
- Nenhum dado foi lido ou alterado; nenhuma regra de rede foi flexibilizada.
- **Não abrir o banco à internet para resolver o teste.** Validar estrutura e plano de restauração por um caminho autorizado e seguro (por exemplo, execução dentro da rede privada ou ambiente de testes com acesso restrito), antes de liberar publicação.
- GitHub Actions #111: `preview-tests` e `postgres-integration` aprovados, mas isso não valida backup/restauração nem conectividade ao banco de produção.

## Conferência do candidato de publicação — 09/11/2026
- PR #7 consultado novamente: **aberto, rascunho, não mesclado**, base `main`; `mergeable=true` não significa autorização para publicar.
- GitHub Actions #120: jobs `preview-tests` e `postgres-integration` aprovados; verificações de preço/créditos no checkout Pix, webhook simulado, titularidade de relatórios e ensaio de backup em PostgreSQL descartável.
- Render PostgreSQL oficial: `available`, PostgreSQL 18, 1 GB, sem alta disponibilidade e com allowlist de IPs vazia. Metadados não informam se há backup recuperável.
- **Status: publicação bloqueada**. Não alterar `main`, o banco, a allowlist, os segredos ou gerar cobranças reais para concluir os testes.

### Evidências exigidas para retirar cada bloqueio
1. **Backup de produção:** registrar método, data, responsável e resultado de restauração em banco separado; validar contagens e conteúdo sem expor dados reais em logs.
2. **Recebedor Pix e empresa:** verificar documentos e dados reais do recebedor com a identificação exibida nas páginas; não registrar segredos nem dados pessoais sensíveis no repositório.
3. **Compra isolada:** registrar valores e créditos dos três pacotes, confirmação Woovi, idempotência e possibilidade de estorno; não usar o banco de produção.
4. **Interface e publicidade:** registrar testes visuais em celular e desktop e conferir afirmações sobre cobertura, prazo, fonte de dados e política de reembolso.
5. **Rollback:** identificar commit anterior da `main`, confirmar como reimplantar a versão anterior e separar rollback de código de eventual restauração de dados; jamais restaurar produção sem análise de transações posteriores.
6. **Liberação:** revisar o diff final do PR #7, reexecutar testes no commit exato e aplicar a autorização já concedida pelo proprietário somente quando todos os requisitos estiverem comprovados; se o escopo ou risco mudar materialmente, pedir nova aprovação.

## Prévia interativa e revisão de liberação — 09/11/2026
- GitHub Actions **#152**, commit `ad454629f746cf6e552d9b47e999e1d4782625e3`: execução completa aprovada após atualizar o teste de reabertura do histórico. A falha da execução #150 foi de uma asserção textual desatualizada; o job PostgreSQL já havia passado.
- Render `consulta-veicular-360-preview`: deploy `dep-dbp2s2etlv9c73dk9jpg` com status `live`. A página `/jornada-demo` permite pacote, pagamento fictício, saldo, consumo e reabertura de relatórios fictícios, com avisos explícitos de não serem documentos oficiais.
- A prévia é isolada, não valida pagamento real, provedores, banco de produção, nem aprovação do Google Ads. A rota `/site-real` continua apenas visual, com scripts e formulários bloqueados.
- **Permanecem pendentes**: backup recuperável da produção comprovado; identidade comercial e recebedor Pix; evidências visuais mobile/desktop; escopo dos dados dos fornecedores; teste controlado do pagamento real em ambiente seguro; rollback e aprovação expressa de merge/deploy.
- **Decisão:** publicação em `main` continua BLOQUEADA. Nenhuma mudança na produção foi autorizada ou executada.

## Atualização da candidatura — 09/11/2026, após autorização oficial
- Proprietário autorizou expressamente publicar a versão oficial, sem confirmações repetidas para melhorias rotineiras. A autorização está **registrada**, mas a publicação continua condicionada às salvaguardas técnicas acima.
- Commit candidato atual: `cdab6ddfc3ad05ba5b29b96bc708afa6ea2a82e2` na branch isolada.
- GitHub Actions **#159**: concluído com sucesso. Deploy de prévia `dep-dbp63ugm7kps739uqjrg`: **live**, com melhorias de foco acessível e layout de histórico móvel.
- Ainda **não** há evidência de backup restaurável de produção, titularidade comercial/Pix, pagamento real isolado e rollback validado. Não confundir sucesso de CI com aprovação para operar pagamentos.
- A autorização do proprietário não dispensa esses controles. Nenhum merge em `main` ou deploy oficial foi executado nesta etapa.

## Transparência pré-compra e verificação de prévia — 09/11/2026
- Commit `d93cc412149713b2a05bd2682820cb2771782093`: demonstração não pré-preenche placa e explicita antes do pagamento fictício que a disponibilidade de dados depende de provedores e que não há consulta real.
- GitHub Actions **#162**: `success`. Render prévia deploy `dep-dbp65ds9v7es73anku40`: `live`.
- Essas verificações não comprovam conformidade Google Ads, identidade do recebedor Pix, dados fornecidos por terceiros, backup/restauração de produção nem testes de cobrança real.
- Portão oficial permanece **BLOQUEADO**, apesar da autorização expressa do proprietário. Não mesclar `main` até resolver os bloqueios materiais.

## Auditoria de acompanhamento — 11/11/2026
- PR #7 consultado: aberto, em rascunho, base `main`, origem `dev/transformacao-profissional-360`, 136 commits e 39 arquivos alterados; comparação `main...dev/transformacao-profissional-360` confirma 136 commits à frente e zero atrás. **Não foi mesclado.**
- GitHub Actions **#169** do commit `0eb917e7e6fd0c03b012d5786474724f9bebc6f2`: `completed/success`. A validação cobre a prévia isolada; não é evidência de cobrança real, backup restaurado ou conformidade Google Ads.
- Requisitos de liberação ainda sem comprovação: backup restaurável de produção testado em ambiente separado; identidade comercial e recebedor Pix; contrato/cobertura dos provedores; checkout real isolado; revisão visual móvel/desktop; rollback e monitoramento.
- Esta atualização é apenas documental e não altera `main`, serviços Render, banco, credenciais ou pagamentos.
