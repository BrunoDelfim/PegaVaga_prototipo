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

    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    target.click();
  }

  /** Clica no card e espera a descrição correspondente aparecer no painel. */
  async function captureForCard(card, id) {
    const meta = readCardMeta(card);
    selectCard(card);

    const deadline = Date.now() + CONFIG.descriptionTimeoutMs;

    while (Date.now() < deadline) {
      await wait(CONFIG.descriptionPollMs);

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
            index: run.index || 0,
            total: Array.isArray(run.urls) ? run.urls.length : 1,
            term: run.term || '',
            appliedInTerm: run.appliedInTerm || 0,
            visitedInTerm: run.visitedInTerm || 0,
            appliedTotal: run.appliedTotal || 0,
          }
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

    const container = findScrollContainer();
    if (!container) {
      window.scrollBy(0, Math.round(window.innerHeight * 0.9));
      await wait(CONFIG.scrollDelayMs);
      return getCards().length > before;
    }

    const previousTop = container.scrollTop;
    container.scrollTop = Math.min(
      container.scrollHeight,
      container.scrollTop + Math.round(container.clientHeight * 0.9)
    );

    await wait(CONFIG.scrollDelayMs);

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

  /** Fecha o modal (descartando o formulário) para não deixar lixo na tela. */
  async function closeModal(modal, discard) {
    if (!modal || !document.contains(modal)) return;

    const button =
      (discard && queryFirst(APPLY_SEL.discard, modal)) ||
      queryFirst(APPLY_SEL.discard, modal) ||
      queryFirst(APPLY_SEL.dismiss, modal);

    if (button) {
      button.click();
      await wait(CONFIG.applyStepDelayMs);

      // O LinkedIn pede confirmação antes de descartar.
      const confirm = queryFirst(APPLY_SEL.discard);
      if (confirm && confirm !== button && isVisible(confirm)) {
        confirm.click();
        await wait(CONFIG.applyStepDelayMs);
      }
    }

    if (document.contains(modal)) {
      const dismiss = queryFirst(APPLY_SEL.dismiss, modal) || queryFirst(APPLY_SEL.dismiss);
      if (dismiss) {
        dismiss.click();
        await wait(CONFIG.applyStepDelayMs);
      }
    }
  }

  /** Fecha o aviso de sucesso ("Concluir"), se ele aparecer. */
  async function finishApply(modal) {
    if (document.contains(modal) && looksSubmitted(modal)) {
      const done = queryFirst(APPLY_SEL.dismiss, modal) || queryFirst(APPLY_SEL.dismiss);
      if (done && isVisible(done)) {
        done.click();
        await wait(CONFIG.applyStepDelayMs);
      }
    }

    const leftover = findModal();
    if (leftover) {
      const dismiss = queryFirst(APPLY_SEL.dismiss, leftover);
      if (dismiss && isVisible(dismiss)) {
        dismiss.click();
        await wait(CONFIG.applyStepDelayMs);
      }
    }
  }

  /**
   * Preenche e envia a candidatura simplificada da vaga aberta no painel.
   * Devolve { status }, um destes:
   *   enviada   → candidatura confirmada pelo LinkedIn;
   *   externa   → botão manda para um site de fora (não automatizamos);
   *   sem_botao → a vaga não tem botão de candidatura;
   *   sem_modal → clicou e o formulário não abriu;
   *   travada   → parou em um campo obrigatório que não sabemos preencher;
   *   incompleta→ estourou o tempo/etapas do formulário;
   *   cancelada → o usuário pediu para parar no meio.
   */
  async function applyToJob() {
    const button = findApplyButton();

    if (!button) return { status: 'sem_botao' };
    if (!isEasyApply(button)) return { status: 'externa' };

    button.click();

    const modal = await waitForModal(CONFIG.applyModalTimeoutMs);
    if (!modal) return { status: 'sem_modal' };

    const deadline = Date.now() + CONFIG.applyFlowTimeoutMs;
    let steps = 0;

    while (Date.now() < deadline && steps < CONFIG.applyMaxSteps) {
      if (state.abort) {
        await closeModal(modal, true);
        return { status: 'cancelada' };
      }

      await wait(CONFIG.applyStepDelayMs);

      if (!document.contains(modal) || looksSubmitted(modal)) {
        await finishApply(modal);
        return { status: 'enviada' };
      }

      const action = getModalAction(modal);

      // Sem botão principal: campo obrigatório pendente (telefone, pergunta…).
      if (!action) {
        await closeModal(modal, true);
        return { status: 'travada' };
      }

      action.button.click();
      steps += 1;

      if (action.kind === 'submit') {
        await wait(CONFIG.applyStepDelayMs * 2);
        if (!document.contains(modal) || looksSubmitted(modal)) {
          await finishApply(modal);
          return { status: 'enviada' };
        }
      }
    }

    await closeModal(modal, true);
    return { status: 'incompleta' };
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

  /** Guarda o resultado na vaga e, se enviou, lança na cota. */
  async function recordApplyResult(id, result) {
    const current = state.jobs[id] || {};
    const attempts = Math.min(CONFIG.applyMaxAttempts, (current.applyAttempts || 0) + 1);
    const patch = { applyStatus: result.status, applyAttempts: attempts };

    if (result.status === 'enviada') {
      patch.appliedAt = new Date().toISOString();
      state.apps.push(Date.now());
      await persistApps();
      await bumpApplied();
    } else if (result.status === 'externa') {
      // Não é para nós: não vale gastar outra tentativa.
      patch.applyAttempts = CONFIG.applyMaxAttempts;
    }

    upsertJob(id, patch);
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

    if (!schedule.enabled) return { open: true, resumeAt: null };
    if (isWithinSchedule(new Date(), schedule)) return { open: true, resumeAt: null };

    const next = nextScheduleStart(new Date(), schedule);
    return { open: false, resumeAt: next ? next.getTime() : null };
  }

  /**
   * Mantém a fila viva, porém pausada, até o horário liberar (cota estourada ou
   * janela do agendador fechada). O service worker também cutuca a aba nesse
   * horário, então a retomada acontece mesmo se esta página for recarregada.
   */
  async function pauseRunUntil(resumeAt) {
    const run = await getRun();
    const when =
      Number.isFinite(resumeAt) && resumeAt > Date.now() ? resumeAt : Date.now() + 60000;

    if (!run || run.running !== true) {
      state.run = null;
      broadcastProgress();
      return;
    }

    const next = Object.assign({}, run, { paused: true, resumeAt: when });
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

    const next = Object.assign({}, run, { paused: false, resumeAt: null });
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
    await wait(CONFIG.clickDelayMs);

    if (state.abort || !settings.apply.enabled) return;

    const job = state.jobs[id] || {};
    if (job.appliedAt) return;
    if ((job.applyAttempts || 0) >= CONFIG.applyMaxAttempts) return;
    if (!quotaNow().ok) return;

    // Intervalo variável entre candidaturas (evita rajada robotizada).
    await wait(randomDelay(settings.apply.minDelayMs, settings.apply.maxDelayMs));
    if (state.abort) return;

    await recordApplyResult(id, await applyToJob());
  }

  async function startScan() {
    if (state.scanning) return;

    // Fora da janela do agendador não varremos: a fila espera o horário abrir.
    const gate = windowState();
    if (!gate.open) {
      await pauseRunUntil(gate.resumeAt);
      return;
    }

    state.scanning = true;
    state.abort = false;
    state.lastRun = new Date().toISOString();
    broadcastProgress();

    const settings = state.settings || (await getSettings());
    state.settings = settings;

    let stop = null; // 'quota' | 'term_done' | 'scan_cap'
    let round = 0;

    try {
      await loadApps();

      while (!state.abort && round <= CONFIG.maxScrollRounds) {
        for (const card of getCards()) {
          if (state.abort) break;

          const id = getJobId(card);
          if (!id || !needsWork(id, settings)) continue;

          stop = stopReason(settings);
          if (stop) break;

          await processCard(card, id, settings);
        }

        if (state.abort || stop) break;

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
        // Cota estourada: pausa e volta sozinho. Caso contrário: próximo termo.
        if (stop === 'quota') {
          await pauseRunUntil(quotaNow().resumeAt);
        } else {
          await advanceRun();
        }
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

