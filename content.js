/* =============================================================================
 * PegaVaga - content.js
 * Script injetado nas páginas do LinkedIn (https://www.linkedin.com/*).
 *
 * Responsabilidades:
 *   1. Observar com MutationObserver a lista de vagas, que o LinkedIn carrega
 *      dinamicamente conforme o usuário rola a página.
 *   2. Extrair, de cada card de vaga, título, empresa, link e a descrição
 *      completa (a descrição vive no painel de detalhes à direita, então o
 *      script seleciona cada card e lê o painel).
 *   3. Persistir tudo em chrome.storage.local, com merge por ID de vaga, para
 *      que os dados não se percam ao fechar o pop-up ou a aba.
 *   4. Candidatar-se sozinho ("Candidatura Simplificada") enquanto houver cota
 *      sobrando no termo, na hora, nas últimas 24 h e no dia.
 *   5. Varrer termo por termo: ao atingir a cota do termo, avança para o
 *      próximo da fila; quando acaba a cota, pausa e retoma mais tarde.
 *   6. Imitar o ritmo humano (intervalos variáveis, leitura da vaga, pausas
 *      longas periódicas) e ceder a vez para o usuário: enquanto você mexe na
 *      página, a automação espera em vez de roubar o seu clique/rolagem.
 *   7. Anotar, por vaga, o motivo de não ter sido possível candidatar (site
 *      externo, campo obrigatório, formulário fora do prazo…), para o relatório.
 *   8. Parar tudo quando o LinkedIn sinaliza limite de uso/verificação, com um
 *      período de descanso — é melhor perder horas do que a conta.
 *
 * A fila de termos (chrome.storage.local) é a fonte da verdade: como cada termo
 * é uma navegação nova, a página recém-carregada relê a fila e continua sozinha.
 * ===========================================================================*/

(() => {
  'use strict';

  /* ------------------------------------------------------------------------ */
  /* Constantes compartilhadas com o pop-up (ver shared.js)                    */
  /* ------------------------------------------------------------------------ */

  const SHARED = window.PegaVagaShared || {};
  const STORAGE = SHARED.STORAGE || {};

  const STORAGE_JOBS_KEY = STORAGE.jobs || 'pegavaga_jobs';
  const STORAGE_META_KEY = STORAGE.meta || 'pegavaga_meta';
  const STORAGE_RUN_KEY = STORAGE.run || 'pegavaga_run';
  const STORAGE_APPS_KEY = STORAGE.apps || 'pegavaga_apps';
  const STORAGE_SETTINGS_KEY = STORAGE.settings || 'pegavaga_settings';
  const STORAGE_GUARD_KEY = STORAGE.guard || 'pegavaga_guard';

  const MSG = SHARED.MSG || {
    START: 'PEGAVAGA_START',
    STOP: 'PEGAVAGA_STOP',
    PING: 'PEGAVAGA_PING',
    CLEAR: 'PEGAVAGA_CLEAR',
    PROGRESS: 'PEGAVAGA_PROGRESS',
    RESUME: 'PEGAVAGA_RESUME',
  };

  const DEFAULT_APPLY = (SHARED.DEFAULT_SETTINGS && SHARED.DEFAULT_SETTINGS.apply) || {
    enabled: false,
    perTerm: 10,
    perHour: 10,
    per24h: 40,
    perDay: 0,
    scanPerTerm: 60,
    minDelayMs: 4000,
    maxDelayMs: 12000,
  };

  const parseSettings = SHARED.parseSettings || ((raw) => raw || {});

  const HISTORY_LIMIT = SHARED.HISTORY_LIMIT || 500;

  /** Variação aleatória em torno de um intervalo (ritmo humano). */
  const jitter = SHARED.jitter || ((ms) => ms);

  const APPLY_PENDING = SHARED.APPLY_PENDING || 'adiada';
  const APPLY_OUTCOMES = SHARED.APPLY_OUTCOMES || {};

  const isWithinSchedule = SHARED.isWithinSchedule || (() => true);
  const nextScheduleStart = SHARED.nextScheduleStart || (() => null);

  const buildQuota =
    SHARED.computeQuota ||
    (() => ({ ok: true, blockedBy: null, resumeAt: null, used: {}, limits: {}, remaining: {} }));

  const CONFIG = {
    clickDelayMs: 800, // espera após selecionar um card
    descriptionPollMs: 250, // intervalo de polling do painel de detalhes
    descriptionTimeoutMs: 6000, // tempo máximo esperando a descrição carregar
    scrollDelayMs: 900, // espera após rolar a lista
    maxScrollRounds: 60, // limite de rolagens por varredura
    maxJobVisitsPerRun: 300, // limite de vagas visitadas por varredura
    persistDebounceMs: 400, // debounce do salvamento em storage
    domDebounceMs: 300, // debounce do MutationObserver
    waitListPollMs: 300, // intervalo de espera da lista de vagas aparecer
    waitListTimeoutMs: 15000, // tempo máximo esperando os cards carregarem
    applyModalPollMs: 250, // intervalo de polling do modal de candidatura
    applyModalTimeoutMs: 10000, // tempo máximo esperando o modal abrir
    applyStepDelayMs: 1200, // espera entre etapas do formulário
    applyMaxSteps: 15, // limite de "Avançar/Enviar" por vaga
    applyMaxAttempts: 2, // tentativas por vaga antes de desistir
    applyFlowTimeoutMs: 120000, // tempo máximo dentro do formulário de uma vaga
    resumeTimerCapMs: 1800000, // teto do timer local de retomada (30 min)

    /* Ritmo humano / furtividade */
    humanRatio: 0.3, // variação padrão aplicada aos intervalos
    applyPreClickMs: 700, // respiração antes de abrir o formulário
    longReadChance: 0.12, // chance de "reler" a vaga inteira antes de se candidatar
    longReadMs: 12000,
    userIdleMs: 4000, // tempo sem interação sua para considerar a página livre
    userWaitMaxMs: 300000, // teto da espera pela sua ociosidade (5 min)
    userBusyPauseMs: 180000, // descanso da varredura quando você está usando a página
    breakPollMs: 500, // intervalo de checagem durante pausas longas
    guardCooldownMs: 3600000, // descanso após sinal de limite do LinkedIn (1 h)
    guardTextLimit: 20000, // quanto do texto da página lemos procurando avisos
  };

  /* ------------------------------------------------------------------------ */
  /* Seletores do LinkedIn (com fallbacks, pois o DOM muda com frequência)     */
  /* ------------------------------------------------------------------------ */

  const SEL = {
    // Container que guarda a lista de vagas.
    list: [
      '.jobs-search-results-list',
      'ul.scaffold-layout__list-container',
      '.scaffold-layout__list > div > ul',
      '.scaffold-layout__list',
    ],
    // Um card individual de vaga.
    card: [
      'li.scaffold-layout__list-item',
      'li.jobs-search-results__list-item',
      'li[data-occludable-job-id]',
      'div.job-card-container',
    ],
    // Âncora com o link da vaga dentro do card.
    cardLink: [
      'a.job-card-container__link',
      'a.job-card-list__title',
      'a.job-card-list__title--link',
      'a[href*="/jobs/view/"]',
    ],
    // Título da vaga dentro do card.
    cardTitle: [
      '.job-card-list__title',
      '.job-card-container__link strong',
      '.job-card-container__link span[aria-hidden="true"]',
      'strong',
    ],
    // Empresa dentro do card.
    cardCompany: [
      '.artdeco-entity-lockup__subtitle',
      '.job-card-container__primary-description',
      '.job-card-container__company-name',
    ],
    // Card atualmente selecionado (aberto no painel de detalhes).
    selectedCard: [
      'li.scaffold-layout__list-item.selected',
      'li[data-occludable-job-id].selected',
      'div.job-card-container--clickable.selected',
      'div.job-card-container.selected',
    ],
    // Painel de detalhes à direita.
    detailsRoot: [
      '#job-details',
      '.jobs-search__job-details--container',
      '.scaffold-layout__detail',
      '.jobs-details',
    ],
    detailsTitle: [
      '.job-details-jobs-unified-top-card__job-title',
      '.jobs-unified-top-card__job-title',
      'h1.t-24',
    ],
    detailsCompany: [
      '.job-details-jobs-unified-top-card__company-name',
      '.jobs-unified-top-card__company-name',
    ],
    detailsDescription: [
      '.jobs-description__content',
      '.jobs-description-content__text',
      '.jobs-box__html-content',
      '#job-details article',
      '#job-details',
    ],
  };

  /* Seletores da Candidatura Simplificada (Easy Apply). Tudo com fallback,
   * porque o LinkedIn troca classes com frequência. */
  const APPLY_SEL = {
    button: [
      '.jobs-apply-button',
      'button.jobs-apply-button',
      '.jobs-details__main-content button.jobs-apply-button',
      '.jobs-unified-top-card__content--two-pane button.jobs-apply-button',
      'button[data-live-test-job-apply-button]',
    ],
    modal: [
      '.jobs-easy-apply-modal',
      'div[data-test-modal-container] div[role="dialog"]',
      'div[role="dialog"][aria-labelledby]',
      '.artdeco-modal[role="dialog"]',
    ],
    footer: ['footer', '.jobs-easy-apply-modal__footer', '.artdeco-modal__actionbar'],
    discard: [
      'button[data-control-name="discard_application_confirm_btn"]',
      'button[aria-label="Descartar"]',
      'button[aria-label="Discard"]',
    ],
    dismiss: [
      'button[aria-label="Fechar"]',
      'button[aria-label="Dismiss"]',
      '.artdeco-modal__dismiss',
      'button[aria-label="Concluir"]',
      'button[aria-label="Concluir candidatura"]',
      'button[aria-label="Done"]',
    ],
  };

  /* ------------------------------------------------------------------------ */
  /* Estado local                                                              */
  /* ------------------------------------------------------------------------ */

  const state = {
    jobs: {}, // { [jobId]: { id, title, company, link, description, ... } }
    scanning: false,
    abort: false,
    lastRun: null,
    observer: null,
    persistTimer: null,
    lastSyncedId: null,
    run: null, // fila de termos em andamento (vinda do pop-up/agendador)
    settings: null, // configuração carregada do storage
    apps: [], // timestamps (ms) das candidaturas enviadas
    resumeTimer: null, // retomada agendada após estourar uma cota
    lastUserActivity: 0, // última interação do usuário (clique, mouse, teclado)
    watchingUser: false, // listeners de atividade já instalados?
    userBusy: false, // o usuário mexeu na página durante a varredura
    sinceBreak: 0, // candidaturas desde a última pausa longa
    breakUntil: null, // fim da pausa longa em andamento (para a interface)
    guard: null, // bloqueio temporário detectado (proteção da conta)
    guardStopped: false, // a varredura parou por causa do bloqueio?
  };

  /* ------------------------------------------------------------------------ */
  /* Utilitários de DOM                                                        */
  /* ------------------------------------------------------------------------ */

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function queryFirst(selectors, root = document) {
    for (const selector of selectors) {
      const el = root.querySelector(selector);
      if (el) return el;
    }
    return null;
  }

  function queryAllUnique(selectors, root = document) {
    const found = new Set();
    for (const selector of selectors) {
      root.querySelectorAll(selector).forEach((el) => found.add(el));
    }
    return Array.from(found);
  }

  function clean(text) {
    return String(text || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  function stripEmpty(patch) {
    const out = {};
    Object.keys(patch || {}).forEach((key) => {
      const value = patch[key];
      if (value !== undefined && value !== null && value !== '') out[key] = value;
    });
    return out;
  }

  /** Normaliza texto para comparar títulos (ignora acentos e caixa). */
  function normalize(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function titlesMatch(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    return na === nb || na.includes(nb) || nb.includes(na);
  }

  /* ------------------------------------------------------------------------ */
  /* Extração dos cards de vaga                                                */
  /* ------------------------------------------------------------------------ */

  function getCards() {
    const listRoot = queryFirst(SEL.list);
    const root = listRoot || document;

    let cards = queryAllUnique(SEL.card, root);

    // Fallback: se nenhum seletor de card casar, deduz o card pelo link da vaga.
    if (!cards.length) {
      const anchors = Array.from(root.querySelectorAll('a[href*="/jobs/view/"]'));
      cards = anchors
        .map((anchor) => anchor.closest('li') || anchor.parentElement)
        .filter(Boolean);
    }

    // Remove cards aninhados (ex.: o <li> e a <div.job-card-container> da
    // mesma vaga), mantendo sempre o elemento mais externo.
    return cards.filter(
      (card) => !cards.some((other) => other !== card && other.contains(card))
    );
  }

  function getJobId(card) {
    const direct =
      card.getAttribute('data-occludable-job-id') ||
      card.getAttribute('data-job-id') ||
      (card.querySelector('[data-job-id]') &&
        card.querySelector('[data-job-id]').getAttribute('data-job-id'));

    if (direct) return String(direct);

    const link = queryFirst(SEL.cardLink, card);
    const href = (link && link.getAttribute('href')) || '';
    const match = href.match(/\/jobs\/view\/(\d+)/);
    return match ? match[1] : '';
  }

  function readCardMeta(card) {
    const id = getJobId(card);
    const linkEl = queryFirst(SEL.cardLink, card);
    const titleEl = queryFirst(SEL.cardTitle, card);
    const companyEl = queryFirst(SEL.cardCompany, card);

    let link = (linkEl && linkEl.href) || '';
    if (link) {
      try {
        const url = new URL(link);
        link = url.origin + url.pathname;
      } catch (error) {
        /* mantém o link original */
      }
    }

    return {
      id,
      title: clean(titleEl && titleEl.textContent) || clean(linkEl && linkEl.textContent),
      company: clean(companyEl && companyEl.textContent),
      link: link || (id ? 'https://www.linkedin.com/jobs/view/' + id + '/' : ''),
    };
  }


  /* ------------------------------------------------------------------------ */
  /* Painel de detalhes (descrição completa)                                   */
  /* ------------------------------------------------------------------------ */

  function readDetails() {
    const root = queryFirst(SEL.detailsRoot) || document;
    const titleEl = queryFirst(SEL.detailsTitle, root);
    const companyEl = queryFirst(SEL.detailsCompany, root);
    const descEl = queryFirst(SEL.detailsDescription, root);

    return {
      title: clean(titleEl && titleEl.textContent),
      company: clean(companyEl && companyEl.textContent),
      description: descEl ? clean(descEl.innerText || descEl.textContent) : '',
    };
  }

  /** Seleciona (clica) um card para abrir a vaga no painel de detalhes. */
  function selectCard(card) {
    const target =
      card.querySelector('.job-card-container') ||
      card.querySelector('a[href*="/jobs/view/"]') ||
      card;

    // Clique humanizado: o card do LinkedIn só abre com uma "passada de mouse".
    humanClick(target);
  }

  /** Clica no card e espera a descrição correspondente aparecer no painel. */
  async function captureForCard(card, id) {
    const meta = readCardMeta(card);
    selectCard(card);

    const deadline = Date.now() + CONFIG.descriptionTimeoutMs;

    while (Date.now() < deadline) {
      await humanPause(CONFIG.descriptionPollMs, 0.4);

      const details = readDetails();
      const looksRight =
        !meta.title || !details.title || titlesMatch(details.title, meta.title);

      if (details.description && looksRight) {
        upsertJob(id, {
          title: meta.title || details.title,
          company: meta.company || details.company,
          link: meta.link,
          description: details.description,
        });
        return true;
      }
    }

    // Timeout: guarda pelo menos os metadados do card.
    upsertJob(id, meta);
    return false;
  }

  /** Sincroniza a vaga que o usuário abriu manualmente (fora da varredura). */
  function syncSelectedJob() {
    const card = queryFirst(SEL.selectedCard);
    if (!card) return;

    const id = getJobId(card);
    if (!id || id === state.lastSyncedId) return;

    const details = readDetails();
    if (!details.description) return;

    const meta = readCardMeta(card);
    if (meta.title && details.title && !titlesMatch(details.title, meta.title)) return;

    state.lastSyncedId = id;
    upsertJob(id, {
      title: meta.title || details.title,
      company: meta.company || details.company,
      link: meta.link,
      description: details.description,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Persistência em chrome.storage.local                                      */
  /* ------------------------------------------------------------------------ */

  function upsertJob(id, patch) {
    if (!id) return;

    const previous = state.jobs[id] || {};
    const merged = Object.assign({}, previous, stripEmpty(patch));

    // Nunca sobrescreve uma descrição já capturada com um valor vazio.
    if (!patch.description && previous.description) {
      merged.description = previous.description;
    }

    merged.id = id;
    merged.capturedAt = merged.capturedAt || new Date().toISOString();
    merged.updatedAt = new Date().toISOString();

    // Registra por qual termo de busca a vaga apareceu (útil na planilha).
    if (!merged.term && state.run && state.run.term) merged.term = state.run.term;

    state.jobs[id] = merged;
    schedulePersist();
    broadcastProgress();
  }

  function schedulePersist() {
    clearTimeout(state.persistTimer);
    state.persistTimer = setTimeout(persist, CONFIG.persistDebounceMs);
  }

  function persist() {
    const meta = {
      lastRun: state.lastRun,
      count: Object.keys(state.jobs).length,
      pageUrl: location.href,
    };

    return chrome.storage.local
      .set({ [STORAGE_JOBS_KEY]: state.jobs, [STORAGE_META_KEY]: meta })
      .catch(() => {});
  }

  async function loadState() {
    try {
      const data = await chrome.storage.local.get([STORAGE_JOBS_KEY, STORAGE_META_KEY]);
      state.jobs = data[STORAGE_JOBS_KEY] || {};
      const meta = data[STORAGE_META_KEY] || {};
      state.lastRun = meta.lastRun || null;
    } catch (error) {
      state.jobs = {};
    }
  }

  function broadcastProgress() {
    const run = state.run;

    const payload = {
      type: MSG.PROGRESS,
      count: Object.keys(state.jobs).length,
      scanning: state.scanning,
      lastRun: state.lastRun,
      run: run
        ? {
            running: run.running === true,
            paused: run.paused === true,
            resumeAt: run.resumeAt || null,
            pauseReason: run.pauseReason || null,
            index: run.index || 0,
            total: Array.isArray(run.urls) ? run.urls.length : 1,
            term: run.term || '',
            appliedInTerm: run.appliedInTerm || 0,
            visitedInTerm: run.visitedInTerm || 0,
            appliedTotal: run.appliedTotal || 0,
          }
        : null,
      breakUntil: state.breakUntil || null,
      guard: state.guard
        ? { blockedUntil: state.guard.blockedUntil, reason: state.guard.reason || '' }
        : null,
    };

    try {
      chrome.runtime.sendMessage(payload, () => void chrome.runtime.lastError);
    } catch (error) {
      /* pop-up fechado: sem receptor, apenas ignoramos */
    }
  }


  /* ------------------------------------------------------------------------ */
  /* Rolagem da lista                                                          */
  /* ------------------------------------------------------------------------ */

  function findScrollContainer() {
    const candidates = [];
    const listRoot = queryFirst(SEL.list);
    if (listRoot) candidates.push(listRoot);

    const cards = getCards();
    if (cards.length) candidates.push(cards[0].parentElement);

    for (const start of candidates) {
      let el = start;
      while (el && el !== document.body && el !== document.documentElement) {
        const style = getComputedStyle(el);
        if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 10) {
          return el;
        }
        el = el.parentElement;
      }
    }

    return null;
  }

  /** Rola a lista um "passo" e informa se houve progresso. */
  async function scrollList() {
    const before = getCards().length;

    // Rolagem de 60% a 95% da tela: nunca o mesmo passo, nunca "pulo" seco.
    const ratio = 0.6 + Math.random() * 0.35;
    const container = findScrollContainer();

    if (!container) {
      window.scrollBy(0, Math.round(window.innerHeight * ratio));
      await humanPause(CONFIG.scrollDelayMs);
      return getCards().length > before;
    }

    const previousTop = container.scrollTop;
    const step = Math.max(120, Math.round(container.clientHeight * ratio));

    container.scrollTop = Math.min(container.scrollHeight, container.scrollTop + step);

    await humanPause(CONFIG.scrollDelayMs);

    const grew = getCards().length > before;
    const moved = container.scrollTop > previousTop;
    return grew || moved;
  }

  /* ------------------------------------------------------------------------ */
  /* Cota e histórico de candidaturas                                          */
  /* ------------------------------------------------------------------------ */

  /** Configuração atual do storage (com padrões aplicados). */
  async function getSettings() {
    try {
      const data = await chrome.storage.local.get(STORAGE_SETTINGS_KEY);
      return parseSettings(data[STORAGE_SETTINGS_KEY]);
    } catch (error) {
      return parseSettings(null);
    }
  }

  /** Timestamps (ms) das candidaturas enviadas — base das cotas móveis. */
  async function loadApps() {
    try {
      const data = await chrome.storage.local.get(STORAGE_APPS_KEY);
      const list = data[STORAGE_APPS_KEY];
      state.apps = Array.isArray(list) ? list.filter((ts) => Number.isFinite(ts)) : [];
    } catch (error) {
      state.apps = [];
    }

    return state.apps;
  }

  function persistApps() {
    const list = state.apps.slice(-HISTORY_LIMIT);
    state.apps = list;
    return chrome.storage.local.set({ [STORAGE_APPS_KEY]: list }).catch(() => {});
  }

  /** Quanto ainda cabe agora (hora / 24 h / dia / termo). */
  function quotaNow() {
    const settings = state.settings || parseSettings(null);
    const appliedInTerm = state.run ? state.run.appliedInTerm || 0 : 0;
    return buildQuota(settings, state.apps, Date.now(), appliedInTerm);
  }

  function randomDelay(min, max) {
    const lo = Math.max(0, Number(min) || 0);
    const hi = Math.max(lo, Number(max) || lo);
    return Math.round(lo + Math.random() * (hi - lo));
  }

  /* ------------------------------------------------------------------------ */
  /* Furtividade: ritmo humano, vez para o usuário e proteção da conta         */
  /* ------------------------------------------------------------------------ */

  /**
   * Avisos que o LinkedIn mostra quando desconfia de automação ou de excesso de
   * candidaturas. O texto é comparado sem acentos e em minúsculas.
   */
  const RATE_LIMIT_RE = new RegExp(
    [
      'checkpoint',
      'verificacao de seguranca',
      'security verification',
      'unusual activity',
      'atividade suspeita',
      'atividade incomum',
      'muitas solicitacoes',
      'too many requests',
      'rate limit',
      'limite de uso',
      'temporarily restricted',
      'restricao temporaria',
      'tente novamente mais tarde',
      'prove que voce',
      'voce atingiu o limite',
    ].join('|')
  );

  /** Marca que o usuário acabou de interagir com a página. */
  function noteUserActivity() {
    state.lastUserActivity = Date.now();
  }

  /** Escuta mouse/teclado/rolagem para ceder a vez a quem está usando a página. */
  function watchUserActivity() {
    if (state.watchingUser) return;
    if (typeof document.addEventListener !== 'function') return;

    state.watchingUser = true;

    for (const type of ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll']) {
      try {
        document.addEventListener(type, noteUserActivity, { passive: true, capture: true });
      } catch (error) {
        /* navegador sem captura passiva: seguimos sem este listener */
      }
    }
  }

  /** A página está livre (o usuário não mexe nela há alguns segundos)? */
  function userIsIdle(settings) {
    const cfg = (settings && settings.apply) || DEFAULT_APPLY;
    if (cfg.respectUserActivity !== true) return true;
    if (!state.lastUserActivity) return true;

    return Date.now() - state.lastUserActivity >= CONFIG.userIdleMs;
  }

  /**
   * Espera o usuário parar de mexer na página. Nunca roubamos o clique nem a
   * rolagem de quem está usando o LinkedIn naquele momento; se a pessoa não
   * parar, devolvemos false e a varredura descansa um pouco (ver `userBusy`).
   */
  async function waitForUserIdle(settings) {
    if (userIsIdle(settings)) return true;

    const deadline = Date.now() + CONFIG.userWaitMaxMs;

    while (!state.abort && Date.now() < deadline && !userIsIdle(settings)) {
      await wait(CONFIG.breakPollMs);
    }

    return userIsIdle(settings);
  }

  /** Pausa curta com variação humana (nada de intervalos sempre iguais). */
  function humanPause(baseMs, ratio) {
    return wait(jitter(baseMs, ratio == null ? CONFIG.humanRatio : ratio));
  }

  /** Canto aleatório do elemento, para o clique não cair sempre no pixel exato. */
  function elementPoint(el) {
    let box = null;

    try {
      box = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    } catch (error) {
      box = null;
    }

    if (!box || !box.width || !box.height) return null;

    return {
      x: box.left + box.width * (0.3 + Math.random() * 0.4),
      y: box.top + box.height * (0.35 + Math.random() * 0.3),
    };
  }

  /** Dispara um evento de mouse "de verdade" (quando o navegador permite). */
  function dispatchMouse(target, type, point) {
    if (!target || typeof target.dispatchEvent !== 'function') return false;

    try {
      let event = null;

      if (typeof MouseEvent === 'function') {
        event = new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          view: typeof window !== 'undefined' ? window : undefined,
          clientX: point ? Math.round(point.x) : 0,
          clientY: point ? Math.round(point.y) : 0,
        });
      } else if (typeof Event === 'function') {
        event = new Event(type, { bubbles: true, cancelable: true });
      }

      if (!event) return false;

      target.dispatchEvent(event);
      return true;
    } catch (error) {
      return false;
    }
  }

  /** Passa o mouse pelo elemento: é isso que revela botões escondidos no hover. */
  function hoverElement(el) {
    if (!el) return null;

    const point = elementPoint(el);

    dispatchMouse(el, 'mouseover', point);
    dispatchMouse(el, 'mouseenter', point);
    dispatchMouse(el, 'mousemove', point);

    if (point && typeof document.elementFromPoint === 'function') {
      const under = document.elementFromPoint(point.x, point.y);

      // O LinkedIn às vezes cobre o card com uma camada transparente.
      if (under && under !== el) dispatchMouse(under, 'mousemove', point);
    }

    return point;
  }

  /**
   * Clique humanizado: rola até o alvo, passa o mouse por cima e só então clica.
   * A página reage como se uma pessoa estivesse usando o site — e a lista de
   * vagas não denuncia a automação por cliques "secos".
   */
  function humanClick(el) {
    if (!el) return false;

    try {
      if (typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    } catch (error) {
      /* elemento sem scrollIntoView: segue o jogo */
    }

    const point = hoverElement(el);

    dispatchMouse(el, 'pointerdown', point);
    dispatchMouse(el, 'mousedown', point);
    dispatchMouse(el, 'pointerup', point);
    dispatchMouse(el, 'mouseup', point);
    dispatchMouse(el, 'click', point);

    try {
      el.click();
    } catch (error) {
      return false;
    }

    return true;
  }

  /** Texto visível da página (usado só para farejar avisos do LinkedIn). */
  function pageText() {
    const body = document.body;
    if (!body) return '';
    return String(body.innerText || body.textContent || '').slice(0, CONFIG.guardTextLimit);
  }

  /** O LinkedIn está pedindo verificação / avisando de limite de uso? */
  function detectRateLimit() {
    try {
      if (/\/(checkpoint|authwall|uas)\b/i.test(location.pathname)) {
        return 'Redirecionado para verificação';
      }

      const text = normalize(pageText());
      if (RATE_LIMIT_RE.test(text)) return 'Aviso de limite de uso na página do LinkedIn';
    } catch (error) {
      return null;
    }

    return null;
  }

  /** Fim do período de descanso imposto pela proteção da conta (ou null). */
  function guardUntil() {
    if (!state.guard) return null;
    return state.guard.blockedUntil > Date.now() ? state.guard.blockedUntil : null;
  }

  /** Reativa a proteção gravada em uma execução anterior. */
  async function loadGuard() {
    try {
      const data = await chrome.storage.local.get(STORAGE_GUARD_KEY);
      const guard = data[STORAGE_GUARD_KEY] || null;
      state.guard = guard && guard.blockedUntil > Date.now() ? guard : null;
    } catch (error) {
      state.guard = null;
    }

    return state.guard;
  }

  /**
   * O LinkedIn (ou a nossa checagem) indicou abuso: paramos tudo por um tempo.
   * O estado vai para o storage, para o agendador respeitar o mesmo descanso, e
   * a fila fica pausada (não é apagada): ao fim do descanso ela volta sozinha.
   */
  async function tripGuard(reason) {
    state.abort = true;
    state.guardStopped = true;
    state.guard = {
      blockedUntil: Date.now() + CONFIG.guardCooldownMs,
      reason: reason || 'Limite de uso detectado',
      at: new Date().toISOString(),
    };

    await chrome.storage.local.set({ [STORAGE_GUARD_KEY]: state.guard }).catch(() => {});
    broadcastProgress();
  }

  /** Pausa longa periódica: ninguém se candidata a dezenas de vagas sem parar. */
  async function longBreak(settings) {
    const cfg = (settings && settings.apply) || DEFAULT_APPLY;

    if (cfg.breaksEnabled !== true) return;
    if (!cfg.breakEvery || state.sinceBreak < cfg.breakEvery) return;

    const duration = jitter(cfg.breakMs, 0.4);
    const deadline = Date.now() + duration;

    setSinceBreak(0);
    state.breakUntil = deadline;
    broadcastProgress(); // a interface mostra "descansando até…"

    while (!state.abort && Date.now() < deadline) {
      await wait(Math.min(CONFIG.breakPollMs, Math.max(0, deadline - Date.now())));
    }

    state.breakUntil = null;
    broadcastProgress();
  }

  /** Finge que leu a vaga antes de se candidatar (e às vezes relê tudo). */
  async function readingPause(settings) {
    const cfg = (settings && settings.apply) || DEFAULT_APPLY;

    await humanPause(randomDelay(cfg.readMinMs, cfg.readMaxMs), 0.25);

    if (Math.random() < CONFIG.longReadChance) {
      await humanPause(CONFIG.longReadMs, 0.5);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Candidatura automática (Candidatura Simplificada)                         */
  /* ------------------------------------------------------------------------ */

  function isVisible(el) {
    if (!el || el.disabled) return false;
    return Boolean(el.getClientRects && el.getClientRects().length);
  }

  function findApplyButton() {
    return queryFirst(APPLY_SEL.button);
  }

  /**
   * O botão é de "Candidatura Simplificada" (formulário aqui dentro) ou manda
   * para um site externo? Só automatizamos o primeiro caso.
   */
  function isEasyApply(button) {
    const label = normalize(
      (button.getAttribute('aria-label') || '') + ' ' + (button.textContent || '')
    );

    if (button.querySelector('[data-test-icon*="link-external"], li-icon[type*="link-external"]')) {
      return false;
    }

    if (/simplificada|easy apply|no linkedin|pelo linkedin|com o linkedin/.test(label)) return true;

    return Boolean(
      button.querySelector('[data-test-icon*="linkedin-bug"], li-icon[type*="linkedin-bug"]')
    );
  }

  function findModal() {
    const found = queryAllUnique(APPLY_SEL.modal).filter(isVisible);
    return found.length ? found[0] : null;
  }

  async function waitForModal(timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const modal = findModal();
      if (modal) return modal;
      await wait(CONFIG.applyModalPollMs);
    }

    return findModal();
  }

  /** "Enviar candidatura" x "Avançar/Revisar"? Desempata pelo texto do botão. */
  function classifyAction(button) {
    const label = normalize(
      (button.getAttribute('aria-label') || '') + ' ' + (button.textContent || '')
    );

    if (/enviar candidatura|submit application|enviar candidatura com o linkedin/.test(label)) {
      return 'submit';
    }

    if (/avançar|avancar|proxima|próxima|revisar|review|continuar|next/.test(label)) return 'next';

    return null;
  }

  /** Botão principal habilitado no rodapé do modal. */
  function getModalAction(modal) {
    const scope = queryFirst(APPLY_SEL.footer, modal) || modal;
    const buttons = Array.from(scope.querySelectorAll('button')).filter(isVisible);
    if (!buttons.length) return null;

    for (const button of buttons) {
      if (classifyAction(button) === 'submit') return { kind: 'submit', button };
    }

    for (const button of buttons) {
      if (classifyAction(button) === 'next') return { kind: 'next', button };
    }

    const primary = buttons.find((button) =>
      /artdeco-button--primary|artdeco-button--2|artdeco-button--3/.test(button.className)
    );

    return primary ? { kind: 'next', button: primary } : null;
  }

  /** O modal já está na tela de "candidatura enviada"? */
  function looksSubmitted(modal) {
    // O texto já passou por normalize(): sem acentos e em minúsculas.
    const text = normalize(modal.textContent || '');
    return /candidatura.{0,40}enviad|enviad.{0,20}candidatura|application.{0,20}sent|voce se candidatou/.test(
      text
    );
  }

  /** Rótulo visível de um campo do formulário (para o relatório de motivos). */
  function fieldLabel(field) {
    let direct = '';

    try {
      direct = clean(
        (field.getAttribute && field.getAttribute('aria-label')) ||
          (field.getAttribute && field.getAttribute('placeholder'))
      );
    } catch (error) {
      direct = '';
    }

    if (direct) return direct.slice(0, 60);

    try {
      if (field.labels && field.labels.length) return clean(field.labels[0].textContent).slice(0, 60);
    } catch (error) {
      /* sem labels: tentamos o container abaixo */
    }

    try {
      const container =
        field.closest &&
        field.closest(
          '.fb-dash-form-element, .jobs-easy-apply-form-element, .artdeco-text-input--container, label, fieldset'
        );

      if (container) return clean(container.textContent).slice(0, 60);
    } catch (error) {
      /* sem closest: desistimos do rótulo */
    }

    return '';
  }

  /**
   * Rótulos dos campos/perguntas que ficaram pendentes no formulário. É isso que
   * o relatório mostra quando uma candidatura para em campo obrigatório.
   */
  function describeBlocker(modal) {
    const labels = [];
    const seen = new Set();

    let fields = [];

    try {
      fields = Array.from(
        modal.querySelectorAll('input, select, textarea, fieldset legend, [role="combobox"]')
      );
    } catch (error) {
      return labels;
    }

    for (const field of fields) {
      const tag = String(field.tagName || '').toLowerCase();

      if (tag === 'legend') {
        const text = clean(field.textContent).slice(0, 60);
        if (text && !seen.has(text)) {
          seen.add(text);
          labels.push(text);
        }
        continue;
      }

      const type = String(field.type || '').toLowerCase();
      if (type === 'hidden' || type === 'checkbox' || type === 'radio') continue;
      if (field.value && String(field.value).trim()) continue;

      const label = fieldLabel(field);
      if (label && !seen.has(label)) {
        seen.add(label);
        labels.push(label);
      }

      if (labels.length >= 3) break;
    }

    return labels;
  }

  /** Fecha o modal (descartando o formulário) para não deixar lixo na tela. */
  async function closeModal(modal, discard) {
    if (!modal || !document.contains(modal)) return;

    const button =
      (discard && queryFirst(APPLY_SEL.discard, modal)) ||
      queryFirst(APPLY_SEL.discard, modal) ||
      queryFirst(APPLY_SEL.dismiss, modal);

    if (button) {
      humanClick(button);
      await humanPause(CONFIG.applyStepDelayMs);

      // O LinkedIn pede confirmação antes de descartar.
      const confirm = queryFirst(APPLY_SEL.discard);
      if (confirm && confirm !== button && isVisible(confirm)) {
        humanClick(confirm);
        await humanPause(CONFIG.applyStepDelayMs);
      }
    }

    if (document.contains(modal)) {
      const dismiss = queryFirst(APPLY_SEL.dismiss, modal) || queryFirst(APPLY_SEL.dismiss);
      if (dismiss) {
        humanClick(dismiss);
        await humanPause(CONFIG.applyStepDelayMs);
      }
    }
  }

  /** Fecha o aviso de sucesso ("Concluir"), se ele aparecer. */
  async function finishApply(modal) {
    if (document.contains(modal) && looksSubmitted(modal)) {
      const done = queryFirst(APPLY_SEL.dismiss, modal) || queryFirst(APPLY_SEL.dismiss);
      if (done && isVisible(done)) {
        humanClick(done);
        await humanPause(CONFIG.applyStepDelayMs);
      }
    }

    const leftover = findModal();
    if (leftover) {
      const dismiss = queryFirst(APPLY_SEL.dismiss, leftover);
      if (dismiss && isVisible(dismiss)) {
        humanClick(dismiss);
        await humanPause(CONFIG.applyStepDelayMs);
      }
    }
  }

  /**
   * Preenche e envia a candidatura simplificada da vaga aberta no painel.
   * Devolve { status, missing?, steps?, error? }, com estes status:
   *   enviada   → candidatura confirmada pelo LinkedIn;
   *   externa   → botão manda para um site de fora (não automatizamos);
   *   sem_botao → a vaga não tem botão de candidatura;
   *   sem_modal → clicou e o formulário não abriu;
   *   travada   → parou em um campo obrigatório que não sabemos preencher
   *               (`missing` traz os rótulos dos campos pendentes);
   *   incompleta→ estourou o tempo/etapas do formulário (`steps` diz onde parou);
   *   cancelada → o usuário pediu para parar no meio;
   *   bloqueio  → o LinkedIn sinalizou limite de uso/verificação (`error`).
   */
  async function applyToJob() {
    // Antes de qualquer coisa: será que a página está avisando de limite?
    const blockedBefore = detectRateLimit();
    if (blockedBefore) return { status: 'bloqueio', error: blockedBefore };

    const button = findApplyButton();

    if (!button) return { status: 'sem_botao' };
    if (!isEasyApply(button)) return { status: 'externa' };

    await humanPause(CONFIG.applyPreClickMs); // respira antes de abrir o formulário
    humanClick(button);

    const modal = await waitForModal(CONFIG.applyModalTimeoutMs);
    if (!modal) return { status: 'sem_modal' };

    const deadline = Date.now() + CONFIG.applyFlowTimeoutMs;
    let steps = 0;

    while (Date.now() < deadline && steps < CONFIG.applyMaxSteps) {
      if (state.abort) {
        await closeModal(modal, true);
        return { status: 'cancelada', steps };
      }

      await humanPause(CONFIG.applyStepDelayMs);

      const blocked = detectRateLimit();
      if (blocked) {
        await closeModal(modal, true);
        return { status: 'bloqueio', error: blocked, steps };
      }

      if (!document.contains(modal) || looksSubmitted(modal)) {
        await finishApply(modal);
        return { status: 'enviada', steps };
      }

      const action = getModalAction(modal);

      // Sem botão principal: campo obrigatório pendente (telefone, pergunta…).
      if (!action) {
        const missing = describeBlocker(modal);
        await closeModal(modal, true);
        return { status: 'travada', missing, steps };
      }

      humanClick(action.button);
      steps += 1;

      if (action.kind === 'submit') {
        await humanPause(CONFIG.applyStepDelayMs * 2);

        if (!document.contains(modal) || looksSubmitted(modal)) {
          await finishApply(modal);
          return { status: 'enviada', steps };
        }
      }
    }

    const missing = describeBlocker(modal);
    await closeModal(modal, true);
    return { status: 'incompleta', missing, steps };
  }

  /** Conta a candidatura no termo e grava a fila (sobrevive a reloads). */
  async function bumpApplied() {
    if (!state.run) return;

    const next = Object.assign({}, state.run, {
      appliedInTerm: (state.run.appliedInTerm || 0) + 1,
      appliedTotal: (state.run.appliedTotal || 0) + 1,
    });

    state.run = next;
    await saveRun(next);
  }

  /**
   * Contador da pausa longa. Vive na fila (e não só na memória) porque cada
   * termo é uma navegação nova: sem isso o ritmo humano nunca "cansaria".
   */
  function setSinceBreak(value) {
    state.sinceBreak = Math.max(0, Number(value) || 0);

    if (state.run && state.run.running) {
      state.run = Object.assign({}, state.run, { sinceBreak: state.sinceBreak });
      scheduleRunPersist();
    }

    return state.sinceBreak;
  }

  /**
   * Motivo legível da não candidatura — é o texto que vai para o relatório.
   * Junta o motivo padrão do desfecho com os detalhes que só a página sabe
   * (campos que faltaram, etapa em que travou…).
   */
  function applyReasonText(result) {
    const outcome = APPLY_OUTCOMES[result.status] || {};
    const parts = [];

    if (outcome.reason) parts.push(outcome.reason);

    if (result.status === 'incompleta' && result.steps) {
      parts.push('Parou na etapa ' + result.steps + ' de ' + CONFIG.applyMaxSteps + '.');
    }

    if (result.missing && result.missing.length) {
      parts.push('Campos não preenchidos: ' + result.missing.slice(0, 3).join(', ') + '.');
    }

    if (result.error) parts.push('Detalhe: ' + String(result.error).slice(0, 160) + '.');

    return parts.join(' ').trim();
  }

  /**
   * Marca a vaga como "não candidatada (ainda)", com o motivo, sem gastar
   * tentativa: a próxima passada tenta de novo. Os dados do card (título,
   * empresa, link) entram junto, para a linha do relatório fazer sentido.
   */
  function markPending(id, reason, card) {
    const job = state.jobs[id] || {};
    if (job.appliedAt) return;

    const meta = card ? readCardMeta(card) : {};

    upsertJob(
      id,
      Object.assign(meta, {
        applyStatus: APPLY_PENDING,
        applyReason: reason || '',
        applyAttempts: job.applyAttempts || 0,
      })
    );
  }

  /** Guarda o resultado na vaga e, se enviou, lança na cota. */
  async function recordApplyResult(id, result) {
    const current = state.jobs[id] || {};
    const attempts = Math.min(CONFIG.applyMaxAttempts, (current.applyAttempts || 0) + 1);
    const now = new Date().toISOString();

    const patch = {
      applyStatus: result.status,
      applyAttempts: attempts,
      applyReason: applyReasonText(result),
      applyTriedAt: now,
    };

    if (result.status === 'enviada') {
      patch.appliedAt = now;
      state.apps.push(Date.now());
      setSinceBreak(state.sinceBreak + 1);
      await persistApps();
      await bumpApplied();
    } else if (result.status === 'externa') {
      // Não é para nós: não vale gastar outra tentativa.
      patch.applyAttempts = CONFIG.applyMaxAttempts;
    }

    upsertJob(id, patch);

    // Quem foi candidatado não guarda motivo antigo (de uma tentativa anterior).
    if (result.status === 'enviada' && state.jobs[id]) {
      state.jobs[id].applyReason = '';
      schedulePersist();
    }

    broadcastProgress();
  }

  /* ------------------------------------------------------------------------ */
  /* Fila de termos (orquestrada pelo pop-up, pelo agendador ou por retomada)  */
  /* ------------------------------------------------------------------------ */

  /** Lê a fila atual do storage. */
  async function getRun() {
    try {
      const data = await chrome.storage.local.get(STORAGE_RUN_KEY);
      return data[STORAGE_RUN_KEY] || null;
    } catch (error) {
      return null;
    }
  }

  function saveRun(run) {
    return chrome.storage.local.set({ [STORAGE_RUN_KEY]: run }).catch(() => {});
  }

  function clearRun() {
    state.run = null;
    clearResumeTimer();
    return chrome.storage.local.remove(STORAGE_RUN_KEY).catch(() => {});
  }

  function clearResumeTimer() {
    if (state.resumeTimer) clearTimeout(state.resumeTimer);
    state.resumeTimer = null;
  }

  /** A página atual serve para varredura? (evita login/authwall/checkpoint) */
  function isUsablePage() {
    return (
      /\/jobs/.test(location.pathname) &&
      !/\/login|\/authwall|\/checkpoint|\/uas\//.test(location.pathname)
    );
  }

  /** Espera os cards aparecerem (o LinkedIn monta a lista de forma assíncrona). */
  async function waitForList(timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (state.abort) return false;
      if (getCards().length) return true;
      await wait(CONFIG.waitListPollMs);
    }

    return getCards().length > 0;
  }

  /**
   * Retoma uma fila deixada pelo pop-up. É chamado no load da página, para a
   * varredura continuar sozinha depois de cada navegação (uma por termo).
   */
  async function resumeRun() {
    const run = await getRun();

    if (!run || run.running !== true) return false;

    if (!isUsablePage()) {
      await clearRun(); // caímos em login/checkpoint: encerra a fila
      return false;
    }

    state.run = run;
    state.sinceBreak = Math.max(0, Number(run.sinceBreak) || 0);
    broadcastProgress();
    return true;
  }

  /**
   * Avança para o próximo termo da fila (ou encerra). O storage é a fonte da
   * verdade: se o pop-up removeu a fila (botão Parar), paramos aqui mesmo.
   */
  async function advanceRun() {
    const run = await getRun();

    if (!run || run.running !== true) {
      state.run = null;
      broadcastProgress();
      return;
    }

    const urls = Array.isArray(run.urls) ? run.urls : [''];
    const nextIndex = (run.index || 0) + 1;

    if (nextIndex >= urls.length) {
      await clearRun();
      broadcastProgress();
      return;
    }

    const nextRun = Object.assign({}, run, {
      index: nextIndex,
      term: (run.terms && run.terms[nextIndex]) || '',
      appliedInTerm: 0, // as cotas por termo zeram a cada termo
      visitedInTerm: 0,
      paused: false,
      resumeAt: null,
    });

    state.run = nextRun;
    await saveRun(nextRun);
    broadcastProgress();

    const nextUrl = urls[nextIndex];

    if (nextUrl && nextUrl !== location.href) {
      location.assign(nextUrl); // recarrega a página; a fila é retomada no load
    } else {
      startScan(); // mesma URL: apenas recomeça a varredura por aqui
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Pausa e retomada dinâmica (cotas e janela do agendador)                   */
  /* ------------------------------------------------------------------------ */

  /** A janela do agendador está aberta? Se não, quando ela abre? */
  function windowState() {
    const schedule = (state.settings || parseSettings(null)).schedule;

    if (!schedule.enabled) return { open: true, resumeAt: null, reason: 'schedule' };
    if (isWithinSchedule(new Date(), schedule)) return { open: true, resumeAt: null, reason: 'schedule' };

    const next = nextScheduleStart(new Date(), schedule);
    return { open: false, resumeAt: next ? next.getTime() : null, reason: 'schedule' };
  }

  /**
   * Podemos rodar agora? Considera a janela do agendador e o período de descanso
   * imposto pela proteção da conta (quando o LinkedIn sinaliza limite de uso).
   */
  function gateState() {
    const guard = guardUntil();
    if (guard) return { open: false, resumeAt: guard, reason: 'guard' };

    return windowState();
  }

  /**
   * Mantém a fila viva, porém pausada, até o horário liberar (cota estourada,
   * janela do agendador fechada, descanso de proteção ou vez do usuário). O
   * service worker também cutuca a aba nesse horário, então a retomada acontece
   * mesmo se esta página for recarregada.
   */
  async function pauseRunUntil(resumeAt, reason) {
    const run = await getRun();
    const when =
      Number.isFinite(resumeAt) && resumeAt > Date.now() ? resumeAt : Date.now() + 60000;

    if (!run || run.running !== true) {
      state.run = null;
      broadcastProgress();
      return;
    }

    const next = Object.assign({}, run, {
      paused: true,
      resumeAt: when,
      pauseReason: reason || 'cota',
    });

    state.run = next;
    await saveRun(next);
    broadcastProgress();

    scheduleResume(when);
  }

  function scheduleResume(atMs) {
    clearResumeTimer();

    const delay = Math.max(1000, Math.min(atMs - Date.now(), CONFIG.resumeTimerCapMs));
    state.resumeTimer = setTimeout(() => {
      resumeNow().catch(() => {});
    }, delay);
  }

  /** Retoma a fila pausada (timer local ou pedido do agendador). */
  async function resumeNow() {
    clearResumeTimer();

    const run = await getRun();

    if (!run || run.running !== true) {
      state.run = null;
      broadcastProgress();
      return;
    }

    const next = Object.assign({}, run, {
      paused: false,
      resumeAt: null,
      pauseReason: null,
    });

    state.run = next;
    await saveRun(next);
    broadcastProgress();

    await waitForList(CONFIG.waitListTimeoutMs);
    await startScan();
  }

  /* ------------------------------------------------------------------------ */
  /* Varredura (loop principal)                                                */
  /* ------------------------------------------------------------------------ */

  /** Persiste a fila com debounce (não vale gravar a cada vaga visitada). */
  const scheduleRunPersist = debounce(() => {
    if (state.run && state.run.running) saveRun(state.run);
  }, 2000);

  /** Conta a vaga visitada neste termo. */
  function bumpVisited() {
    if (!state.run) return;

    state.run = Object.assign({}, state.run, {
      visitedInTerm: (state.run.visitedInTerm || 0) + 1,
    });

    scheduleRunPersist();
  }

  /** A vaga ainda precisa de trabalho? (falta descrição ou candidatura) */
  function needsWork(id, settings) {
    const job = state.jobs[id] || {};

    if (!job.description) return true;
    if (!settings.apply.enabled) return false;
    if (job.appliedAt) return false;

    return (job.applyAttempts || 0) < CONFIG.applyMaxAttempts;
  }

  /**
   * Motivos usados no relatório quando a vaga fica sem candidatura porque a
   * varredura parou antes de chegar nela.
   */
  const STOP_REASONS = {
    quota: 'A cota de candidaturas estourou; esta vaga ficou para a próxima passada.',
    term_done: 'A cota de candidaturas deste termo acabou; esta vaga ficou para a próxima passada.',
    scan_cap: 'A varredura deste termo atingiu o teto de vagas; esta vaga ficou para a próxima passada.',
    usuario: 'Você estava usando o navegador; a vaga ficou para a próxima passada.',
  };

  /** Por que paramos o termo atual (ou null para continuar varrendo). */
  function stopReason(settings) {
    const run = state.run || {};
    const visited = run.visitedInTerm || 0;
    const applied = run.appliedInTerm || 0;

    if (!settings.apply.enabled) {
      return visited >= CONFIG.maxJobVisitsPerRun ? 'scan_cap' : null;
    }

    if (visited >= settings.apply.scanPerTerm) return 'scan_cap';
    if (applied >= settings.apply.perTerm) return 'term_done';
    if (!quotaNow().ok) return 'quota';

    return null;
  }

  /** Visita a vaga: captura a descrição e, se a cota permitir, candidata-se. */
  async function processCard(card, id, settings) {
    bumpVisited();
    await captureForCard(card, id);
    await humanPause(CONFIG.clickDelayMs);

    if (state.abort || !settings.apply.enabled) return;

    const job = state.jobs[id] || {};
    if (job.appliedAt) return;
    if ((job.applyAttempts || 0) >= CONFIG.applyMaxAttempts) return;
    if (!quotaNow().ok) return;

    // Você está usando a página agora? Então esperamos (sem roubar o seu clique).
    if (!(await waitForUserIdle(settings))) {
      markPending(id, STOP_REASONS.usuario, card);
      state.userBusy = true;
      return;
    }

    if (state.abort) return;

    // Finge que leu a vaga antes de decidir se candidatar.
    await readingPause(settings);
    if (state.abort) return;

    // Intervalo variável entre candidaturas (evita rajada robotizada).
    await humanPause(randomDelay(settings.apply.minDelayMs, settings.apply.maxDelayMs), 0.25);
    if (state.abort) return;

    // A cada N candidaturas, uma pausa longa de verdade.
    await longBreak(settings);
    if (state.abort) return;

    // Antes de mexer em qualquer coisa: será que o LinkedIn já está barrando?
    const blocked = detectRateLimit();

    if (blocked) {
      await recordApplyResult(id, { status: 'bloqueio', error: blocked });
      await tripGuard(blocked);
      return;
    }

    const result = await applyToJob();
    await recordApplyResult(id, result);

    if (result.status === 'bloqueio') {
      await tripGuard(result.error);
      return;
    }

    // Candidatura enviada e, mesmo assim, aviso de limite: descansamos.
    const afterBlock = result.status === 'enviada' ? detectRateLimit() : null;

    if (afterBlock) await tripGuard(afterBlock);
  }

  async function startScan() {
    if (state.scanning) return;

    // Fora da janela do agendador (ou no descanso de proteção) não varremos: a
    // fila fica parada e volta sozinha quando o horário abrir.
    const gate = gateState();
    if (!gate.open) {
      await pauseRunUntil(gate.resumeAt, gate.reason);
      return;
    }

    state.scanning = true;
    state.abort = false;
    state.lastRun = new Date().toISOString();
    broadcastProgress();

    const settings = state.settings || (await getSettings());
    state.settings = settings;

    let stop = null; // 'quota' | 'term_done' | 'scan_cap' | 'usuario'
    let round = 0;

    try {
      await loadApps();

      while (!state.abort && round <= CONFIG.maxScrollRounds) {
        for (const card of getCards()) {
          if (state.abort) break;

          // Antes de mexer na página: sinal de bloqueio do LinkedIn?
          const blocked = detectRateLimit();

          if (blocked) {
            await tripGuard(blocked);
            break;
          }

          const id = getJobId(card);
          if (!id || !needsWork(id, settings)) continue;

          stop = stopReason(settings);
          if (stop) {
            if (settings.apply.enabled) markPending(id, STOP_REASONS[stop], card);
            break;
          }

          await processCard(card, id, settings);

          // Você assumiu a página: paramos de mexer nela e descansamos um pouco.
          if (state.userBusy) {
            state.userBusy = false;
            stop = 'usuario';
            break;
          }
        }

        if (state.abort || stop) break;

        // Se você está mexendo na página agora, deixamos a rolagem em paz.
        if (!(await waitForUserIdle(settings))) {
          stop = 'usuario';
          break;
        }

        const progressed = await scrollList();
        if (!progressed) break; // nada novo carregou: fim da lista
        round += 1;
      }
    } finally {
      state.scanning = false;
      const aborted = state.abort;
      state.abort = false;

      await persist();
      broadcastProgress();

      if (!aborted) {
        // Cota estourada (ou vez do usuário): pausa e volta sozinho. Nos demais
        // casos, segue para o próximo termo da fila.
        if (stop === 'quota') {
          await pauseRunUntil(quotaNow().resumeAt, 'cota');
        } else if (stop === 'usuario') {
          await pauseRunUntil(Date.now() + CONFIG.userBusyPauseMs, 'usuario');
        } else {
          await advanceRun();
        }
      } else if (state.guardStopped) {
        // O LinkedIn sinalizou limite de uso: a fila fica pausada e volta só
        // depois do descanso (a proteção também vale para o agendador).
        state.guardStopped = false;
        await pauseRunUntil(guardUntil(), 'guard');
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* MutationObserver: reage ao carregamento dinâmico do LinkedIn              */
  /* ------------------------------------------------------------------------ */

  const onDomChanged = debounce(() => {
    // Durante a varredura o loop principal já controla tudo; fora dela,
    // aproveitamos para capturar a vaga que o usuário abriu manualmente.
    if (!state.scanning) syncSelectedJob();
  }, CONFIG.domDebounceMs);

  function startObserver() {
    if (state.observer) return;

    const root = queryFirst(SEL.list) || document.body;
    if (!root) return;

    state.observer = new MutationObserver(onDomChanged);
    state.observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Mensageria com o pop-up                                                   */
  /* ------------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message && message.type) {
      case MSG.PING:
        sendResponse({
          ok: true,
          count: Object.keys(state.jobs).length,
          scanning: state.scanning,
        });
        break;

      case MSG.START:
        if (state.scanning) {
          sendResponse({ ok: false, reason: 'already_scanning' });
          break;
        }
        if (message.run) {
          state.run = message.run;
          state.sinceBreak = Math.max(0, Number(message.run.sinceBreak) || 0);
          clearResumeTimer();
        }
        sendResponse({ ok: true, started: true });
        startScan().catch(() => {});
        break;

      case MSG.RESUME:
        // O agendador (background.js) cutuca a aba quando a cota libera.
        sendResponse({ ok: true, resuming: true });
        resumeNow().catch(() => {});
        break;

      case MSG.STOP:
        state.abort = true;
        clearRun();
        sendResponse({ ok: true, stopping: true });
        break;

      case MSG.CLEAR:
        // Apaga as vagas capturadas. O histórico de candidaturas (pegavaga_apps)
        // fica de pé de propósito: as cotas protegem a conta de uma rajada.
        state.abort = true;
        state.jobs = {};
        state.lastSyncedId = null;
        state.lastRun = null;
        clearRun();
        persist();
        broadcastProgress();
        sendResponse({ ok: true });
        break;
      default:
        break;
    }

    return false; // todas as respostas são síncronas
  });

  /* ------------------------------------------------------------------------ */
  /* Inicialização                                                             */
  /* ------------------------------------------------------------------------ */

  async function init() {
    await loadState();
    state.settings = await getSettings();
    await loadApps();
    await loadGuard();
    watchUserActivity();
    startObserver();
    broadcastProgress();

    // Fila ativa deixada pelo pop-up/agendador: espera a lista e já inicia.
    if (!(await resumeRun())) return;

    const run = state.run;

    // Veio pausada (cota estourada ou janela fechada): só volta no horário.
    if (run.paused && run.resumeAt && run.resumeAt > Date.now()) {
      scheduleResume(run.resumeAt);
      return;
    }

    await waitForList(CONFIG.waitListTimeoutMs);
    await startScan();
  }

  init().catch(() => {});
})();

