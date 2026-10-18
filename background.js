/* =============================================================================
 * PegaVaga - background.js (service worker)
 *
 * É o agendador da extensão: roda independente do pop-up estar aberto.
 *
 *   - acorda a cada minuto (chrome.alarms) enquanto existir agendador ativo ou
 *     alguma execução pausada por cota;
 *   - dentro da janela de horário configurada, abre a busca do LinkedIn e
 *     deixa o content.js varrer termo por termo;
 *   - fora da janela, encerra a execução que estiver rodando;
 *   - respeita o período de descanso (proteção da conta) quando o LinkedIn
 *     sinaliza limite de uso: nem inicia, nem retoma nada enquanto ele durar;
 *   - quando uma cota (hora/24h/dia) libera espaço, cutuca a aba para o
 *     content.js retomar a varredura sozinho.
 *
 * O alarme só existe quando há algo para fazer, para não acordar o worker à
 * toa. O estado real vive em chrome.storage.local (fonte da verdade).
 * ===========================================================================*/

'use strict';

importScripts('shared.js');

const SHARED = globalThis.PegaVagaShared;
const STORAGE = SHARED.STORAGE;
const MSG = SHARED.MSG;

/* Configuração de ambiente (`env.js`): destinatário e entregador dos relatos.
 * O arquivo fica fora do git (o `.gitignore` cuida) e pode não existir — sem ele
 * os relatos ficam locais e nada sai do navegador. */
try {
  importScripts('env.js');
} catch (error) {
  /* sem env.js: relatos ficam locais */
}

const ENV = globalThis.PegaVagaEnv || {};
const REPORT_ENDPOINT = String(ENV.reportEndpoint || '').trim();
const REPORT_TOKEN = String(ENV.reportToken || '').trim();
const REPORT_EMAIL = String(ENV.reportEmail || '').trim();

const ALARM_NAME = 'pegavaga-tick';
const ALARM_BADGE_RESET = 'pegavaga-badge-reset'; // virada do dia: zera o contador
const TICK_MINUTES = 1;
const LINKEDIN_TAB_PATTERN = 'https://www.linkedin.com/*';

/* Luzinha do ícone: o ponto colorido é desenhado por cima do próprio logo. Se o
 * canvas não estiver disponível, o selo colorido no canto assume o recado. */
const ICON_SIZES = [16, 32];
const ICON_FILES = { 16: 'icons/lg_pv_16.png', 32: 'icons/lg_pv_32.png' };

/* -------------------------------------------------------------------------- */
/* Ciclo de vida                                                               */
/* -------------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  syncAlarm()
    .then(() => tick())
    .then(() => refreshStatus())
    .then(() => refreshBadge())
    .then(() => scheduleBadgeReset());
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarm()
    .then(() => tick())
    .then(() => refreshStatus())
    .then(() => refreshBadge())
    .then(() => scheduleBadgeReset());
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm) return;

  if (alarm.name === ALARM_NAME) tick().then(() => refreshStatus());

  // Virada do dia: o contador do badge volta a zero e o alarme é remarcado.
  if (alarm.name === ALARM_BADGE_RESET) {
    refreshBadge().then(() => scheduleBadgeReset());
  }
});

/* O pop-up e o content script mudam settings/run direto no storage: aqui só
 * mantemos o alarme (e a luz do ícone) alinhados com o que precisa acontecer. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE.settings] || changes[STORAGE.run]) syncAlarm();
  if (changes[STORAGE.settings]) refreshLocale();
  if (changes[STORAGE.settings] || changes[STORAGE.run] || changes[STORAGE.guard]) {
    refreshStatus();
  }
  // Candidatura nova (ou limpeza de dados): o contador do dia se atualiza aqui.
  if (changes[STORAGE.apps]) refreshBadge();
});

/* O content script avisa o andamento mesmo com o pop-up fechado: assim a luz do
 * ícone acompanha a varredura em tempo real. Aqui também tratamos o pedido de
 * ajuda (notificação de área de trabalho) e o "pular vaga travada". */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) return false;

  if (message.type === MSG.PROGRESS) {
    refreshStatus(message);
    return false;
  }

  if (message.type === MSG.HELP) {
    showHelpNotification(message, sender).then((shown) =>
      sendResponse({ ok: true, shown: Boolean(shown) })
    );
    return true; // a resposta vem depois (a notificação é assíncrona)
  }

  if (message.type === MSG.HELP_CLEAR) {
    clearHelpNotification();
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MSG.AJUDA_PEDIDO) {
    // A aba travou num campo: abre a janelinha no desktop. O resultado diz se deu
    // certo — se não, o content script cai na notificação de sempre.
    mostrarAjuda(message, sender).then((resultado) => sendResponse(resultado));
    return true; // a janela é assíncrona
  }

  if (message.type === MSG.AJUDA_RESPOSTA_JANELA) {
    // A decisão veio da janelinha: leva para a aba certa e fecha a janelinha.
    responderAjuda(message.avisoId, message.acao, message.resposta).then((ok) =>
      sendResponse({ ok: Boolean(ok) })
    );
    return true;
  }

  if (message.type === MSG.AJUDA_FECHAR) {
    // A aba desistiu do pedido (prazo, Parar): recolhe a janelinha se ela ainda existe.
    fecharJanelaAjuda(message.avisoId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.type === MSG.SKIP) {
    skipStuckJob().then((skipped) => sendResponse({ ok: Boolean(skipped) }));
    return true; // a resposta vem depois (precisa da aba)
  }

  if (message.type === MSG.DONE) {
    // Fim de varredura (ou parada por proteção): o texto vem pronto do content.
    showRunEndNotification(message).then((shown) =>
      sendResponse({ ok: true, shown: Boolean(shown) })
    );
    return true; // a resposta vem depois (a notificação é assíncrona)
  }

  if (message.type === MSG.REPORT) {
    // Relato de erro criado: a extensão avisa e oferece o envio.
    showReportNotification(message).then((shown) =>
      sendResponse({ ok: true, shown: Boolean(shown) })
    );
    return true; // idem: a notificação é assíncrona
  }

  if (message.type === MSG.REPORT_SEND) {
    sendPendingReport(message.id).then((enviado) => sendResponse({ ok: Boolean(enviado) }));
    return true;
  }

  if (message.type === MSG.REPORT_KEEP) {
    keepPendingReport(message.id).then((mantido) => sendResponse({ ok: Boolean(mantido) }));
    return true;
  }

  return false;
});

/* Ao subir um service worker novo, garante o alarme, a luz e o contador certos. */
syncAlarm();
refreshLocale().then(() => refreshStatus());
refreshBadge();
scheduleBadgeReset();

/**
 * O idioma escolhido no pop-up também vale aqui: o tooltip do ícone e as
 * notificações saem no idioma do usuário. Lê uma vez (e a cada mudança de
 * configuração), deixando `SHARED.t()`/`translate()` prontos para o resto.
 */
async function refreshLocale() {
  try {
    const data = await chrome.storage.local.get(STORAGE.settings);
    SHARED.setLocale(SHARED.parseSettings(data[STORAGE.settings]).locale);
  } catch (error) {
    SHARED.setLocale(null); // sem configuração legível: segue o navegador
  }
}

/* -------------------------------------------------------------------------- */
/* Leitura de estado                                                           */
/* -------------------------------------------------------------------------- */

async function readState() {
  const data = await chrome.storage.local.get([
    STORAGE.settings,
    STORAGE.run,
    STORAGE.apps,
    STORAGE.guard,
  ]);

  const guard = data[STORAGE.guard] || null;

  return {
    settings: SHARED.parseSettings(data[STORAGE.settings]),
    run: data[STORAGE.run] || null,
    apps: Array.isArray(data[STORAGE.apps]) ? data[STORAGE.apps] : [],
    // Proteção da conta: enquanto durar, não automatizamos nada.
    guard: guard && guard.blockedUntil > Date.now() ? guard : null,
  };
}

function writeRun(run) {
  return chrome.storage.local.set({ [STORAGE.run]: run }).catch(() => {});
}

/* -------------------------------------------------------------------------- */
/* Luz do ícone (verde capturando · amarela pronta · vermelha atenção)         */
/* -------------------------------------------------------------------------- */

const iconBitmaps = new Map(); // PNGs do logo já decodificados
let paintedLight = null; // cor que está desenhada no ícone agora
let lightColor = null; // cor da última luz (fundo do badge do contador)
let todayCount = 0; // candidaturas de hoje (contador do badge)

/**
 * Acende a luz do ícone. Aceita um `PEGAVAGA_PROGRESS` recém-chegado (mais fresco
 * que o storage) ou lê o estado gravado. Nada disso é crítico: se o navegador
 * recusar, a extensão continua funcionando normalmente.
 */
async function refreshStatus(progress) {
  let source = progress && progress.type === MSG.PROGRESS ? progress : null;

  if (!source) {
    try {
      const state = await readState();
      source = { run: state.run, guard: state.guard };
    } catch (error) {
      return;
    }
  }

  try {
    await applyLight(SHARED.statusLight(source));
  } catch (error) {
    /* ícone é enfeite: falhar aqui não pode atrapalhar a varredura */
  }
}

async function applyLight(light) {
  setAction('setTitle', { title: SHARED.translate(light.title) });

  if (paintedLight !== light.color) {
    const painted = await paintIcon(light.color).catch(() => false);

    // Plano B (sem OffscreenCanvas): logo original + selo colorido no canto.
    paintedLight = painted ? light.color : null;
    if (!painted) setAction('setIcon', { path: ICON_FILES });
  }

  lightColor = light.color;
  paintBadge();
}

/**
 * Pinta o badge do ícone: o **total de candidaturas de hoje**. Quando não há
 * nenhuma, o badge fica vazio — no caminho normal a luz do status já vai
 * desenhada no próprio logo, então o badge é do contador.
 *
 * No plano B (sem OffscreenCanvas) é o badge que carrega a luz, então ele volta
 * a ser o selo colorido quando o dia ainda não tem candidatura: a **cor** segue
 * dizendo o status e o **número** entra por cima quando existe.
 */
function paintBadge() {
  const text = SHARED.badgeText(todayCount);
  const selo = paintedLight == null; // sem canvas: a luz mora no badge

  setAction('setBadgeText', { text: text || (selo ? ' ' : '') });
  setAction('setBadgeBackgroundColor', {
    color: lightColor || (SHARED.STATUS_LIGHTS.ready && SHARED.STATUS_LIGHTS.ready.color) || '#3b9dff',
  });
  setAction('setBadgeTextColor', { color: '#ffffff' });
}

/** Recalcula o contador do dia a partir do histórico e repinta o badge. */
async function refreshBadge() {
  try {
    const data = await chrome.storage.local.get(STORAGE.apps);
    todayCount = SHARED.countAppsToday(data[STORAGE.apps]);
  } catch (error) {
    return; // ícone é enfeite: falhar aqui não pode atrapalhar nada
  }

  paintBadge();
}

/**
 * Marca a virada do dia para o contador voltar a zero sozinho — sem isso o
 * ícone continuaria mostrando o número de ontem até algo mais acontecer.
 * O alarme é criado de novo a cada disparo (é assim que ele se mantém vivo).
 */
/**
 * Executa uma API do Chrome que pode devolver promise, promise recusada **ou
 * nada** (várias delas só passaram a devolver promise no Chrome 111). Assim o
 * `await` nunca explode com `undefined.catch` — o que derrubava o worker com uma
 * rejection solta e deixava o alarme/retomada sem ser agendado.
 */
async function seguro(fn, padrao) {
  try {
    return await fn();
  } catch (error) {
    return padrao;
  }
}

async function scheduleBadgeReset() {
  const agora = new Date();
  const virada = new Date(
    agora.getFullYear(),
    agora.getMonth(),
    agora.getDate() + 1,
    0,
    0,
    5
  );

  await seguro(() => chrome.alarms.create(ALARM_BADGE_RESET, { when: virada.getTime() }));
}

/** Chama a API do ícone sem deixar promise solta nem derrubar o worker. */
function setAction(method, details) {
  try {
    const result = chrome.action[method](details);
    if (result && typeof result.catch === 'function') result.catch(() => {});
  } catch (error) {
    /* método indisponível nesta versão do Chrome */
  }
}

/**
 * Desenha o ponto colorido por cima do logo. Devolve `false` quando o canvas não
 * está disponível, para o selo do canto assumir o recado.
 */
async function paintIcon(color) {
  if (typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function') {
    return false;
  }

  const imageData = {};

  for (const size of ICON_SIZES) imageData[size] = await dotImage(size, color);

  await chrome.action.setIcon({ imageData });
  return true;
}

/** O logo do tamanho pedido, com a luz no canto inferior direito. */
async function dotImage(size, color) {
  const context = new OffscreenCanvas(size, size).getContext('2d');

  context.drawImage(await baseIcon(size), 0, 0, size, size);

  const radius = Math.max(3, Math.round(size * 0.2));
  const ring = Math.max(1, Math.round(size / 16));
  const center = size - radius - ring;

  // Anel branco: sem ele o ponto se perde no azul do logo.
  context.beginPath();
  context.arc(center, center, radius + ring, 0, Math.PI * 2);
  context.fillStyle = '#ffffff';
  context.fill();

  context.beginPath();
  context.arc(center, center, radius, 0, Math.PI * 2);
  context.fillStyle = color;
  context.fill();

  return context.getImageData(0, 0, size, size);
}

async function baseIcon(size) {
  if (!iconBitmaps.has(size)) {
    const response = await fetch(chrome.runtime.getURL(ICON_FILES[size]));
    iconBitmaps.set(size, await createImageBitmap(await response.blob()));
  }

  return iconBitmaps.get(size);
}

/* -------------------------------------------------------------------------- */
/* Alarme                                                                      */
/* -------------------------------------------------------------------------- */

/** Só mantém o alarme ligado quando há agendador ativo ou execução pausada. */
async function syncAlarm() {
  let state;

  try {
    state = await readState();
  } catch (error) {
    return;
  }

  const needed =
    state.settings.schedule.enabled || Boolean(state.run && state.run.paused) || Boolean(state.guard);
  const existing = await seguro(() => chrome.alarms.get(ALARM_NAME), null);

  if (needed && !existing) {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: TICK_MINUTES,
      periodInMinutes: TICK_MINUTES,
    });
    return;
  }

  if (!needed && existing) {
    await seguro(() => chrome.alarms.clear(ALARM_NAME));
  }
}

/* -------------------------------------------------------------------------- */
/* Tick: o cérebro do agendador                                                */
/* -------------------------------------------------------------------------- */

async function tick() {
  let state;

  try {
    state = await readState();
  } catch (error) {
    return;
  }

  const { settings, run, guard } = state;
  const now = Date.now();
  const inWindow = SHARED.isWithinSchedule(new Date(now), settings.schedule);

  // 0) Proteção da conta ligada (o LinkedIn sinalizou limite de uso): nada de
  //    automação enquanto durar o descanso, nem retomada por cota.
  if (guard) {
    if (run && run.running && !run.paused) {
      await pauseRun(run, guard.blockedUntil, 'guard');
    }

    await syncAlarm();
    return;
  }

  // 1) Passou do horário: encerra a execução em andamento (a pausada espera).
  if (run && run.running && !run.paused && settings.schedule.enabled && !inWindow) {
    await stopRun(run);
    await syncAlarm();
    return;
  }

  // 2) Chegou o horário: começa sozinho.
  if (!run && canAutoStart(settings, now)) {
    await startRun(settings);
    await syncAlarm();
    return;
  }

  // 3) Execução pausada por cota: retoma quando a próxima vaga liberar.
  //    Fora da janela agendada ela continua parada (volta quando o horário abrir).
  if (run && run.running && run.paused && (!settings.schedule.enabled || inWindow)) {
    const quota = SHARED.computeQuota(settings, state.apps, now, run.appliedInTerm || 0);

    if (quota.ok) {
      await nudge(run);
    } else if (quota.resumeAt && quota.resumeAt !== run.resumeAt) {
      await writeRun(Object.assign({}, run, { resumeAt: quota.resumeAt, pauseReason: 'cota' }));
    }
  }

  await syncAlarm();
}

/** Guarda a fila pausada até `resumeAt`, explicando o motivo. */
function pauseRun(run, resumeAt, reason) {
  return writeRun(
    Object.assign({}, run, {
      paused: true,
      resumeAt: Number.isFinite(resumeAt) ? resumeAt : Date.now() + 60000,
      pauseReason: reason || 'cota',
    })
  );
}

function canAutoStart(settings, now) {
  if (!settings.schedule.enabled || !settings.schedule.autoStart) return false;
  if (!settings.terms.length) return false; // sem termos não há o que buscar
  return SHARED.isWithinSchedule(new Date(now), settings.schedule);
}

/* -------------------------------------------------------------------------- */
/* Ações                                                                       */
/* -------------------------------------------------------------------------- */

/** Monta a fila e manda a aba do LinkedIn carregar o primeiro termo. */
async function startRun(settings) {
  const run = SHARED.buildRunQueue(settings);
  run.source = 'agendador';

  const firstUrl = run.urls[0] || SHARED.LINKEDIN_SEARCH_URL;
  const focus = settings.schedule.focusTab !== false;

  // A fila é gravada ANTES de navegar: o content.js retoma ao carregar.
  await writeRun(run);

  const tab = await findLinkedInTab();
  let tabId = null;

  try {
    if (tab && tab.id != null) {
      tabId = tab.id;
      if (tab.url === firstUrl) {
        await chrome.tabs.reload(tabId);
      } else {
        await chrome.tabs.update(tabId, { url: firstUrl, active: focus });
      }
    } else {
      const created = await chrome.tabs.create({ url: firstUrl, active: focus });
      tabId = created && created.id;
    }
  } catch (error) {
    // Sem a aba, a fila fica gravada e o usuário pode clicar em Iniciar.
    return;
  }

  if (tabId != null) {
    run.tabId = tabId;
    await writeRun(run);
  }
}

/** Encerra a execução: apaga a fila (fonte da verdade) e avisa a aba. */
async function stopRun(run) {
  clearHelpNotification();
  await chrome.storage.local.remove(STORAGE.run).catch(() => {});
  await sendToTab(run && run.tabId, { type: MSG.STOP });
}

/** Cutuca a aba pausada; se ninguém responder, recarrega (o load retoma). */
async function nudge(run) {
  const delivered = await sendToTab(run && run.tabId, { type: MSG.RESUME });
  if (delivered) return;

  if (run && run.tabId != null) {
    await seguro(() => chrome.tabs.reload(run.tabId));
  }
}

/**
 * Procura uma aba do LinkedIn já aberta. O filtro por URL exige permissão de
 * host para o padrão (temos host_permissions para o LinkedIn); se o navegador
 * recusar, simplesmente abrimos uma aba nova.
 */
async function findLinkedInTab() {
  try {
    const tabs = await chrome.tabs.query({ url: LINKEDIN_TAB_PATTERN });
    const usable = (tabs || []).filter((tab) => tab && tab.id != null);
    return usable[0] || null;
  } catch (error) {
    return null;
  }
}

function sendToTab(tabId, message) {
  return new Promise((resolve) => {
    if (tabId == null) {
      resolve(false);
      return;
    }

    try {
      chrome.tabs.sendMessage(tabId, message, () => resolve(!chrome.runtime.lastError));
    } catch (error) {
      resolve(false);
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Ajuda: quando uma vaga trava num campo que só o usuário sabe preencher      */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Pedido de ajuda: a janelinha no desktop                                    */
/* -------------------------------------------------------------------------- */

// A janelinha (ajuda.html) abre como JANELA POPUP do Chrome: sem aba, sem barra
// de endereço e sem menu — só a barra de título e a borda do sistema. É o mais
// "capado" que o navegador oferece, e de propósito NUNCA caímos para uma janela
// normal (ela traz barra de endereço e abas). Se a janela não abrir, o content
// script usa a notificação de sempre — a vaga nunca é descartada em silêncio.
const ajudasAbertas = new Map(); // id do pedido → id da janela do Chrome

async function mostrarAjuda(dados, sender) {
  if (!chrome.windows || typeof chrome.windows.create !== 'function') {
    return { ok: false, motivo: 'sem_api_windows' };
  }

  const pedidoId = String((dados && dados.pedidoId) || '');
  const tabId = sender && sender.tab && sender.tab.id != null ? sender.tab.id : null;

  if (!pedidoId) return { ok: false, motivo: 'sem_pedido' };
  if (tabId == null) return { ok: false, motivo: 'sem_aba' };

  const id = SHARED.ajudaId(tabId, pedidoId);

  // O contexto (vaga, motivo e os campos) viaja na URL: a janelinha abre já
  // sabendo o que desenhar — um <select> com as opções ORIGINAIS do LinkedIn, ou
  // um <input> para texto. Teto de 6 campos: cartão ilegível não ajuda ninguém.
  const contexto = encodeURIComponent(
    JSON.stringify({
      avisoId: id, // é o que a janelinha manda de volta (o id carrega a aba)
      motivo: (dados && dados.motivo) || '',
      titulo: (dados && dados.titulo) || '',
      empresa: (dados && dados.empresa) || '',
      campos: Array.isArray(dados && dados.campos) ? dados.campos.slice(0, 6) : [],
    })
  );
  const url = chrome.runtime.getURL('ajuda.html') + '?dados=' + contexto;

  const janela = {
    url: url,
    type: 'popup',
    width: SHARED.JANELINHA.largura,
    height: SHARED.JANELINHA.altura,
    focused: true,
  };

  // A posição vem da aba (ela enxerga o `screen`; o service worker não). Se o
  // Chrome recusar a posição, tentamos de novo sem ela — mas SEMPRE como popup.
  const posicao =
    dados && dados.posicao && Number.isFinite(dados.posicao.left) && Number.isFinite(dados.posicao.top)
      ? { left: Math.round(dados.posicao.left), top: Math.round(dados.posicao.top) }
      : null;

  let criada = null;
  let recusa = '';

  for (const tentativa of posicao ? [Object.assign({}, janela, posicao), janela] : [janela]) {
    try {
      criada = await chrome.windows.create(tentativa);
      break;
    } catch (error) {
      recusa = String((error && error.message) || error);
    }
  }

  const windowId = criada && criada.id != null ? criada.id : null;
  if (windowId == null) return { ok: false, motivo: 'create_falhou:' + (recusa || 'sem_id') };

  ajudasAbertas.set(id, windowId);

  // Registra onde ela nasceu: se a janela abrir atrás de tudo (ou em outro
  // monitor), o console do worker diz exatamente onde procurar.
  try {
    const info = await chrome.windows.get(windowId);
    console.info(
      '[PegaVaga] cartão de ajuda aberto na janela',
      windowId,
      'em',
      info && info.left,
      info && info.top,
      '(' + ((info && info.width) || '?') + 'x' + ((info && info.height) || '?') + ')'
    );
  } catch (error) {
    console.info('[PegaVaga] cartão de ajuda aberto na janela', windowId);
  }

  try {
    await chrome.windows.update(windowId, { focused: true, drawAttention: true });
  } catch (error) {
    /* focar é cortesia: a janela já existe e funciona */
  }

  return { ok: true, id: id, janela: windowId, recusa: recusa || '' };
}

/** Fecha a janelinha do pedido (sem erro se ela já saiu). */
function fecharJanelaAjuda(ajudaId) {
  const windowId = ajudasAbertas.get(ajudaId);

  if (windowId == null) return;

  try {
    const resultado = chrome.windows.remove(windowId);
    if (resultado && typeof resultado.catch === 'function') resultado.catch(() => {});
  } catch (error) {
    /* a janela já saiu */
  }

  ajudasAbertas.delete(ajudaId);
}

/** Traz a aba da vaga para frente — é o que "Vou preencher à mão" precisa. */
async function focarAbaAjuda(tabId) {
  try {
    const aba = await chrome.tabs.update(tabId, { active: true });
    const windowId = aba && aba.windowId != null ? aba.windowId : null;

    if (windowId != null && chrome.windows && typeof chrome.windows.update === 'function') {
      await chrome.windows.update(windowId, { focused: true });
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * A decisão veio da janelinha: entrega à aba que está esperando e fecha a janela.
 * Ação vazia é o "fechei sem decidir" — ela TAMBÉM avisa a aba; sem isso a
 * varredura ficava parada até o prazo acabar, parecendo que a extensão travou.
 */
async function responderAjuda(ajudaId, acao, resposta) {
  const alvo = SHARED.lerAjudaId(ajudaId);

  fecharJanelaAjuda(ajudaId);

  if (!alvo) return false;

  if (acao === 'manual') await focarAbaAjuda(alvo.tabId);

  return sendToTab(alvo.tabId, {
    type: MSG.AJUDA_RESPOSTA,
    pedidoId: alvo.pedidoId,
    acao: acao || '',
    resposta: resposta || null,
  });
}

const HELP_NOTIFICATION_ID = 'pegavaga-help';
let helpTabId = null; // aba que pediu ajuda (é ela que o clique traz para frente)

/**
 * Mostra a notificação "PegaVaga precisa de ajuda". Clicar nela traz a aba do
 * LinkedIn para frente; o botão "Pular vaga" manda o content script cancelar a
 * candidatura atual e seguir para a próxima.
 */
async function showHelpNotification(message, sender) {
  if (!chrome.notifications) {
    console.warn('[PegaVaga] Notificações indisponíveis: recarregue a extensão para valer a permissão.');
    return false;
  }

  const tabId = (sender && sender.tab && sender.tab.id) || (await resolveHelpTabId());
  helpTabId = tabId != null ? tabId : null;

  const missing = (message && Array.isArray(message.missing) ? message.missing : [])
    .filter(Boolean)
    .slice(0, 2);
  const jobTitle = message && message.jobTitle ? String(message.jobTitle).slice(0, 60) : '';
  const fields = missing.length ? missing.join(', ') : 'um campo obrigatório';

  try {
    await chrome.notifications.create(HELP_NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: 'icons/lg_pv_128.png',
      title: 'PegaVaga precisa de ajuda para continuar',
      message:
        'Não consegui preencher ' +
        fields +
        (jobTitle ? ' na vaga «' + jobTitle + '»' : '') +
        '. Abra a página para completar ou pule a vaga.',
      priority: 2,
      requireInteraction: true,
      buttons: [{ title: 'Preencher manualmente' }, { title: 'Pular vaga' }],
    });
    console.info('[PegaVaga] Notificação de ajuda criada.');
    return true;
  } catch (error) {
    // Sem a permissão de notificações: o pop-up mostra o mesmo aviso (faixa + luz vermelha).
    console.warn('[PegaVaga] Não consegui criar a notificação de ajuda:', error);
    return false;
  }
}

/** Fecha a notificação de ajuda (se estiver aberta). */
function clearHelpNotification() {
  try {
    chrome.notifications.clear(HELP_NOTIFICATION_ID, () => void chrome.runtime.lastError);
  } catch (error) {
    /* notificações indisponíveis: nada a fechar */
  }
}

/** Traz uma aba (do LinkedIn) para frente, focando a janela dela também. */
async function focusTabId(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab && tab.windowId != null) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    /* aba fechada: nada a focar */
  }
}

/** Traz a aba do LinkedIn (a que pediu ajuda) para frente. */
async function focusHelpTab() {
  const tabId = await resolveHelpTabId();
  if (tabId == null) return;
  await focusTabId(tabId);
}

/* -------------------------------------------------------------------------- */
/* Fim da varredura (ou parada por proteção da conta)                         */
/* -------------------------------------------------------------------------- */

const DONE_NOTIFICATION_ID = 'pegavaga-done';

/**
 * Avisa que a varredura terminou — útil para quem deixou rodando em segundo
 * plano — ou que ela **parou por proteção da conta** (aí a notificação fica na
 * tela até você ver).
 *
 * O texto sai de `SHARED.describeRunEnd()`, alimentado com o resumo que o
 * `content.js` mandou: assim a decisão do que dizer é uma função pura, testada
 * fora do service worker.
 */
async function showRunEndNotification(message) {
  if (!chrome.notifications) {
    console.warn('[PegaVaga] Notificações indisponíveis: recarregue a extensão para valer a permissão.');
    return false;
  }

  const texto = SHARED.describeRunEnd(message);

  try {
    await chrome.notifications.create(DONE_NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: 'icons/lg_pv_128.png',
      title: texto.title,
      message: texto.message,
      priority: texto.urgent ? 2 : 0,
      requireInteraction: Boolean(texto.urgent),
    });
    console.info('[PegaVaga] Notificação de fim de varredura criada.');
    return true;
  } catch (error) {
    // Sem a permissão: o pop-up e a luz do ícone continuam mostrando o estado.
    console.warn('[PegaVaga] Não consegui criar a notificação de fim de varredura:', error);
    return false;
  }
}

/** Traz a aba da varredura para frente (mesma ideia do pedido de ajuda). */
async function focusRunTab() {
  const tabId = await resolveHelpTabId();
  if (tabId == null) return;
  await focusTabId(tabId);
}

/* -------------------------------------------------------------------------- */
/* Relatos de erro (fila local + envio em um clique)                          */
/* -------------------------------------------------------------------------- */

const REPORT_NOTIFICATION_ID = 'pegavaga-report';
const STATUS_NOTIFICATION_ID = 'pegavaga-status';
let reportNotifiedAt = 0; // agrupa: uma notificação por rajada, não por erro

/** Lê a lista de relatos do storage (sempre um array). */
function readReports() {
  return chrome.storage.local
    .get(STORAGE.reports)
    .then((dados) => (Array.isArray(dados[STORAGE.reports]) ? dados[STORAGE.reports] : []))
    .catch(() => []);
}

/** Confirmação curta (some sozinha) para uma ação que o usuário não vê. */
async function notifyStatus(texto) {
  if (!chrome.notifications) return;

  try {
    await chrome.notifications.create(STATUS_NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: 'icons/lg_pv_128.png',
      title: 'PegaVaga',
      message: texto,
      priority: 0,
      requireInteraction: false,
    });
  } catch (error) {
    /* sem notificação: o pop-up mostra o mesmo estado */
  }
}

/**
 * Avisa que a extensão teve um problema e oferece o relato.
 *
 * Com entregador configurado, o botão manda em **um clique** e nada abre para o
 * usuário. Sem entregador, o botão traz a aba para frente: o relato fica pendente
 * em Configurações → Diagnóstico, para copiar ou baixar.
 */
async function showReportNotification(message) {
  if (!chrome.notifications) return false;

  const agora = Date.now();
  if (agora - reportNotifiedAt < 60000) return false; // uma por rajada
  reportNotifiedAt = agora;

  const relatos = await readReports();
  const relato = (message && message.id && relatos.find((r) => r.id === message.id)) ||
    SHARED.lastPendingReport(relatos);

  const botoes = REPORT_ENDPOINT
    ? [{ title: SHARED.t('Enviar diagnóstico') }, { title: SHARED.t('Manter local') }]
    : [{ title: SHARED.t('Ver relato') }];

  const corpo = relato
    ? SHARED.t('O relato está pronto: {resumo}.', { resumo: SHARED.describeReport(relato) })
    : SHARED.t('O relato está pronto em Configurações → Diagnóstico.');

  try {
    await chrome.notifications.create(REPORT_NOTIFICATION_ID, {
      type: 'basic',
      iconUrl: 'icons/lg_pv_128.png',
      title: SHARED.t('PegaVaga teve um problema na varredura'),
      message: corpo,
      priority: 2,
      requireInteraction: true,
      buttons: botoes,
    });
    console.info('[PegaVaga] Notificação de relato criada.');
    return true;
  } catch (error) {
    console.warn('[PegaVaga] Não consegui criar a notificação de relato:', error);
    return false;
  }
}

/**
 * Manda o relato pendente mais recente pelo entregador configurado.
 *
 * O POST vai como formulário e em `no-cors`: é o que o Web App do Apps Script
 * aceita **sem** precisar de permissão de host no manifest (nada de preflight).
 * O preço disso é não poder ler a resposta — por isso o status vira "enviado"
 * quando a requisição sai, e o histórico em Diagnóstico é a conferência.
 */
/** Manda um relato específico (ou o pendente mais recente, sem id). */
async function sendPendingReport(id) {
  const relatos = await readReports();
  const pendente =
    (id && relatos.find((item) => item.id === id)) || SHARED.lastPendingReport(relatos);

  if (!pendente) return false;

  if (!REPORT_ENDPOINT) {
    await notifyStatus(SHARED.t('Sem destinatário configurado — o relato ficou pendente.'));
    return false;
  }

  try {
    const corpo = new URLSearchParams();
    corpo.set('token', REPORT_TOKEN);
    corpo.set('para', REPORT_EMAIL);
    corpo.set(
      'payload',
      JSON.stringify({
        id: pendente.id,
        motivo: pendente.reason,
        quando: pendente.when,
        erros: pendente.errors,
        diagnostico: pendente.payload,
      })
    );

    await fetch(REPORT_ENDPOINT, { method: 'POST', mode: 'no-cors', body: corpo });

    await chrome.storage.local.set({
      [STORAGE.reports]: SHARED.markReport(relatos, pendente.id, 'enviado', {
        channel: 'endpoint',
      }),
    });

    console.info('[PegaVaga] Relato enviado:', pendente.id);
    await notifyStatus(SHARED.t('Relato de erro enviado. Obrigado!'));
    return true;
  } catch (error) {
    console.warn('[PegaVaga] Falha ao enviar o relato:', error);
    await notifyStatus(
      SHARED.t('Não consegui enviar agora: {motivo}', {
        motivo: (error && error.message) || 'erro de rede',
      })
    );
    return false;
  }
}

/** O usuário escolheu guardar o relato só no computador dele. */
async function keepPendingReport(id) {
  const relatos = await readReports();
  const pendente =
    (id && relatos.find((item) => item.id === id)) || SHARED.lastPendingReport(relatos);

  if (!pendente) return false;

  await chrome.storage.local.set({
    [STORAGE.reports]: SHARED.markReport(relatos, pendente.id, 'local'),
  });

  await notifyStatus(SHARED.t('Relato mantido no computador.'));
  return true;
}

/** Manda a aba cancelar a vaga travada e avançar. Devolve se foi entregue. */
async function skipStuckJob() {
  const tabId = await resolveHelpTabId();
  if (tabId == null) return false;

  const delivered = await sendToTab(tabId, { type: MSG.SKIP });
  if (delivered) clearHelpNotification();
  return delivered;
}

/** Descobre qual aba do LinkedIn está com a vaga travada. */
async function resolveHelpTabId() {
  if (helpTabId != null) {
    try {
      await chrome.tabs.get(helpTabId);
      return helpTabId;
    } catch (error) {
      helpTabId = null;
    }
  }

  try {
    const state = await readState();
    const tabId = state.run && state.run.tabId;
    if (tabId != null) {
      await chrome.tabs.get(tabId);
      return tabId;
    }
  } catch (error) {
    /* segue para a busca por uma aba do LinkedIn */
  }

  const tab = await findLinkedInTab();
  return tab ? tab.id : null;
}

/* Listeners da notificação de ajuda (só existem com a permissão de notificações). */
if (chrome.notifications) {
  chrome.notifications.onClicked.addListener((id) => {
    if (id === HELP_NOTIFICATION_ID) focusHelpTab();
    else if (id === DONE_NOTIFICATION_ID) focusRunTab();
    else if (id === REPORT_NOTIFICATION_ID) focusRunTab();
  });

  chrome.notifications.onButtonClicked.addListener((id, index) => {
    if (id === HELP_NOTIFICATION_ID) {
      if (index === 0) {
        focusHelpTab(); // "Preencher manualmente": traz a aba do LinkedIn para frente
      } else if (index === 1) {
        skipStuckJob(); // "Pular vaga": cancela a atual e avança
      }
      return;
    }

    if (id !== REPORT_NOTIFICATION_ID) return;

    // Sem entregador configurado o botão é só um: leva ao pop-up, onde o relato
    // fica pendente com Copiar e Baixar JSON.
    if (!REPORT_ENDPOINT) {
      focusRunTab();
      return;
    }

    if (index === 0) sendPendingReport();
    else keepPendingReport();
  });
}

/* Se a aba que pediu ajuda sumir, a notificação não faz mais sentido. */
chrome.tabs.onRemoved.addListener((tabId) => {
  if (helpTabId != null && tabId === helpTabId) {
    helpTabId = null;
    clearHelpNotification();
  }

  // A aba que esperava a decisão sumiu: a janelinha não tem mais para quem
  // responder — fecha para não ficar órfã no desktop.
  for (const [ajudaId, windowId] of ajudasAbertas) {
    const alvo = SHARED.lerAjudaId(ajudaId);
    if (!alvo || alvo.tabId !== tabId) continue;

    try {
      chrome.windows.remove(windowId, () => void chrome.runtime.lastError);
    } catch (error) {
      /* a janela já saiu */
    }

    ajudasAbertas.delete(ajudaId);
  }
});

