# API Full — homologação antes da ativação

Integração em `integrations/apifull-debitos.js`. Este módulo **não está ligado ao site ou ao bot**. O valor padrão de `APIFULL_ENABLED` é falso.

## Configuração futura (Render, nunca GitHub)

- `APIFULL_ENABLED=false` — mantenha assim até homologar.
- `APIFULL_TOKEN` — token Bearer, variável secreta.
- `APIFULL_BASE_URL` — confirmar URL base na documentação oficial antes de ativar.

## Contrato que ainda precisa de confirmação

A documentação apresentada indica `POST /api/debitos-veicular`, JSON com `link`, `pdf` e `placa`. O exemplo de schema não confirma quais valores são aceitos para `pdf`, nem qual valor de `status` indica sucesso. Também não confirma se o campo `link` é obrigatório.

**Não executar Try it out / Execute** sem antes confirmar se a requisição gera cobrança.

Peça ao suporte: (1) URL base exata, (2) payload real de exemplo com valores aceitos para `pdf` e `link`, (3) JSON de sucesso e de erro com os valores possíveis de `status`, (4) política de cobrança de consultas sem dados e testes.

## Verificações offline

`node --test test/apifull-debitos.test.js`

O módulo bloqueia requisições enquanto desativado. Mesmo quando habilitado, recusa entregar resultados até que o formato de sucesso seja homologado. Não habilitar para clientes nem mesclar a integração como pronta antes dessa etapa.
