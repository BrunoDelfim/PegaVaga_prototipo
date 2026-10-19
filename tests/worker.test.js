/* =============================================================================
 * PegaVaga - tests/worker.test.js
 *
 * O `background.js` roda de verdade: carregamos `shared.js` + `background.js`
 * num `chrome` falso e conferimos o que o usuário vê:
 *
 *   - o pedido de ajuda cria UMA janela, sempre `type: 'popup'` (sem barra de
 *     endereço), abrindo `ajuda.html` com o contexto da vaga;
 *   - a decisão da janelinha volta para a ABA certa e a janela é fechada;
 *   - fechar a aba recolhe a janelinha dela;
 *   - candidatura nova conta no badge do ícone (e o badge fica vazio sem ela).
 *
 * Também é a trava do `seguro()`: o mock devolve `undefined` nas APIs de alarme
 * (como o Chrome antigo fazia) — com `.catch` direto no retorno, o worker
 * estourava uma rejection solta e parava no meio.
 * ===========================================================================*/
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const raiz = path.join(__dirname, '..') + path.sep;
const criadas = [];
const enviados = [];
const acoes = [];
const removidas = [];
const notificacoesLimpas = [];
let badge = '';
let passaram = 0;
const falhas = [];

function confere(nome, ok, extra) {
  if (ok) {
    passaram += 1;
    return;
  }

  falhas.push(nome + (extra === undefined ? '' : '  -> ' + JSON.stringify(extra)));
}

function evento() {
  const ouvintes = [];
  return {
    addListener: (fn) => ouvintes.push(fn),
    removeListener: () => {},
    hasListener: () => ouvintes.length > 0,
    _ouvintes: ouvintes,
  };
}

const dados = {};

const chromeFalso = {
  runtime: {
    lastError: null,
    id: 'teste',
    getURL: (p) => 'chrome-extension://teste/' + p,
    onMessage: evento(),
    onInstalled: evento(),
    onStartup: evento(),
    sendMessage: () => Promise.resolve(),
  },
  storage: {
    local: {
      get: (chaves) => {
        if (chaves == null) return Promise.resolve(Object.assign({}, dados));

        const lista =
          typeof chaves === 'string' ? [chaves] : Array.isArray(chaves) ? chaves : Object.keys(chaves);
        const saida =
          typeof chaves === 'object' && !Array.isArray(chaves) ? Object.assign({}, chaves) : {};

        lista.forEach((k) => {
          if (k in dados) saida[k] = dados[k];
        });

        return Promise.resolve(saida);
      },
      set: (obj) => {
        Object.assign(dados, obj);
        return Promise.resolve();
      },
      remove: () => Promise.resolve(),
    },
    onChanged: evento(),
  },
  windows: {
    create: (opcoes) => {
      criadas.push(opcoes);
      return Promise.resolve({ id: 55 });
    },
    get: (id) => Promise.resolve({ id, left: 100, top: 200, width: 372, height: 470, type: 'popup' }),
    update: (id, opcoes) => {
      acoes.push(['windows.update', id, opcoes]);
      return Promise.resolve({ id });
    },
    remove: (id, cb) => {
      removidas.push(id);
      if (cb) cb();
      return Promise.resolve();
    },
    getCurrent: () => Promise.resolve({ id: 55, height: 470 }),
  },
  tabs: {
    query: () => Promise.resolve([]),
    get: (id) => Promise.resolve({ id, windowId: 1 }),
    update: (id) => Promise.resolve({ id, windowId: 1 }),
    create: () => Promise.resolve({ id: 1 }),
    reload: () => undefined, // Chrome antigo: `void`, não promessa
    sendMessage: (id, msg, cb) => {
      enviados.push([id, msg]);
      if (cb) cb();
    },
    onRemoved: evento(),
  },
  notifications: {
    create: (id, opcoes, cb) => {
      if (cb) cb(id);
      return Promise.resolve(id);
    },
    clear: (id, cb) => {
      notificacoesLimpas.push(id);
      if (cb) cb(true);
      return Promise.resolve(true);
    },
    onClicked: evento(),
    onButtonClicked: evento(),
  },
  alarms: {
    // Devolver `undefined` é o caso que quebrava: `undefined.catch` estourava.
    create: () => undefined,
    get: (nome, cb) => {
      if (cb) cb(null);
      return undefined;
    },
    clear: (nome, cb) => {
      if (cb) cb(true);
      return undefined;
    },
    onAlarm: evento(),
  },
  action: new Proxy(
    {},
    {
      get: (alvo, nome) => (...args) => {
        if (nome === 'setBadgeText') badge = args[0] && args[0].text;

        acoes.push(['action.' + String(nome), args[0]]);

        const cb = args[args.length - 1];
        if (typeof cb === 'function') cb();

        return Promise.resolve();
      },
    }
  ),
};

globalThis.chrome = chromeFalso;
globalThis.self = globalThis;
globalThis.importScripts = (...arquivos) => {
  arquivos.forEach((arquivo) => {
    const caminho = raiz + arquivo;
    if (!fs.existsSync(caminho)) throw new Error('sem arquivo ' + arquivo);

    vm.runInThisContext(fs.readFileSync(caminho, 'utf8'), { filename: arquivo });
  });
};

vm.runInThisContext(fs.readFileSync(raiz + 'background.js', 'utf8'), { filename: 'background.js' });

const [ouvinte] = chromeFalso.runtime.onMessage._ouvintes;

function mandar(msg, remetente) {
  return new Promise((resolve) => {
    let respondeu = false;

    ouvinte(msg, remetente || {}, (resposta) => {
      respondeu = true;
      resolve(resposta);
    });

    setTimeout(() => {
      if (!respondeu) resolve('(sem resposta)');
    }, 300);
  });
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== Worker (background.js de verdade) ===');

  // 1) Pedido de ajuda: uma janela, sempre popup, com o contexto na URL.
  const pedido = await mandar(
    {
      type: 'PEGAVAGA_AJUDA_PEDIDO',
      pedidoId: 'p1',
      titulo: 'Dev',
      empresa: 'ACME',
      campos: [{ rotulo: 'Cidade', tipo: 'texto', opcoes: [] }],
      posicao: { left: 100, top: 200 },
    },
    { tab: { id: 9 } }
  );

  confere('pedido responde ok', pedido && pedido.ok === true, pedido);
  confere('id carrega a aba', pedido && pedido.id === 'pegavaga-ajuda:9:p1', pedido);
  confere('devolve a janela (para o log)', pedido && pedido.janela === 55, pedido);
  confere('criou UMA janela', criadas.length === 1, criadas.length);
  confere('a janela e popup', criadas[0] && criadas[0].type === 'popup', criadas[0] && criadas[0].type);
  confere(
    'a janela abre ajuda.html com o contexto',
    Boolean(criadas[0] && /ajuda\.html\?dados=/.test(criadas[0].url)),
    criadas[0] && criadas[0].url
  );
  confere('largura da janelinha', criadas[0] && criadas[0].width === 372, criadas[0] && criadas[0].width);
  confere(
    'posicao vai no windows.create',
    Boolean(criadas[0] && criadas[0].left === 100 && criadas[0].top === 200),
    criadas[0]
  );

  const contexto = JSON.parse(decodeURIComponent(String(criadas[0].url).split('dados=')[1]));
  confere('contexto traz o avisoId', contexto.avisoId === 'pegavaga-ajuda:9:p1', contexto.avisoId);
  confere(
    'contexto traz o campo',
    contexto.campos && contexto.campos[0] && contexto.campos[0].rotulo === 'Cidade',
    contexto.campos
  );
  // B1: a posição viaja na URL para o cartão reaplicar com windows.update.
  confere(
    'contexto traz a posicao',
    Boolean(contexto.posicao && contexto.posicao.left === 100 && contexto.posicao.top === 200),
    contexto.posicao
  );

  // 2) Decisão: volta para a aba 9 e a janela é fechada.
  const resposta = await mandar({
    type: 'PEGAVAGA_AJUDA_RESPOSTA_JANELA',
    avisoId: 'pegavaga-ajuda:9:p1',
    acao: 'aplicar',
    resposta: { Cidade: 'Recife' },
  });

  confere('resposta ok', resposta && resposta.ok === true, resposta);

  const paraAba = enviados.find(([id]) => id === 9);
  confere('entregou para a aba 9', Boolean(paraAba), enviados);
  confere(
    'mensagem e AJUDA_RESPOSTA',
    Boolean(paraAba && paraAba[1].type === 'PEGAVAGA_AJUDA_RESPOSTA'),
    paraAba && paraAba[1]
  );
  confere('leva o pedidoId', Boolean(paraAba && paraAba[1].pedidoId === 'p1'), paraAba && paraAba[1]);
  confere(
    'leva a resposta',
    Boolean(paraAba && paraAba[1].resposta && paraAba[1].resposta.Cidade === 'Recife'),
    paraAba && paraAba[1]
  );
  confere('fechou a janela', removidas.includes(55), removidas);

  // 3) Aba fechada com o cartão aberto: a janelinha dela é recolhida.
  const pedido2 = await mandar({ type: 'PEGAVAGA_AJUDA_PEDIDO', pedidoId: 'p2' }, { tab: { id: 12 } });
  confere('segundo pedido ok', pedido2 && pedido2.ok === true, pedido2);

  const [ouvinteAba] = chromeFalso.tabs.onRemoved._ouvintes;
  ouvinteAba(12);
  await espera(50);
  confere('recolheu a janela da aba 12', removidas.length >= 2, removidas);

  // 3b) "Parar" total: fecha o cartão de ajuda e limpa a notificação.
  const pedido3 = await mandar(
    { type: 'PEGAVAGA_AJUDA_PEDIDO', pedidoId: 'p3' },
    { tab: { id: 14 } }
  );
  confere('terceiro pedido ok', pedido3 && pedido3.ok === true, pedido3);

  const antesStop = removidas.length;
  const parada = await mandar({ type: 'PEGAVAGA_STOP_ALL' });
  confere('parar tudo responde ok', parada && parada.ok === true, parada);
  confere('parar tudo fecha o cartao', removidas.length > antesStop, removidas);
  confere(
    'parar tudo limpa a notificacao de ajuda',
    notificacoesLimpas.includes('pegavaga-help'),
    notificacoesLimpas
  );

  // 4) Badge: candidatura nova conta no ícone (o worker não pode ter morrido
  //    antes disso por causa do `undefined.catch` dos alarmes).
  const agora = Date.now();
  dados.pegavaga_apps = [agora, agora];

  const [ouvinteStorage] = chromeFalso.storage.onChanged._ouvintes;
  ouvinteStorage({ pegavaga_apps: { newValue: dados.pegavaga_apps } }, 'local');
  await espera(200);

  confere('badge mostra 2', badge === '2', badge);
  confere('acao setTitle foi chamada', acoes.some((a) => a[0] === 'action.setTitle'), acoes.map((a) => a[0]));

  // 5) Sem candidatura hoje: o badge não inventa número.
  dados.pegavaga_apps = [];
  ouvinteStorage({ pegavaga_apps: { newValue: [] } }, 'local');
  await espera(200);
  confere('badge vazio sem candidatura', String(badge).trim() === '', badge);

  console.log('');
  console.log('=========================================');
  console.log('RESULTADO: ' + passaram + ' passaram, ' + falhas.length + ' falharam');
  console.log('=========================================');

  if (falhas.length) {
    console.log('\nFALHAS:');
    falhas.forEach((falha) => console.log(' - ' + falha));
  }

  process.exit(falhas.length ? 1 : 0);
})();
