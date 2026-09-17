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

  source = source.replace(
    'request.setTimeout(15000, () => request.destroy(new Error("Tempo limite da API Falcon excedido.")));',
    'request.setTimeout(20000, () => request.destroy(new Error("Tempo limite da API Falcon excedido.")));'
  );

  const falconMarker = `    request.on("error", reject);\n  });\n}\n\nfunction desphubRequest(payload) {`;
  const falconReplacement = `    request.on("error", reject);\n  });\n}\n\nfunction falconRetryableError(err) {\n  const code = String((err && err.code) || "").toUpperCase();\n  const message = String((err && err.message) || "");\n  return message.includes("Tempo limite da API Falcon") ||\n    ["ETIMEDOUT", "ECONNRESET", "EAI_AGAIN", "ENETUNREACH", "EHOSTUNREACH", "ECONNREFUSED"].includes(code);\n}\n\nasync function falconRequestWithRetry(url, token) {\n  const maxAttempts = 2;\n  let lastResponse = null;\n\n  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {\n    try {\n      const response = await falconRequest(url, token);\n      lastResponse = response;\n      const retryableStatus = response.status >= 500 && response.status <= 599;\n      if (!retryableStatus || attempt === maxAttempts) return response;\n      console.warn("Falcon retornou HTTP " + response.status + ". Nova tentativa " + (attempt + 1) + "/" + maxAttempts + ".");\n    } catch (err) {\n      if (!falconRetryableError(err) || attempt === maxAttempts) throw err;\n      console.warn("Falha temporária na Falcon: " + err.message + ". Nova tentativa " + (attempt + 1) + "/" + maxAttempts + ".");\n    }\n\n    await new Promise(resolve => setTimeout(resolve, 700));\n  }\n\n  return lastResponse;\n}\n\nfunction desphubRequest(payload) {`;

  if (!source.includes(falconMarker)) {
    throw new Error('Não foi possível localizar o ponto de integração da Falcon em server.js.');
  }
  source = source.replace(falconMarker, falconReplacement);

  const callMarker = 'const response = await falconRequest(url, FALCON_TOKEN);';
  if (!source.includes(callMarker)) {
    throw new Error('Não foi possível localizar a chamada da Falcon em server.js.');
  }
  source = source.replace(callMarker, 'const response = await falconRequestWithRetry(url, FALCON_TOKEN);');

  module._compile(source, filename);
};
