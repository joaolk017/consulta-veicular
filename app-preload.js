'use strict';

// Ponto único de inicialização dos módulos que estendem a aplicação.
// A ordem é mantida para preservar exatamente o comportamento atual do site.
const modules = [
  './preview-rate-limit-preload.js',
  './security-preload.js',
  './recovery-route-redirect-preload.js',
  './recovery-preload.js',
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
  './recovery-hotfix-preload.js',
  './recovery-paid-fallback-preload.js',
  './recovery-direct-route-preload.js',
  './recovery-browser-render-preload.js',
  './recovery-pdf-preload.js',
  './recovery-pdf-modal-preload.js'
];

for (const modulePath of modules) {
  try {
    require(modulePath);
  } catch (err) {
    console.error(`BOOTSTRAP: falha ao carregar ${modulePath}:`, err && err.stack ? err.stack : err);
    throw err;
  }
}

console.log(`BOOTSTRAP: ${modules.length} módulos carregados por um único ponto de inicialização.`);
