/* =============================================================================
 * PegaVaga - popup.js
 * Interface do usuário: cadastra a busca (URL/perfil + termos), configura as
 * cotas de candidatura e o agendador, abre a aba do LinkedIn quando necessário,
 * dispara a varredura no content.js, mostra contador/cotas e gera o .csv.
 * ===========================================================================*/

'use strict';

/* -------------------------------------------------------------------------- */
/* Constantes compartilhadas com o content.js (ver shared.js)                  */
/* -------------------------------------------------------------------------- */

const SHARED = window.PegaVagaShared;
const MSG = SHARED.MSG;

const STORAGE_JOBS_KEY = SHARED.STORAGE.jobs;
const STORAGE_META_KEY = SHARED.STORAGE.meta;
const STORAGE_SETTINGS_KEY = SHARED.STORAGE.settings;
const STORAGE_RUN_KEY = SHARED.STORAGE.run;
const STORAGE_APPS_KEY = SHARED.STORAGE.apps;

const CSV_HEADERS = [
  'ID',
  'Titulo',
  'Empresa',
  'Link',
  'Descricao',
  'Capturado em',
  'Termo',
  'Status da candidatura',
  'Candidatado em',
];
const CSV_SEPARATOR = ';'; // Excel pt-BR usa ponto e vírgula como separador padrão

const APPLY_STATUS_LABELS = {
  enviada: 'Enviada',
  externa: 'Externa (site da empresa)',
  sem_botao: 'Sem botão de candidatura',
  sem_modal: 'Formulário não abriu',
  travada: 'Travada em campo obrigatório',
  incompleta: 'Formulário incompleto',
  cancelada: 'Cancelada',
};

const SAVE_DELAY_MS = 400; // debounce do salvamento automático da configuração
const DAY_LABELS = SHARED.WEEKDAYS;

/* -------------------------------------------------------------------------- */
/* Elementos da interface                                                      */
/* -------------------------------------------------------------------------- */

const els = {};
let saveTimer = null;
let settings = SHARED.parseSettings(null);
let appsCache = [];
let runCache = null;

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  buildDayInputs();
  bindEvents();

  await loadSettingsToForm();
  await refresh();
  await syncScanningState();

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function cacheElements() {
  els.count = document.getElementById('count');
  els.lastRun = document.getElementById('last-run');
  els.runInfo = document.getElementById('run-info');
  els.quotaInfo = document.getElementById('quota-info');
  els.status = document.getElementById('status');
  els.btnStart = document.getElementById('btn-start');
  els.btnStop = document.getElementById('btn-stop');
  els.btnExport = document.getElementById('btn-export');
  els.btnClear = document.getElementById('btn-clear');
  els.settings = document.getElementById('settings');
  els.baseUrl = document.getElementById('base-url');
  els.location = document.getElementById('location');
  els.terms = document.getElementById('terms');
  els.settingsHint = document.getElementById('settings-hint');
  els.scheduleHint = document.getElementById('schedule-hint');
  els.applyEnabled = document.getElementById('apply-enabled');
  els.applyPerTerm = document.getElementById('apply-per-term');
  els.applyHour = document.getElementById('apply-hour');
  els.apply24h = document.getElementById('apply-24h');
  els.applyDay = document.getElementById('apply-day');
  els.applyScan = document.getElementById('apply-scan');
  els.scheduleEnabled = document.getElementById('schedule-enabled');
  els.scheduleStart = document.getElementById('schedule-start');
  els.scheduleStop = document.getElementById('schedule-stop');
  els.scheduleDays = document.getElementById('schedule-days');
  els.scheduleAutoStart = document.getElementById('schedule-autostart');
  els.scheduleFocus = document.getElementById('schedule-focus');
}

/** Monta as caixinhas dos dias da semana (0 = domingo). */
function buildDayInputs() {
  els.scheduleDays.textContent = '';
  els.dayInputs = [];

  DAY_LABELS.forEach((label, day) => {
    const wrapper = document.createElement('label');
    const input = document.createElement('input');

    input.type = 'checkbox';
    input.value = String(day);

    wrapper.appendChild(input);
    wrapper.appendChild(document.createTextNode(label));
    els.scheduleDays.appendChild(wrapper);

    els.dayInputs.push(input);
  });
}

function bindEvents() {
  els.btnStart.addEventListener('click', onStartClick);
  els.btnStop.addEventListener('click', onStopClick);
  els.btnExport.addEventListener('click', onExportClick);
  els.btnClear.addEventListener('click', onClearClick);

  // A configuração é salva sozinha alguns instantes após a digitação parar.
  const textInputs = [els.baseUrl, els.location, els.terms];
  const fieldInputs = [
    els.applyPerTerm,
    els.applyHour,
    els.apply24h,
    els.applyDay,
    els.applyScan,
    els.scheduleStart,
    els.scheduleStop,
  ];

  textInputs.forEach((input) => input.addEventListener('input', onSettingsInput));
  fieldInputs.forEach((input) => input.addEventListener('input', onSettingsInput));

  [els.applyEnabled, els.scheduleEnabled, els.scheduleAutoStart, els.scheduleFocus].forEach(
    (input) => input.addEventListener('change', onSettingsInput)
  );

  els.dayInputs.forEach((input) => input.addEventListener('change', onSettingsInput));

  // Ao sair do campo, "limpa" a lista de termos (sem vazios e sem repetidos).
  els.terms.addEventListener('blur', () => saveSettingsFromForm({ normalizeForm: true }));
}

/* -------------------------------------------------------------------------- */
/* Ações                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Monta a fila de execução e garante que exista uma aba do LinkedIn na URL
 * correta. A fila é gravada em chrome.storage.local: se a aba for recarregada
 * (uma navegação por termo), o content.js retoma a fila sozinho ao carregar.
 */
async function onStartClick() {
  const parsed = await saveSettingsFromForm({ silent: true, normalizeForm: true });

  if (!parsed.baseUrl || !SHARED.isLinkedInUrl(parsed.baseUrl)) {
    setStatus(
      'Configure uma URL do LinkedIn (ex.: https://www.linkedin.com/jobs/search/).',
      'error'
    );
    openSettings();
    els.baseUrl.focus();
    return;
  }

  const tab = await getActiveTab();
  const tabUrl = (tab && tab.url) || '';
  const onLinkedIn = Boolean(tab && tab.id && SHARED.isLinkedInUrl(tabUrl));
  const onJobsPage = onLinkedIn && SHARED.isLinkedInJobsUrl(tabUrl);

  const run = SHARED.buildRunQueue(parsed);

  // Sem termos cadastrados e já na lista de vagas: varre o que está aberto.
  if (!parsed.terms.length && onJobsPage) {
    run.terms = [''];
    run.urls = [''];
    run.term = '';
  }

  // Se o agendador estiver ligado, fora da janela a execução vai esperar.
  const warn = buildWindowWarning(parsed);

  /** Fala na barra de status, avisando do agendador quando for o caso. */
  const say = (message, type) =>
    setStatus(warn ? message + ' ' + warn : message, warn ? 'warn' : type);

  await chrome.storage.local.set({ [STORAGE_RUN_KEY]: run });
  renderRun(run, run.urls.length);

  const firstUrl = run.urls[0];

  // 1) Já estamos na lista de vagas: dispara sem navegar.
  if (firstUrl === '' && onJobsPage) {
    await kickOffTab(tab.id, run, say);
    return;
  }

  // 2) Temos uma aba do LinkedIn: navega até a primeira busca configurada.
  if (onLinkedIn && tab.id) {
    if (tabUrl === firstUrl) {
      await kickOffTab(tab.id, run, say);
      return;
    }

    run.tabId = tab.id;
    await chrome.storage.local.set({ [STORAGE_RUN_KEY]: run });

    say('Navegando para a busca configurada e iniciando a varredura…', 'ok');
    await chrome.tabs.update(tab.id, { url: firstUrl });
    return;
  }

  // 3) Não é uma aba do LinkedIn: abre uma nova aba já na busca configurada.
  say('Abrindo a busca do LinkedIn em uma nova aba…', 'ok');

  const created = await chrome.tabs.create({ url: firstUrl, active: true });

  if (created && created.id) {
    run.tabId = created.id;
    await chrome.storage.local.set({ [STORAGE_RUN_KEY]: run });
  }
}

/** Aviso quando o agendador está ligado e o horário ainda não chegou. */
function buildWindowWarning(parsed) {
  const now = new Date();

  if (!parsed.schedule.enabled) return '';
  if (SHARED.isWithinSchedule(now, parsed.schedule)) return '';

  const next = SHARED.nextScheduleStart(now, parsed.schedule);
  const when = next ? ' às ' + SHARED.formatClock(next.getTime()) : '';

  return 'Fora da janela do agendador' + when + ': a varredura fica aguardando o horário.';
}

/** Dispara a varredura numa aba já carregada e trata a resposta. */
async function kickOffTab(tabId, run, say) {
  const report = typeof say === 'function' ? say : setStatus;

  try {
    // Guardamos o id da aba na fila: é por ele que o agendador cutuca a página
    // depois, quando uma cota libera espaço.
    const payload = Object.assign({}, run, { tabId });
    await chrome.storage.local.set({ [STORAGE_RUN_KEY]: payload });
    run.tabId = tabId;

    const response = await sendToTab(tabId, { type: MSG.START, run: payload });

    if (!response || response.ok === false) {
      report(
        response && response.reason === 'already_scanning'
          ? 'A varredura já está em andamento.'
          : 'Não foi possível iniciar a varredura nesta página.',
        'warn'
      );
      return;
    }

    setScanning(true);
    report('Varredura em andamento. O PegaVaga avança pelos termos sozinho.', 'ok');
  } catch (error) {
    setStatus(
      'Não consegui falar com a página. Recarregue o LinkedIn (F5) e tente de novo.',
      'error'
    );
  }
}

async function onStopClick() {
  // Remover a fila primeiro garante que o content.js não avance para o próximo
  // termo, mesmo que a aba que está varrendo não seja a aba ativa.
  await chrome.storage.local.remove(STORAGE_RUN_KEY);

  const tab = await getActiveTab();
  if (tab && tab.id) {
    try {
      await sendToTab(tab.id, { type: MSG.STOP });
    } catch (error) {
      /* a página pode ter sido fechada; ignoramos */
    }
  }

  renderRun(null);
  setScanning(false);
  setStatus('Varredura interrompida.', 'warn');
}

async function onClearClick() {
  await chrome.storage.local.remove(STORAGE_RUN_KEY);

  const tab = await getActiveTab();
  if (tab && tab.id) {
    try {
      await sendToTab(tab.id, { type: MSG.CLEAR });
    } catch (error) {
      /* ignoramos */
    }
  }

  await chrome.storage.local.remove([STORAGE_JOBS_KEY, STORAGE_META_KEY]);
  await refresh();
  renderRun(null);
  setStatus('Dados limpos.', 'ok');
}


/* -------------------------------------------------------------------------- */
/* Configuração da busca                                                       */
/* -------------------------------------------------------------------------- */

async function loadSettingsToForm() {
  settings = await getSettings();

  els.baseUrl.value = settings.baseUrl;
  els.location.value = settings.location;
  els.terms.value = settings.terms.join('\n');

  els.applyEnabled.checked = settings.apply.enabled;
  els.applyPerTerm.value = String(settings.apply.perTerm);
  els.applyHour.value = String(settings.apply.perHour);
  els.apply24h.value = String(settings.apply.per24h);
  els.applyDay.value = String(settings.apply.perDay);
  els.applyScan.value = String(settings.apply.scanPerTerm);

  els.scheduleEnabled.checked = settings.schedule.enabled;
  els.scheduleStart.value = settings.schedule.startTime;
  els.scheduleStop.value = settings.schedule.stopTime;
  els.scheduleAutoStart.checked = settings.schedule.autoStart;
  els.scheduleFocus.checked = settings.schedule.focusTab;

  els.dayInputs.forEach((input) => {
    input.checked = settings.schedule.days.includes(Number(input.value));
  });

  renderQuota();
  renderScheduleHint();
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  return SHARED.parseSettings(data[STORAGE_SETTINGS_KEY]);
}

function onSettingsInput() {
  els.settingsHint.className = 'hint';
  els.settingsHint.textContent = 'Salvando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettingsFromForm(), SAVE_DELAY_MS);
}

/** Lê o formulário (busca + cotas + agendador) e grava no storage. */
async function saveSettingsFromForm(options) {
  const silent = Boolean(options && options.silent);
  const normalizeForm = Boolean(options && options.normalizeForm);

  const parsed = SHARED.parseSettings({
    baseUrl: els.baseUrl.value,
    location: els.location.value,
    terms: els.terms.value,
    apply: {
      enabled: els.applyEnabled.checked,
      perTerm: els.applyPerTerm.value,
      perHour: els.applyHour.value,
      per24h: els.apply24h.value,
      perDay: els.applyDay.value,
      scanPerTerm: els.applyScan.value,
    },
    schedule: {
      enabled: els.scheduleEnabled.checked,
      autoStart: els.scheduleAutoStart.checked,
      startTime: els.scheduleStart.value,
      stopTime: els.scheduleStop.value,
      days: els.dayInputs.filter((input) => input.checked).map((input) => Number(input.value)),
      focusTab: els.scheduleFocus.checked,
    },
  });

  // Só mexemos nos campos quando não estamos no meio da digitação.
  if (normalizeForm) {
    const normalizedText = parsed.terms.join('\n');
    if (els.terms.value !== normalizedText) els.terms.value = normalizedText;

    els.applyPerTerm.value = String(parsed.apply.perTerm);
    els.applyHour.value = String(parsed.apply.perHour);
    els.apply24h.value = String(parsed.apply.per24h);
    els.applyDay.value = String(parsed.apply.perDay);
    els.applyScan.value = String(parsed.apply.scanPerTerm);
  }

  settings = parsed;
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: parsed });

  renderQuota();
  renderScheduleHint();

  if (!silent) {
    els.settingsHint.className = 'hint ok';
    els.settingsHint.textContent =
      'Salvo automaticamente às ' + new Date().toLocaleTimeString('pt-BR') + '.';
  }

  return parsed;
}

function openSettings() {
  els.settings.open = true;
}

/* -------------------------------------------------------------------------- */
/* Leitura de dados                                                            */
/* -------------------------------------------------------------------------- */

async function getJobsArray() {
  const data = await chrome.storage.local.get([STORAGE_JOBS_KEY, STORAGE_META_KEY]);
  const map = data[STORAGE_JOBS_KEY] || {};

  return Object.values(map).sort((a, b) =>
    String(a.title || '').localeCompare(String(b.title || ''), 'pt-BR')
  );
}

async function getMeta() {
  const data = await chrome.storage.local.get(STORAGE_META_KEY);
  return data[STORAGE_META_KEY] || null;
}

async function getRun() {
  const data = await chrome.storage.local.get(STORAGE_RUN_KEY);
  runCache = data[STORAGE_RUN_KEY] || null;
  return runCache;
}

/** Histórico de candidaturas (base das cotas por hora/24 h/dia). */
async function loadAppsCache() {
  try {
    const data = await chrome.storage.local.get(STORAGE_APPS_KEY);
    const list = data[STORAGE_APPS_KEY];
    appsCache = Array.isArray(list) ? list.filter((ts) => Number.isFinite(ts)) : [];
  } catch (error) {
    appsCache = [];
  }

  return appsCache;
}

/* -------------------------------------------------------------------------- */
/* Render                                                                      */
/* -------------------------------------------------------------------------- */

async function refresh() {
  const jobs = await getJobsArray();
  const meta = await getMeta();

  await loadAppsCache();

  els.count.textContent = String(jobs.length);

  if (meta && meta.lastRun) {
    const when = new Date(meta.lastRun);
    els.lastRun.textContent = isNaN(when.getTime())
      ? 'Última varredura: —'
      : 'Última varredura: ' + when.toLocaleString('pt-BR');
  } else {
    els.lastRun.textContent = 'Nenhuma varredura realizada';
  }

  els.btnExport.disabled = jobs.length === 0;
  renderQuota();
}

/** Linha de cotas: quantas candidaturas cabem agora em cada janela. */
function renderQuota() {
  if (!els.quotaInfo) return;

  const quota = SHARED.computeQuota(
    settings,
    appsCache,
    Date.now(),
    (runCache && runCache.appliedInTerm) || 0
  );

  els.quotaInfo.textContent = SHARED.describeQuota(quota);
}

/** Explica o agendador: janela, próxima abertura ou pausa por cota. */
function renderScheduleHint() {
  if (!els.scheduleHint) return;

  const now = new Date();
  const paused = runCache && runCache.paused && runCache.resumeAt;

  if (paused) {
    els.scheduleHint.className = 'hint';
    els.scheduleHint.textContent =
      'Pausado por cota até ' +
      SHARED.formatClock(runCache.resumeAt) +
      '. ' +
      SHARED.describeSchedule(settings.schedule, now);
    return;
  }

  els.scheduleHint.className = 'hint' + (settings.schedule.enabled ? ' ok' : '');
  els.scheduleHint.textContent = SHARED.describeSchedule(settings.schedule, now);
}

/** Mostra na interface em qual termo da fila a varredura está. */
function renderRun(run, totalFallback) {
  runCache = run || null;

  renderQuota();
  renderScheduleHint();

  if (run && run.running) {
    const total =
      totalFallback || (Array.isArray(run.urls) ? run.urls.length : 1) || 1;
    const label = run.term ? `"${run.term}"` : 'página atual';

    let info =
      total > 1
        ? `Termo ${(run.index || 0) + 1} de ${total}: ${label}`
        : `Buscando ${label}`;

    if (settings.apply.enabled) {
      info += ` · ${run.appliedInTerm || 0} candidatura(s) neste termo`;
    }

    if (run.paused && run.resumeAt) {
      info += ` · pausado até ${SHARED.formatClock(run.resumeAt)}`;
    }

    els.runInfo.textContent = info;
    els.runInfo.hidden = false;
    return;
  }

  els.runInfo.hidden = true;
  els.runInfo.textContent = '';
}

/** Descobre se há varredura em andamento (fila no storage ou ping na aba). */
async function syncScanningState() {
  const run = await getRun();
  renderRun(run);

  let scanning = Boolean(run && run.running);

  const tab = await getActiveTab();
  if (tab && tab.id) {
    try {
      const response = await sendToTab(tab.id, { type: MSG.PING });
      scanning = scanning || Boolean(response && response.scanning);
    } catch (error) {
      /* aba sem content script: mantém o que a fila informou */
    }
  }

  setScanning(scanning);
}

function setScanning(isScanning) {
  els.btnStart.disabled = isScanning;
  els.btnStop.disabled = !isScanning;
}

function setStatus(message, type) {
  els.status.textContent = message;
  els.status.className = 'status' + (type ? ' ' + type : '');
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

function buildCSV(jobs) {
  const rows = [CSV_HEADERS];

  for (const job of jobs) {
    rows.push([
      job.id || '',
      job.title || '',
      job.company || '',
      job.link || '',
      job.description || '',
      formatDate(job.capturedAt),
      job.term || '',
      APPLY_STATUS_LABELS[job.applyStatus] || job.applyStatus || '',
      formatDate(job.appliedAt),
    ]);
  }

  const body = rows.map((row) => row.map(escapeCSVField).join(CSV_SEPARATOR));

  // \uFEFF (BOM) garante que o Excel reconheça o arquivo como UTF-8.
  return '\uFEFF' + body.join('\r\n');
}

function escapeCSVField(value) {
  const text = String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  // Sempre entre aspas: protege separadores, quebras de linha e acentos.
  return '"' + text.replace(/"/g, '""') + '"';
}

function formatDate(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return isNaN(date.getTime()) ? '' : date.toLocaleString('pt-BR');
}

/* -------------------------------------------------------------------------- */
/* Download                                                                    */
/* -------------------------------------------------------------------------- */

function downloadFile(content, filename) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Libera a memória depois que o download já foi iniciado.
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function timestampForFilename() {
  return new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19);
}

/* -------------------------------------------------------------------------- */
/* Utilidades de mensageria                                                    */
/* -------------------------------------------------------------------------- */

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0];
}

function sendToTab(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(response);
    });
  });
}

function onRuntimeMessage(message) {
  if (!message || message.type !== MSG.PROGRESS) return;

  els.count.textContent = String(message.count || 0);
  renderRun(message.run);
  setScanning(
    Boolean(message.scanning) || Boolean(message.run && message.run.running)
  );
}

function onStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;

  if (changes[STORAGE_JOBS_KEY]) refresh();

  if (changes[STORAGE_SETTINGS_KEY] && changes[STORAGE_SETTINGS_KEY].newValue) {
    settings = SHARED.parseSettings(changes[STORAGE_SETTINGS_KEY].newValue);
  }

  if (changes[STORAGE_APPS_KEY]) {
    const list = changes[STORAGE_APPS_KEY].newValue;
    appsCache = Array.isArray(list) ? list.filter((ts) => Number.isFinite(ts)) : [];
  }

  if (
    changes[STORAGE_APPS_KEY] ||
    changes[STORAGE_SETTINGS_KEY] ||
    changes[STORAGE_RUN_KEY]
  ) {
    renderQuota();
    renderScheduleHint();
  }

  if (changes[STORAGE_RUN_KEY]) {
    const run = changes[STORAGE_RUN_KEY].newValue || null;
    renderRun(run);
    setScanning(Boolean(run && run.running));
  }
}

async function onExportClick() {
  const jobs = await getJobsArray();

  if (!jobs.length) {
    setStatus('Nenhuma vaga capturada ainda. Rode a varredura primeiro.', 'warn');
    return;
  }

  try {
    const csv = buildCSV(jobs);
    downloadFile(csv, `pegavaga_${timestampForFilename()}.csv`);
    setStatus(`${jobs.length} vaga(s) exportada(s) com sucesso.`, 'ok');
  } catch (error) {
    setStatus('Falha ao gerar o arquivo: ' + error.message, 'error');
  }
}
