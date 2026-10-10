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

const ALARM_NAME = 'pegavaga-tick';
const TICK_MINUTES = 1;
const LINKEDIN_TAB_PATTERN = 'https://www.linkedin.com/*';

/* -------------------------------------------------------------------------- */
/* Ciclo de vida                                                               */
/* -------------------------------------------------------------------------- */

chrome.runtime.onInstalled.addListener(() => {
  syncAlarm().then(tick);
});

chrome.runtime.onStartup.addListener(() => {
  syncAlarm().then(tick);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm && alarm.name === ALARM_NAME) tick();
});

/* O pop-up e o content script mudam settings/run direto no storage: aqui só
 * mantemos o alarme alinhado com o que precisa acontecer. */
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes[STORAGE.settings] || changes[STORAGE.run]) syncAlarm();
});

/* Ao subir um service worker novo, garante que o alarme exista se necessário. */
syncAlarm();

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
  const existing = await chrome.alarms.get(ALARM_NAME).catch(() => null);

  if (needed && !existing) {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: TICK_MINUTES,
      periodInMinutes: TICK_MINUTES,
    });
    return;
  }

  if (!needed && existing) {
    await chrome.alarms.clear(ALARM_NAME).catch(() => {});
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
  await chrome.storage.local.remove(STORAGE.run).catch(() => {});
  await sendToTab(run && run.tabId, { type: MSG.STOP });
}

/** Cutuca a aba pausada; se ninguém responder, recarrega (o load retoma). */
async function nudge(run) {
  const delivered = await sendToTab(run && run.tabId, { type: MSG.RESUME });
  if (delivered) return;

  if (run && run.tabId != null) {
    await chrome.tabs.reload(run.tabId).catch(() => {});
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

