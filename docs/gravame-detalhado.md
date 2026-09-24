# Gravame detalhado — implementação controlada

Status: preparação, não habilitado em produção.

## Configuração proposta
- Produto opcional `gravame-detalhado`, preço sugerido R$ 29,90 (validar comercialmente).
- Endpoint FonteData documentado: `POST https://app.dabradata.com/api/v1/consulta/gravame-veicular?placa=...`, autenticação `X-API-Key`. Validar contrato, acesso da chave, método e payload atual antes de chamar.
- Comparar custo/cobertura FonteData (referência R$4,79) com módulo CredPro gravame (R$3,00 de referência no código; conferir preço atual).
- Não adicionar o produto à constante `PACKAGES` existente sem separar o direito de uso: `credits` representa consultas veiculares completas, não módulos de gravame.

## Fluxo necessário
1. Cliente seleciona gravame detalhado para placa válida e vê escopo, preço e aviso de dados sujeitos à disponibilidade da fonte.
2. Criar cobrança PIX vinculada à conta, placa e produto; persistir idempotência no PostgreSQL.
3. Somente após pagamento verificado no servidor, criar direito a uma consulta de gravame (separado da carteira de consultas completas).
4. Travar execução por compra para evitar chamadas duplicadas, inclusive em requisições concorrentes; armazenar resultado ou falha e permitir retomada controlada.
5. Se fornecedor falhar, não marcar consulta entregue; oferecer nova tentativa controlada ou reembolso conforme política.
6. Mostrar apenas campos realmente presentes; dado ausente não é prova de inexistência de gravame.
7. Cobrir testes: pagamento pendente, webhook repetido, chamada concorrente, indisponibilidade do fornecedor, regressão de pacotes atuais.

## Lançamento
Usar flag `GRAVAME_DETALHADO_ENABLED=0` por padrão. Não executar chamadas pagas de teste sem aprovação. Validar ambiente e autorização de acesso antes de ativar. Merge em `main` dispara deploy automático no Render; conferir logs e status após merge.
