# Consulta Veicular + Falcon

## Rodar localmente
1. Instale Node.js 18+.
2. Rode `npm install`.
3. Defina a variável de ambiente `FALCON_TOKEN` com uma chave nova da Falcon.
4. Rode `npm start`.
5. Abra `http://localhost:3000`.

## Produção
Publique este projeto em um serviço que execute Node.js e configure `FALCON_TOKEN` nas variáveis secretas do serviço.

A chave NÃO deve ser colocada no `index.html`.

O endpoint usado pelo backend é:
GET /private/v1/vehicles/{placa}/search

Confira a documentação/condições atuais da Falcon antes de colocar o serviço à venda.
