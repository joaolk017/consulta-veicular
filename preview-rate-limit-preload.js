const fs = require('fs');
const path = require('path');
const Module = require('module');

const originalJsLoader = Module._extensions['.js'];
const SERVER_PATH = path.resolve(__dirname, 'server.js');

Module._extensions['.js'] = function(module, filename) {
  if (path.resolve(filename) !== SERVER_PATH) {
    return originalJsLoader(module, filename);
  }

  let source = fs.readFileSync(filename, 'utf8');
  source = source.replace(
    'const MAX_PREVIEWS_PER_HOUR = 3;',
    'const MAX_PREVIEWS_PER_HOUR = 10;'
  );
  module._compile(source, filename);
};
