/**
 * Servidor de mentira que imita o Web App do Apps Script, para o teste do
 * `tools/configurar-relato.sh --testar` não depender do Google.
 *
 * Ele responde do mesmo jeito que o Apps Script: o POST volta com **302** e a
 * resposta de verdade ("ok" ou "token invalido") vem no endereço de retorno.
 * É justamente esse redirecionamento que já quebrou o `--testar` uma vez
 * (`curl -X POST -L` reenvia POST e entra em laço) — então ele fica guardado.
 *
 * Uso: node tests/fixtures/servidor-relato.js [ok|token] [porta]
 */
const http = require('http');

const modo = process.argv[2] || 'ok';
const porta = Number(process.argv[3] || 8765);

http
  .createServer((req, res) => {
    if (req.method === 'POST') {
      req.resume();
      res.writeHead(302, { Location: `http://127.0.0.1:${porta}/resultado` });
      res.end();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(modo === 'token' ? 'token invalido' : 'ok');
  })
  .listen(porta, '127.0.0.1', () => {
    console.log('servidor de teste na porta ' + porta + ' (' + modo + ')');
  });
