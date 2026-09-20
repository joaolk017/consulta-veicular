'use strict';

const https = require('https');

const BASE_URL = 'https://cred-pro.com';
const CREDPRO_TEST_API_KEY = String(process.env.CREDPRO_TEST_API_KEY || '').trim();

function normalizePlate(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
}

function isTestKey() {
  return /^cpk_test_/i.test(CREDPRO_TEST_API_KEY);
}

function request(method, pathname, body) {
  if (!CREDPRO_TEST_API_KEY) throw new Error('CREDPRO_TEST_API_KEY não configurada.');
  if (!isTestKey()) throw new Error('Segurança: este cliente aceita somente chave CredPro de sandbox (cpk_test_).');
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request(new URL(pathname, BASE_URL), {
      method,
      headers: {
        Authorization: `Bearer ${CREDPRO_TEST_API_KEY}`,
        Accept: 'application/json',
        ...(payload ? {'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)} : {})
      },
      timeout: 30000
    }, res => {
      const chunks=[];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let data=null;
        try { data=JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) return resolve(data);
        const err=new Error('CredPro sandbox respondeu HTTP '+res.statusCode);
        err.status=res.statusCode; err.data=data; reject(err);
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Timeout CredPro sandbox.')));
    req.on('error',reject);
    if(payload) req.write(payload);
    req.end();
  });
}

async function getCatalog() {
  return request('GET','/v1/pesquisas/itens');
}

async function createSandboxResearch(plate, items=['leilao','sinistro','bin_estadual']) {
  const p=normalizePlate(plate);
  if(!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(p) && !/^[A-Z]{3}[0-9]{4}$/.test(p)) throw new Error('Placa inválida.');
  return request('POST','/v1/pesquisas',{placa:p,itens:items});
}

async function getSandboxResearch(id) {
  if(!/^\d+$/.test(String(id))) throw new Error('ID de pesquisa inválido.');
  return request('GET','/v1/pesquisas/'+id);
}

module.exports={getCatalog,createSandboxResearch,getSandboxResearch,isTestKey};
