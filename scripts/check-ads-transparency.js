'use strict';
// Auditoria estática de transparência: não valida CNPJ ou titularidade em fontes externas.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const pages=['index.html','sobre/index.html','contato.html','privacidade.html','termos.html','reembolso.html'];
const contents=Object.fromEntries(pages.map(f=>[f,read(f)]));
const cnpj='69.184.344/0001-02';
for(const [file,html] of Object.entries(contents)){
 assert.match(html,/<title>[^<]+<\/title>/i,file+': título ausente');
 assert.ok(html.includes(cnpj),file+': CNPJ não encontrado');
 assert.ok(!/site oficial do detran|site oficial da senatran|órgão governamental responsável/i.test(html),file+': alegação oficial suspeita');
}
const home=contents['index.html'];
const about=contents['sobre/index.html'];
assert.match(home,/serviço privado|plataforma privada|serviço independente|empresa privada/i,'Página inicial deve identificar natureza privada');
assert.match(about,/não (?:é|somos|possui|tem) (?:um )?(?:órgão|vínculo|afiliação)|independente|não governamental|sem vínculo/i,'Página sobre deve esclarecer independência');
for(const file of ['contato.html','privacidade.html','termos.html','reembolso.html']){
 assert.ok(home.includes('/'+file),'Página inicial deve ter link para '+file);
}
for(const file of ['contato.html','privacidade.html','termos.html','reembolso.html']){
 assert.ok(about.includes('/'+file),'Página sobre deve ter link para '+file);
}
for(const amount of ['18,90']){
 assert.ok(home.includes(amount),'Preço não encontrado na home: '+amount);
}
console.log('Transparência: 6 páginas, identificação, links legais, caráter privado e preço inicial verificados estaticamente. Preços de pacotes dependem do checkout; dados cadastrais não validados externamente.');
