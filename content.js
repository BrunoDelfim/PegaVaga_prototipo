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
 * ===========================================================================*/

(() => {
  'use strict';

  /* ------------------------------------------------------------------------ */
  /* Chaves de armazenamento e configuração                                    */
  /* ------------------------------------------------------------------------ */

  const STORAGE_JOBS_KEY = 'pegavaga_jobs';
  const STORAGE_META_KEY = 'pegavaga_meta';

  const CONFIG = {
    clickDelayMs: 800, // espera após selecionar um card
    descriptionPollMs: 250, // intervalo de polling do painel de detalhes
    descriptionTimeoutMs: 6000, // tempo máximo esperando a descrição carregar
    scrollDelayMs: 900, // espera após rolar a lista
    maxScrollRounds: 60, // limite de rolagens por varredura
    maxJobVisitsPerRun: 300, // limite de vagas visitadas por varredura
    persistDebounceMs: 400, // debounce do salvamento em storage
    domDebounceMs: 300, // debounce do MutationObserver
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
    const payload = {
      type: 'PEGAVAGA_PROGRESS',
      count: Object.keys(state.jobs).length,
      scanning: state.scanning,
      lastRun: state.lastRun,
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
  /* Varredura (loop principal)                                                */
  /* ------------------------------------------------------------------------ */

  async function startScan() {
    if (state.scanning) return;

    state.scanning = true;
    state.abort = false;
    state.lastRun = new Date().toISOString();
    broadcastProgress();

    let visits = 0;
    let round = 0;

    try {
      while (!state.abort && round <= CONFIG.maxScrollRounds) {
        const cards = getCards();

        for (const card of cards) {
          if (state.abort) break;

          const id = getJobId(card);
          if (!id) continue;

          const existing = state.jobs[id];

          // Já temos a descrição? Apenas atualiza os metadados do card.
          if (existing && existing.description) {
            upsertJob(id, readCardMeta(card));
            continue;
          }

          if (visits >= CONFIG.maxJobVisitsPerRun) {
            state.abort = true;
            break;
          }

          visits += 1;
          await captureForCard(card, id);
          await wait(CONFIG.clickDelayMs);
        }

        if (state.abort) break;

        const progressed = await scrollList();
        if (!progressed) break; // nada novo carregou: fim da lista
        round += 1;
      }
    } finally {
      state.scanning = false;
      state.abort = false;
      await persist();
      broadcastProgress();
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
      case 'PEGAVAGA_PING':
        sendResponse({
          ok: true,
          count: Object.keys(state.jobs).length,
          scanning: state.scanning,
        });
        break;

      case 'PEGAVAGA_START':
        if (state.scanning) {
          sendResponse({ ok: false, reason: 'already_scanning' });
          break;
        }
        sendResponse({ ok: true, started: true });
        startScan();
        break;

      case 'PEGAVAGA_STOP':
        state.abort = true;
        sendResponse({ ok: true, stopping: true });
        break;

      case 'PEGAVAGA_CLEAR':
        state.abort = true;
        state.jobs = {};
        state.lastSyncedId = null;
        state.lastRun = null;
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
    startObserver();
    broadcastProgress();
  }

  init();
})();

