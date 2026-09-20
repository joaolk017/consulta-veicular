# Consulta Veicular 360 — checklist de migração para KingHost

Este documento não contém senhas, tokens ou chaves reais.

## Antes da migração

- Manter o Render ativo até a validação final.
- Contratar/configurar a aplicação Node.js na KingHost.
- Usar uma versão Node.js compatível com o `package.json`.
- Comando de inicialização: `npm start`.
- Definir `NODE_ENV=production`.
- Configurar as variáveis listadas em `.env.example`.
- Não salvar segredos no GitHub.

## Variáveis necessárias

- `DATABASE_URL`
- `FALCON_TOKEN`
- `FONTEDATA_API_KEY`
- `OPENPIX_APP_ID` (ou `WOOVI_APP_ID`)
- `OPENPIX_API_URL`
- `OPENPIX_WEBHOOK_SECRET`
- `PAYMENT_SIGNING_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `ADMIN_FUNNEL_SECRET`

A porta deve continuar sendo fornecida pela hospedagem por variável de ambiente.

## Testes antes de apontar o domínio

1. Confirmar que a aplicação inicia sem erro.
2. Confirmar resposta HTTP 200 em `/health`.
3. Testar página inicial e páginas legais.
4. Testar consulta/Prévia sem pagamento real.
5. Confirmar conexão com PostgreSQL e carteira de créditos.
6. Confirmar comunicação com a API veicular.
7. Confirmar geração de cobrança PIX de teste.
8. Confirmar consulta de status da cobrança.
9. Confirmar recebimento do webhook Woovi/OpenPix.
10. Confirmar envio de código por Resend.
11. Testar painel administrativo.
12. Testar PWA e funcionamento no celular.

## DNS e e-mail

Ao migrar o domínio, alterar somente os registros necessários para apontar o site à nova hospedagem.

Preservar os registros de e-mail e autenticação já existentes (SPF, DKIM e DMARC). Não substituir toda a zona DNS sem antes copiar e conferir esses registros.

## Corte para produção

- Não cancelar o Render antes do corte.
- Apontar o domínio somente depois dos testes.
- Após a propagação, testar novamente site, API, PIX, webhook, Resend, créditos e painel.
- Manter o Render disponível durante a janela inicial de validação.
- Desativar a hospedagem antiga somente depois de confirmar que a nova instalação está estável.

## Segurança

- Nunca copiar segredos para arquivos versionados.
- Usar o painel de variáveis de ambiente da hospedagem.
- Não publicar `.env`.
- Não alterar chaves de produção durante a migração sem necessidade.
