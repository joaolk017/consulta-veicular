'use strict';

// Ponto único de inicialização dos módulos que estendem a aplicação.
// Recuperação paga, proxy, renderização e PDF agora ficam concentrados em recovery-suite-preload.js.
const modules = [
  './preview-rate-limit-preload.js',
  './security-preload.js',
  './recovery-suite-preload.js',
  './fontedata-preload.js',
  './falcon-preview-ui-preload.js',
  './gravame-direct-mobile-preload.js',
  './gravame-preload.js',
  './gravame-home-preload.js',
  './ads-cleanup-preload.js',
  './swap-fipe-gravame-preload.js',
  './inline-result-preload.js',
  './no-auto-scroll-preload.js',
  './google-ads-conversion-preload.js',
  './transparency-preload.js'
];

for (const modulePath of modules) {
  try {
    require(modulePath);
  } catch (err) {
    console.error(`BOOTSTRAP: falha ao carregar ${modulePath}:`, err && err.stack ? err.stack : err);
    throw err;
  }
}

console.log(`BOOTSTRAP: ${modules.length} módulos ativos carregados por um único ponto de inicialização.`);
