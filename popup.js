/* =============================================================================
 * PegaVaga - popup.js
 * Interface do usuário: cadastra a busca (URL/perfil + termos), configura as
 * cotas de candidatura, o ritmo humano (furtividade) e o agendador, abre a aba
 * do LinkedIn quando necessário, dispara a varredura no content.js, mostra
 * contador/cotas e gera o .csv — inclusive o das vagas que não deu para
 * candidatar, com o motivo de cada uma.
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
const STORAGE_GUARD_KEY = SHARED.STORAGE.guard;

const CSV_HEADERS = [
  'ID',
  'Titulo',
  'Empresa',
  'Link',
  'Descricao',
  'Capturado em',
  'Termo',
  'Status da candidatura',
  'Motivo da nao candidatura',
  'Tentativas',
  'Candidatado em',
];

/* CSV enxuto, só com o que não deu para candidatar (e o porquê). */
const FAILURE_CSV_HEADERS = [
  'ID',
  'Titulo',
  'Empresa',
  'Link',
  'Termo',
  'Status',
  'Motivo',
  'Ultima tentativa',
];

const CSV_SEPARATOR = ';'; // Excel pt-BR usa ponto e vírgula como separador padrão

/** Como cada motivo de pausa aparece para o usuário (definido no shared.js). */
const PAUSE_LABELS = SHARED.PAUSE_REASON_LABELS;

const SAVE_DELAY_MS = 400; // debounce do salvamento automático da configuração
const TOAST_MS = 7000; // quanto tempo o aviso do rodapé fica na tela
const DAY_LABELS = SHARED.WEEKDAYS;

/* -------------------------------------------------------------------------- */
/* Elementos da interface                                                      */
/* -------------------------------------------------------------------------- */

const els = {};
let saveTimer = null;
let statusTimer = null;
let selectTab = null; // troca de aba (Início / Configurações)
let settings = SHARED.parseSettings(null);
let appsCache = [];
let runCache = null;
let breakCache = null;
let guardCache = null; // proteção da conta em vigor (ou null)
let scanCache = false; // o content script está varrendo agora?

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  buildDayInputs();
  bindEvents();
  bindChartTips();
  bindTabs();

  await loadSettingsToForm();
  await refresh();
  await loadGuard();
  await syncScanningState();

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function cacheElements() {
  els.statusLight = document.getElementById('status-light');
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
  els.easyApplyOnly = document.getElementById('easy-apply-only');
  els.terms = document.getElementById('terms');
  els.termsPreview = document.getElementById('terms-preview');
  els.termsQueue = document.getElementById('terms-queue');
  els.settingsHint = document.getElementById('settings-hint');
  els.scheduleHint = document.getElementById('schedule-hint');
  els.applyEnabled = document.getElementById('apply-enabled');
  els.applyHelpStuck = document.getElementById('apply-help-stuck');
  els.applyPerTerm = document.getElementById('apply-per-term');
  els.applyHour = document.getElementById('apply-hour');
  els.apply24h = document.getElementById('apply-24h');
  els.applyDay = document.getElementById('apply-day');
  els.applyScan = document.getElementById('apply-scan');
  els.applyRespectUser = document.getElementById('apply-respect-user');
  els.applyBreaks = document.getElementById('apply-breaks');
  els.applyDelayMin = document.getElementById('apply-delay-min');
  els.applyDelayMax = document.getElementById('apply-delay-max');
  els.applyBreakEvery = document.getElementById('apply-break-every');
  els.applyBreakSeconds = document.getElementById('apply-break-seconds');
  els.applyFillRequired = document.getElementById('apply-fill-required');
  els.applyAnswerYes = document.getElementById('apply-answer-yes');
  els.applyAnswerNumber = document.getElementById('apply-answer-number');
  els.applyAnswerText = document.getElementById('apply-answer-text');
  els.applySummary = document.getElementById('apply-summary');
  els.guardInfo = document.getElementById('guard-info');
  els.helpInfo = document.getElementById('help-info');
  els.btnSkip = document.getElementById('btn-skip');
  els.runChip = document.getElementById('run-chip');
  els.statusText = document.getElementById('status-text');
  els.emptyState = document.getElementById('empty-state');
  els.runCard = document.getElementById('run-card');
  els.termProgress = document.getElementById('term-progress');
  els.spark = document.getElementById('spark');
  els.sparkCard = document.getElementById('spark-card');
  els.sparkHint = document.getElementById('spark-hint');
  els.btnExportFailures = document.getElementById('btn-export-failures');
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
  els.btnSkip.addEventListener('click', onSkipClick);
  els.btnExport.addEventListener('click', onExportClick);
  els.btnExportFailures.addEventListener('click', onExportFailuresClick);
  els.btnClear.addEventListener('click', onClearClick);

  // A configuração é salva sozinha alguns instantes após a digitação parar.
  const textInputs = [els.baseUrl, els.location, els.terms];
  const fieldInputs = [
    els.applyPerTerm,
    els.applyHour,
    els.apply24h,
    els.applyDay,
    els.applyScan,
    els.applyDelayMin,
    els.applyDelayMax,
    els.applyBreakEvery,
    els.applyBreakSeconds,
    els.applyAnswerNumber,
    els.applyAnswerText,
    els.scheduleStart,
    els.scheduleStop,
  ];

  textInputs.forEach((input) => input.addEventListener('input', onSettingsInput));
  fieldInputs.forEach((input) => input.addEventListener('input', onSettingsInput));

  [
    els.applyEnabled,
    els.applyHelpStuck,
    els.applyRespectUser,
    els.applyBreaks,
    els.applyFillRequired,
    els.applyAnswerYes,
    els.easyApplyOnly,
    els.scheduleEnabled,
    els.scheduleAutoStart,
    els.scheduleFocus,
  ].forEach((input) => input.addEventListener('change', onSettingsInput));

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
  // Com o filtro de Candidatura Simplificada ligado preferimos navegar para a URL
  // montada, que já leva o parâmetro f_AL=true (a página aberta pode não tê-lo).
  if (!parsed.terms.length && onJobsPage && !parsed.easyApplyOnly) {
    run.terms = [''];
    run.urls = [''];
    run.term = '';
  }

  // Resumo da fila, usado nas mensagens de início ("3 termos em loop (a → b)").
  const queue = describeQueue(run);

  // Se o agendador estiver ligado (ou a proteção da conta ativa), a execução
  // vai esperar: avisamos no mesmo lugar.
  const warn = buildWindowWarning(parsed) || buildGuardWarning(await getGuard());

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

    say(
      'Navegando para a primeira busca' +
        (queue ? ' (' + queue + ')' : '') +
        ' e iniciando a varredura…',
      'ok'
    );
    await chrome.tabs.update(tab.id, { url: firstUrl });
    return;
  }

  // 3) Não é uma aba do LinkedIn: abre uma nova aba já na busca configurada.
  say(
    'Abrindo a busca do LinkedIn em uma nova aba' +
      (queue ? ' (' + queue + ')' : '') +
      '…',
    'ok'
  );

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

    const queue = describeQueue(run);
    report(
      'Varredura em andamento' +
        (queue ? ': ' + queue : '.') +
        ' O PegaVaga avança pelos termos sozinho.',
      'ok'
    );
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

/**
 * "Pular vaga atual": a vaga que está esperando a sua ajuda é cancelada e a
 * varredura vai para a próxima. O pedido vai pelo service worker, que sabe qual
 * aba do LinkedIn está com o formulário aberto.
 */
async function onSkipClick() {
  try {
    const response = await chrome.runtime.sendMessage({ type: MSG.SKIP });

    if (response && response.ok) {
      setStatus('Pulando a vaga atual: cancelando e indo para a próxima.', 'warn');
    } else {
      setStatus('Nenhuma vaga esperando ajuda agora.', 'warn');
    }
  } catch (error) {
    setStatus('Não consegui pular a vaga agora. Tente de novo.', 'error');
  }
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
  els.easyApplyOnly.checked = settings.easyApplyOnly;
  els.terms.value = settings.terms.join('\n');

  els.applyEnabled.checked = settings.apply.enabled;
  els.applyHelpStuck.checked = settings.apply.helpOnStuck;
  els.applyPerTerm.value = String(settings.apply.perTerm);
  els.applyHour.value = String(settings.apply.perHour);
  els.apply24h.value = String(settings.apply.per24h);
  els.applyDay.value = String(settings.apply.perDay);
  els.applyScan.value = String(settings.apply.scanPerTerm);
  els.applyRespectUser.checked = settings.apply.respectUserActivity;
  els.applyBreaks.checked = settings.apply.breaksEnabled;
  els.applyDelayMin.value = String(secondsFromMs(settings.apply.minDelayMs));
  els.applyDelayMax.value = String(secondsFromMs(settings.apply.maxDelayMs));
  els.applyBreakEvery.value = String(settings.apply.breakEvery);
  els.applyBreakSeconds.value = String(secondsFromMs(settings.apply.breakMs));
  els.applyFillRequired.checked = settings.apply.fillRequired;
  els.applyAnswerYes.value = settings.apply.answerYes ? 'yes' : 'no';
  els.applyAnswerNumber.value = String(settings.apply.answerNumber);
  els.applyAnswerText.value = settings.apply.answerText;

  els.scheduleEnabled.checked = settings.schedule.enabled;
  els.scheduleStart.value = settings.schedule.startTime;
  els.scheduleStop.value = settings.schedule.stopTime;
  els.scheduleAutoStart.checked = settings.schedule.autoStart;
  els.scheduleFocus.checked = settings.schedule.focusTab;

  els.dayInputs.forEach((input) => {
    input.checked = settings.schedule.days.includes(Number(input.value));
  });

  renderTermsQueue();
  renderQuota();
  renderScheduleHint();
}

async function getSettings() {
  const data = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
  return SHARED.parseSettings(data[STORAGE_SETTINGS_KEY]);
}

/** O formulário mostra segundos; o storage guarda milissegundos. */
function secondsFromMs(value) {
  return Math.max(1, Math.round((Number(value) || 0) / 1000));
}

function msFromSeconds(value, fallbackMs) {
  const seconds = Number(String(value == null ? '' : value).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) return fallbackMs;
  return Math.round(seconds * 1000);
}

function onSettingsInput() {
  renderTermsQueue(); // a fila de busca aparece na hora, antes de salvar
  els.settingsHint.className = 'hint';
  els.settingsHint.textContent = 'Salvando…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSettingsFromForm(), SAVE_DELAY_MS);
}

/**
 * Mostra, embaixo do campo, a fila de busca que vai rodar: os termos na ordem
 * digitada, um por vez, em loop. É o que deixa visível que vários termos foram
 * cadastrados (e não um único termo gigante).
 */
function renderTermsQueue() {
  const terms = SHARED.normalizeTerms(els.terms.value);
  const baseUrl = els.baseUrl.value || SHARED.DEFAULT_SETTINGS.baseUrl;
  const location = els.location.value;
  const easyApplyOnly = els.easyApplyOnly.checked;

  els.termsPreview.textContent = '';

  terms.forEach((term, index) => {
    const item = document.createElement('li');
    const order = document.createElement('b');

    order.textContent = String(index + 1) + '. ';
    item.appendChild(order);
    item.appendChild(document.createTextNode(term));
    // a busca de cada termo (já com o filtro de Candidatura Simplificada, se ligado)
    item.title = SHARED.buildSearchUrl(baseUrl, term, location, easyApplyOnly);

    els.termsPreview.appendChild(item);
  });

  els.termsPreview.hidden = !terms.length;
  els.termsQueue.className = 'hint';
  els.termsQueue.textContent = terms.length
    ? 'A busca roda em loop, um termo por vez, nesta ordem (' +
      terms.length +
      (terms.length === 1 ? ' termo' : ' termos') +
      '). Passe o mouse sobre cada um para ver a busca.'
    : 'Sem termos: a varredura percorre a página de vagas que estiver aberta.';
}

/** Resume a fila que vai rodar: "3 termos em loop (react → node.js → vue)". */
function describeQueue(run) {
  const terms = (run && Array.isArray(run.terms) ? run.terms : []).filter(Boolean);
  if (!terms.length) return '';
  if (terms.length === 1) return 'Termo: ' + terms[0] + '.';

  const shown = terms.slice(0, 5).join(' → ') + (terms.length > 5 ? ' → …' : '');
  return terms.length + ' termos em loop (' + shown + ').';
}

/** Lê o formulário (busca + cotas + agendador) e grava no storage. */
async function saveSettingsFromForm(options) {
  const silent = Boolean(options && options.silent);
  const normalizeForm = Boolean(options && options.normalizeForm);

  const parsed = SHARED.parseSettings({
    baseUrl: els.baseUrl.value,
    location: els.location.value,
    easyApplyOnly: els.easyApplyOnly.checked,
    terms: els.terms.value,
    apply: {
      enabled: els.applyEnabled.checked,
      helpOnStuck: els.applyHelpStuck.checked,
      perTerm: els.applyPerTerm.value,
      perHour: els.applyHour.value,
      per24h: els.apply24h.value,
      perDay: els.applyDay.value,
      scanPerTerm: els.applyScan.value,
      minDelayMs: msFromSeconds(els.applyDelayMin.value, settings.apply.minDelayMs),
      maxDelayMs: msFromSeconds(els.applyDelayMax.value, settings.apply.maxDelayMs),
      respectUserActivity: els.applyRespectUser.checked,
      breaksEnabled: els.applyBreaks.checked,
      breakEvery: els.applyBreakEvery.value,
      breakMs: msFromSeconds(els.applyBreakSeconds.value, settings.apply.breakMs),
      fillRequired: els.applyFillRequired.checked,
      answerYes: els.applyAnswerYes.value === 'yes',
      answerNumber: els.applyAnswerNumber.value,
      answerText: els.applyAnswerText.value,
      answers: settings.apply.answers, // respostas específicas: só o storage as guarda
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
    els.applyBreakEvery.value = String(parsed.apply.breakEvery);
  }

  settings = parsed;
  await chrome.storage.local.set({ [STORAGE_SETTINGS_KEY]: parsed });

  renderTermsQueue();
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
  if (selectTab) selectTab(1); // leva para a aba "Configurações"
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

  // Estado vazio: ilustração + convite, quando ainda não capturei nada.
  if (els.emptyState) els.emptyState.hidden = jobs.length > 0;

  if (meta && meta.lastRun) {
    const when = new Date(meta.lastRun);
    els.lastRun.textContent = isNaN(when.getTime())
      ? 'Última varredura: —'
      : 'Última varredura: ' + when.toLocaleString('pt-BR');
  } else {
    els.lastRun.textContent = 'Nenhuma varredura realizada';
  }

  els.btnExport.disabled = jobs.length === 0;
  renderApplySummary(jobs);
  renderQuota();
  renderSpark();
}

/**
 * Resumo do relatório: quantas vagas foram candidatadas, quantas não foram e,
 * no fim, o motivo mais frequente. Também liga/desliga o botão de exportar só
 * as não candidatadas.
 */
function renderApplySummary(jobs) {
  const summary = SHARED.summarizeApply(jobs, { applyEnabled: settings.apply.enabled });

  renderDonut(summary);
  renderLegend(summary);

  if (els.btnExportFailures) {
    els.btnExportFailures.disabled = summary.failed + summary.pending === 0;
    els.btnExportFailures.title = summary.failed
      ? summary.failed + ' vaga(s) definitivamente não candidatada(s)'
      : 'Vagas que ainda não foram candidatadas';
  }
}

/** Situações do resumo, na ordem em que aparecem no donut e na legenda. */
const SUMMARY_PARTS = [
  { key: 'applied', label: 'nesta sessão', color: 'var(--ok)', tip: 'Vagas candidatadas nesta sessão' },
  { key: 'already', label: 'antes', color: 'var(--brand)', tip: 'Vagas já candidatadas antes' },
  { key: 'failed', label: 'não candidatada(s)', color: 'var(--danger)', tip: 'Vagas não candidatadas' },
  { key: 'pending', label: 'na fila', color: '#94a3b8', tip: 'Vagas na fila' },
];

/** Pinta os anéis do donut conforme o resumo (arcos empilhados). */
function renderDonut(summary) {
  const total = summary.total || 0;
  const circumference = 2 * Math.PI * 38;
  let offset = 0;

  for (const part of SUMMARY_PARTS) {
    const seg = document.getElementById('seg-' + part.key);
    if (!seg) continue;

    const length = total ? (summary[part.key] / total) * circumference : 0;
    seg.setAttribute('stroke', part.color);
    seg.setAttribute('stroke-dasharray', length + ' ' + (circumference - length));
    seg.setAttribute('stroke-dashoffset', String(-offset));
    seg.setAttribute('data-tip', part.tip + ': ' + summary[part.key]);
    offset += length;
  }
}

/** Legenda do donut: um item por situação (só as que têm vaga). */
function renderLegend(summary) {
  if (!els.applySummary) return;

  els.applySummary.innerHTML = SUMMARY_PARTS.filter((part) => summary[part.key] > 0)
    .map(
      (part) =>
        '<li data-key="' +
        part.key +
        '" data-tip="' +
        part.tip +
        ': ' +
        summary[part.key] +
        '"><i style="background:' +
        part.color +
        '"></i><b>' +
        summary[part.key] +
        '</b> ' +
        part.label +
        '</li>'
    )
    .join('');

  els.applySummary.title = SHARED.describeApplySummary(summary);
}

/** Faixa de aviso quando a proteção da conta (limite do LinkedIn) está ligada. */
function renderGuard(guard) {
  guardCache = guard || null;
  renderStatusLight();

  if (!els.guardInfo) return;

  const active = guard && guard.blockedUntil > Date.now();

  if (!active) {
    els.guardInfo.hidden = true;
    els.guardInfo.textContent = '';
    return;
  }

  els.guardInfo.hidden = false;
  els.guardInfo.textContent =
    '⛔ LinkedIn sinalizou limite de uso' +
    (guard.reason ? ' (' + guard.reason + ')' : '') +
    ': a automação está descansando até ' +
    SHARED.formatClock(guard.blockedUntil) +
    '. Aproveite para revisar as vagas já capturadas.';
}

/** Reativa o aviso de proteção gravado no storage. */
async function loadGuard() {
  renderGuard(await getGuard());
}

/** Proteção da conta ativa (ou null), lida do storage. */
async function getGuard() {
  try {
    const data = await chrome.storage.local.get(STORAGE_GUARD_KEY);
    const guard = data[STORAGE_GUARD_KEY] || null;
    return guard && guard.blockedUntil > Date.now() ? guard : null;
  } catch (error) {
    return null;
  }
}

/** Aviso quando o LinkedIn sinalizou limite de uso e a extensão está descansando. */
function buildGuardWarning(guard) {
  if (!guard) return '';

  return (
    'O LinkedIn sinalizou limite de uso: a automação fica parada até ' +
    SHARED.formatClock(guard.blockedUntil) +
    '.'
  );
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

  // Barras: usadas/limite de cada janela (a que estourou fica vermelha).
  const rows = [
    { label: 'Nesta sessão (termo)', used: quota.used.term, limit: quota.limits.term },
    { label: 'Última hora', used: quota.used.hour, limit: quota.limits.hour },
    { label: 'Últimas 24 h', used: quota.used.day24, limit: quota.limits.day24 },
    { label: 'Hoje', used: quota.used.day, limit: quota.limits.day },
  ].filter((row) => Number.isFinite(row.limit));

  els.quotaInfo.innerHTML = rows
    .map((row) => {
      const pct = row.limit > 0 ? Math.min(100, Math.round((row.used / row.limit) * 100)) : 0;
      return (
        '<div class="qbar" data-tip="' +
        row.label +
        ': ' +
        row.used +
        ' de ' +
        row.limit +
        ' usadas">' +
        '<div class="qbar-top"><span>' +
        row.label +
        '</span><b>' +
        row.used +
        '/' +
        row.limit +
        '</b></div>' +
        '<div class="qbar-track"><span class="qbar-fill' +
        (pct >= 100 ? ' full' : '') +
        '" style="width:' +
        pct +
        '%"></span></div>' +
        '</div>'
      );
    })
    .join('');

  els.quotaInfo.title = SHARED.describeQuota(quota);
}

/**
 * Mini-gráfico de barras: candidaturas enviadas por hora nas últimas 24 h.
 * Sai de `appsCache` (os timestamps que já guardamos para as cotas).
 */
function renderSpark() {
  if (!els.sparkCard || !els.spark) return;

  const now = Date.now();
  const buckets = new Array(24).fill(0);

  for (const ts of appsCache) {
    const age = now - ts;
    if (age < 0 || age >= 24 * 3600000) continue;

    const index = 23 - Math.floor(age / 3600000);
    if (index >= 0 && index < 24) buckets[index] += 1;
  }

  const total = buckets.reduce((sum, n) => sum + n, 0);
  const max = Math.max(1, ...buckets);
  const barWidth = 320 / 24;

  els.spark.innerHTML = buckets
    .map((count, i) => {
      const height = count ? Math.max(3, Math.round((count / max) * 40)) : 2;
      const hoursAgo = 23 - i;
      const when = hoursAgo === 0 ? 'nesta hora' : 'há ' + hoursAgo + ' h';

      return (
        '<rect' +
        (i === 23 ? ' class="now"' : '') +
        ' data-tip="' +
        when +
        ': ' +
        count +
        ' candidatura(s)"' +
        ' x="' +
        (i * barWidth + 1.5).toFixed(1) +
        '" y="' +
        (44 - height) +
        '" width="' +
        (barWidth - 3).toFixed(1) +
        '" height="' +
        height +
        '" rx="1.5"></rect>'
      );
    })
    .join('');

  els.sparkCard.hidden = total === 0;
  els.sparkHint.textContent = total
    ? total + ' candidatura(s) nas últimas 24 h (' + max + ' na hora de pico).'
    : '';
}

/**
 * Tooltip dos gráficos + destaque cruzado.
 *
 * Qualquer elemento com `data-tip` mostra o balão ao passar o mouse (o texto sai
 * do próprio atributo, que o render acabou de escrever). Passar o mouse por um
 * item da legenda acende o anel correspondente no donut.
 */
function bindChartTips() {
  const tip = document.getElementById('chart-tip');

  document.addEventListener('mousemove', (event) => {
    if (!tip) return;

    const el =
      event.target && event.target.closest ? event.target.closest('[data-tip]') : null;

    if (!el) {
      tip.hidden = true;
      return;
    }

    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;

    const box = tip.getBoundingClientRect();
    const half = box.width / 2 + 6;
    const x = Math.min(Math.max(event.clientX, half), window.innerWidth - half);
    const y = Math.max(event.clientY, box.height + 12);

    tip.style.left = Math.round(x) + 'px';
    tip.style.top = Math.round(y) + 'px';
  });

  // Legenda -> anel do donut.
  const highlight = (on) => (event) => {
    const item =
      event.target && event.target.closest
        ? event.target.closest('#apply-summary li[data-key]')
        : null;

    if (!item) return;

    const seg = document.getElementById('seg-' + item.getAttribute('data-key'));
    if (seg) seg.classList.toggle('hi', on);
  };

  document.addEventListener('mouseover', highlight(true));
  document.addEventListener('mouseout', highlight(false));
}

/**
 * Abas Início / Configurações: mostra um painel por vez e marca a aba ativa em
 * `aria-selected` (é o CSS que desenha o destaque).
 */
function bindTabs() {
  const entries = [
    { tab: document.getElementById('tab-home'), pane: document.getElementById('pane-home') },
    { tab: document.getElementById('tab-config'), pane: document.getElementById('settings') },
  ].filter((entry) => entry.tab && entry.pane);

  selectTab = (index) => {
    entries.forEach((entry, i) => {
      const on = i === index;
      entry.tab.setAttribute('aria-selected', on ? 'true' : 'false');
      entry.pane.hidden = !on;
    });

    window.scrollTo(0, 0);
  };

  entries.forEach((entry, i) => entry.tab.addEventListener('click', () => selectTab(i)));
}

/** Explica o agendador: janela, próxima abertura ou pausa por cota. */
function renderScheduleHint() {
  if (!els.scheduleHint) return;

  const now = new Date();
  const paused = runCache && runCache.paused && runCache.resumeAt;

  if (paused) {
    const why = PAUSE_LABELS[runCache.pauseReason] || 'cota de candidaturas';
    els.scheduleHint.className = 'hint';
    els.scheduleHint.textContent =
      'Pausado por ' +
      why +
      ' até ' +
      SHARED.formatClock(runCache.resumeAt) +
      '. ' +
      SHARED.describeSchedule(settings.schedule, now);
    return;
  }

  els.scheduleHint.className = 'hint' + (settings.schedule.enabled ? ' ok' : '');
  els.scheduleHint.textContent = SHARED.describeSchedule(settings.schedule, now);
}

/** Mostra na interface em qual termo da fila a varredura está. */
function renderRun(run, totalFallback, breakUntil) {
  runCache = run || null;
  if (breakUntil) breakCache = breakUntil;
  if (!breakUntil && !(run && run.running)) breakCache = null;

  renderQuota();
  renderScheduleHint();
  renderStatusLight();
  renderHelp(run);

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
      const why = PAUSE_LABELS[run.pauseReason] || 'cota de candidaturas';
      info += ` · pausado por ${why} até ${SHARED.formatClock(run.resumeAt)}`;
    }

    if (breakCache) {
      info += ` · descansando até ${SHARED.formatClock(breakCache)}`;
    }

    if (run.problem) {
      info += ` · ⚠ ${run.problem}`; // mesmo aviso da luz vermelha do ícone
    }

    els.runInfo.textContent = info;
    if (els.runCard) els.runCard.hidden = false;

    // Barra de progresso da fila (termo 1 de N).
    if (els.termProgress) {
      const pct = total > 1 ? Math.round((((run.index || 0) + 1) / total) * 100) : 100;
      els.termProgress.style.width = pct + '%';
    }
    return;
  }

  if (els.runCard) els.runCard.hidden = true;
  els.runInfo.textContent = '';
}

/**
 * Faixa "PegaVaga precisa de ajuda": aparece quando uma vaga travou num campo
 * que só você preenche. Enquanto isso, o botão "Pular vaga atual" fica ativo.
 */
function renderHelp(run) {
  if (!els.helpInfo) return;

  const active = Boolean(run && run.running && run.needsHelp);

  els.helpInfo.hidden = !active;
  if (els.btnSkip) els.btnSkip.disabled = !active;

  if (!active) {
    els.helpInfo.textContent = '';
    return;
  }

  els.helpInfo.textContent =
    '✋ PegaVaga precisa de ajuda: não consegui preencher ' +
    (run.helpMissing || 'um campo obrigatório') +
    '. Abra a aba do LinkedIn e complete — ou clique em "Pular vaga atual".';
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
  scanCache = Boolean(isScanning);
  els.btnStart.disabled = scanCache;
  els.btnStop.disabled = !scanCache;
  renderStatusLight();
}

/**
 * Acende a luzinha do cabeçalho com a mesma leitura que o ícone da extensão usa:
 * verde capturando, amarela pronta, vermelha quando precisa de atenção.
 */
function renderStatusLight() {
  if (!els.statusLight) return;

  const light = SHARED.statusLight({
    run: runCache,
    guard: guardCache,
    scanning: scanCache,
    breakUntil: breakCache,
  });

  els.statusLight.className = 'light ' + light.key;
  els.statusLight.title = light.title;
  els.statusLight.setAttribute('aria-label', light.label);

  // O chip do cabeçalho mostra o mesmo estado, em texto.
  if (els.statusText) els.statusText.textContent = light.label;
  if (els.runChip) els.runChip.title = light.title;
}

function setStatus(message, type) {
  els.status.textContent = message;
  els.status.className = 'status' + (type ? ' ' + type : '');

  // Como um "toast": some sozinho depois de alguns segundos.
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    els.status.textContent = '';
    els.status.className = 'status';
  }, TOAST_MS);
}

/* -------------------------------------------------------------------------- */
/* CSV                                                                         */
/* -------------------------------------------------------------------------- */

function buildCSV(jobs) {
  const options = { applyEnabled: settings.apply.enabled };
  const rows = [CSV_HEADERS];

  for (const job of jobs) {
    const failure = SHARED.describeApplyFailure(job, options);

    rows.push([
      job.id || '',
      job.title || '',
      job.company || '',
      job.link || '',
      job.description || '',
      formatDate(job.capturedAt),
      job.term || '',
      failure ? failure.label : SHARED.applyOutcomeLabel(job.applyStatus),
      failure ? failure.reason : '', // em branco quando a candidatura foi enviada
      job.applyStatus ? String(job.applyAttempts || 0) : '',
      formatDate(job.appliedAt),
    ]);
  }

  const body = rows.map((row) => row.map(escapeCSVField).join(CSV_SEPARATOR));

  // \uFEFF (BOM) garante que o Excel reconheça o arquivo como UTF-8.
  return '\uFEFF' + body.join('\r\n');
}

/**
 * CSV só com as vagas que não foi possível candidatar, cada uma com o motivo.
 * Devolve null quando todas as vagas capturadas foram candidatadas.
 */
function buildFailuresCSV(jobs) {
  const options = { applyEnabled: settings.apply.enabled };
  const rows = [];

  for (const job of jobs) {
    const failure = SHARED.describeApplyFailure(job, options);
    if (!failure || failure.already) continue; // já candidatada antes não é falha

    rows.push([
      job.id || '',
      job.title || '',
      job.company || '',
      job.link || '',
      job.term || '',
      failure.label,
      failure.reason,
      formatDate(job.applyTriedAt || job.appliedAt),
    ]);
  }

  if (!rows.length) return null;

  const body = [FAILURE_CSV_HEADERS]
    .concat(rows)
    .map((row) => row.map(escapeCSVField).join(CSV_SEPARATOR));

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
  renderRun(message.run, null, message.breakUntil);
  renderGuard(message.guard || null);
  setScanning(
    Boolean(message.scanning) || Boolean(message.run && message.run.running)
  );
}

function onStorageChanged(changes, areaName) {
  if (areaName !== 'local') return;

  if (changes[STORAGE_JOBS_KEY]) refresh();

  if (changes[STORAGE_GUARD_KEY]) renderGuard(changes[STORAGE_GUARD_KEY].newValue || null);

  if (changes[STORAGE_SETTINGS_KEY] && changes[STORAGE_SETTINGS_KEY].newValue) {
    settings = SHARED.parseSettings(changes[STORAGE_SETTINGS_KEY].newValue);
  }

  if (changes[STORAGE_APPS_KEY]) {
    const list = changes[STORAGE_APPS_KEY].newValue;
    appsCache = Array.isArray(list) ? list.filter((ts) => Number.isFinite(ts)) : [];
    renderSpark();
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

    const summary = SHARED.summarizeApply(jobs, { applyEnabled: settings.apply.enabled });

    setStatus(
      `${jobs.length} vaga(s) exportada(s) — ` + SHARED.describeApplySummary(summary) + '.',
      'ok'
    );
  } catch (error) {
    setStatus('Falha ao gerar o arquivo: ' + error.message, 'error');
  }
}

/**
 * Exporta apenas as vagas que não foi possível candidatar, uma por linha, com o
 * motivo (site externo, campo obrigatório, cota estourada…).
 */
async function onExportFailuresClick() {
  const jobs = await getJobsArray();

  try {
    const csv = buildFailuresCSV(jobs);

    if (!csv) {
      const summary = SHARED.summarizeApply(jobs, { applyEnabled: settings.apply.enabled });
      const extra = summary.already ? ' (' + summary.already + ' já candidatada(s) antes)' : '';
      setStatus('Todas as vagas capturadas foram candidatadas. Nada a relatar.' + extra, 'ok');
      return;
    }

    const summary = SHARED.summarizeApply(jobs, { applyEnabled: settings.apply.enabled });
    const semCandidatura = summary.failed + summary.pending;

    downloadFile(csv, `pegavaga_nao_candidatadas_${timestampForFilename()}.csv`);

    setStatus(
      semCandidatura +
        ' vaga(s) sem candidatura exportada(s) com o motivo (' +
        summary.failed +
        ' definitiva(s) e ' +
        summary.pending +
        ' na fila).',
      summary.failed ? 'warn' : 'ok'
    );
  } catch (error) {
    setStatus('Falha ao gerar o arquivo: ' + error.message, 'error');
  }
}
