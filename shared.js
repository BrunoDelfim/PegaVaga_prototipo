/* =============================================================================
 * PegaVaga - shared.js
 * Constantes e utilitários puros compartilhados pelo pop-up, pelo content
 * script e pelo service worker (background.js). O arquivo é carregado nos três
 * contextos, por isso anexa tudo em globalThis.PegaVagaShared em vez de usar
 * módulos ES. Não use APIs de DOM aqui: o service worker não tem `document`.
 * ===========================================================================*/

'use strict';

globalThis.PegaVagaShared = (() => {
  /* Chaves usadas em chrome.storage.local. */
  const STORAGE = {
    jobs: 'pegavaga_jobs', // { [jobId]: { id, title, company, link, description } }
    meta: 'pegavaga_meta', // { lastRun, count, pageUrl }
    settings: 'pegavaga_settings', // busca + cotas de candidatura + agendador
    run: 'pegavaga_run', // fila de termos em andamento
    apps: 'pegavaga_apps', // timestamps (ms) das candidaturas enviadas
    guard: 'pegavaga_guard', // bloqueio temporário detectado (proteção da conta)
  };

  /* Tipos de mensagem trocadas entre pop-up, content script e agendador. */
  const MSG = {
    START: 'PEGAVAGA_START',
    STOP: 'PEGAVAGA_STOP',
    PING: 'PEGAVAGA_PING',
    CLEAR: 'PEGAVAGA_CLEAR',
    PROGRESS: 'PEGAVAGA_PROGRESS',
    RESUME: 'PEGAVAGA_RESUME',
  };

  const LINKEDIN_SEARCH_URL = 'https://www.linkedin.com/jobs/search/';

  const MAX_TERMS = 40; // trava de segurança por execução
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;
  const HISTORY_LIMIT = 500; // candidaturas guardadas (base das cotas móveis)
  const MIN_DELAY_MS = 1000;
  const MAX_DELAY_MS = 600000;

  const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const DEFAULT_SETTINGS = {
    baseUrl: LINKEDIN_SEARCH_URL,
    location: '',
    terms: [],
    apply: {
      enabled: false, // candidatar-se sozinho só se o usuário ligar
      perTerm: 8, // candidaturas por termo de busca
      perHour: 6, // janela móvel de 60 min
      per24h: 25, // janela móvel de 24 h
      perDay: 0, // dia corrido (00:00-23:59); 0 = sem limite
      scanPerTerm: 40, // teto de vagas visitadas por termo (trava de segurança)
      minDelayMs: 4000, // intervalo entre candidaturas (imita digitação humana)
      maxDelayMs: 12000,
      readMinMs: 1500, // pausa de "leitura" da vaga antes de se candidatar
      readMaxMs: 4500,
      respectUserActivity: true, // espera quando o usuário está mexendo na página
      breaksEnabled: true, // pausas longas periódicas entre candidaturas
      breakEvery: 10, // candidaturas entre uma pausa longa e outra
      breakMs: 90000, // duração base da pausa longa
    },
    schedule: {
      enabled: false,
      autoStart: true, // liga sozinho quando a janela de horário abre
      startTime: '08:00',
      stopTime: '18:00',
      days: [1, 2, 3, 4, 5], // 0 = domingo
      focusTab: true, // trazer a aba para frente (o Chrome pausa abas ocultas)
    },
  };

  /* ------------------------------------------------------------------------ */
  /* Utilidades numéricas                                                      */
  /* ------------------------------------------------------------------------ */

  /** Converte para inteiro dentro de [min, max]; usa o padrão se não der. */
  function num(value, min, max, fallback) {
    if (value === '' || value == null) return fallback;
    const parsed = Math.round(Number(value));
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  }

  /** Transforma texto (uma linha por termo) em lista limpa e sem repetições. */
  function normalizeTerms(raw) {
    const list = Array.isArray(raw) ? raw : String(raw || '').split(/\r?\n/);
    const seen = new Set();
    const out = [];

    for (const item of list) {
      const term = String(item == null ? '' : item)
        .trim()
        .replace(/\s+/g, ' ');
      if (!term) continue;

      const key = term.toLowerCase();
      if (seen.has(key)) continue;

      seen.add(key);
      out.push(term);
      if (out.length >= MAX_TERMS) break;
    }

    return out;
  }

  function isLinkedInUrl(url) {
    return /^https?:\/\/([a-z0-9-]+\.)*linkedin\.com\//i.test(String(url || ''));
  }

  function isLinkedInJobsUrl(url) {
    return isLinkedInUrl(url) && /\/jobs(\/|$|\?)/i.test(String(url));
  }

  /** Monta a URL de busca de um termo, reaproveitando a URL base informada. */
  function buildSearchUrl(baseUrl, term, location) {
    let url;
    try {
      url = new URL(baseUrl || LINKEDIN_SEARCH_URL);
    } catch (error) {
      return baseUrl || LINKEDIN_SEARCH_URL;
    }

    if (term) url.searchParams.set('keywords', term);
    if (location) url.searchParams.set('location', location);

    return url.toString();
  }

  /* ------------------------------------------------------------------------ */
  /* Horário e dias da semana                                                  */
  /* ------------------------------------------------------------------------ */

  /** "HH:MM" -> minutos desde a meia-noite (ou null se não for um horário). */
  function timeToMinutes(raw) {
    const match = /^\s*(\d{1,2})\s*:\s*(\d{1,2})\s*$/.exec(String(raw == null ? '' : raw));
    if (!match) return null;

    const hours = Number(match[1]);
    const mins = Number(match[2]);
    if (hours > 23 || mins > 59) return null;

    return hours * 60 + mins;
  }

  function minutesToTime(minutes) {
    const safe = Math.max(0, Math.min(1440 - 1, Math.round(Number(minutes) || 0)));
    const hh = String(Math.floor(safe / 60)).padStart(2, '0');
    const mm = String(safe % 60).padStart(2, '0');
    return hh + ':' + mm;
  }

  /** Aceita "8:5", "08:05" etc. e devolve sempre "HH:MM". */
  function normalizeTime(raw, fallback) {
    const minutes = timeToMinutes(raw);
    return minutes == null ? fallback : minutesToTime(minutes);
  }

  /** Lista de dias válidos (0=domingo … 6=sábado), sem repetições. */
  function normalizeDays(raw) {
    const list = Array.isArray(raw) ? raw : raw == null ? DEFAULT_SETTINGS.schedule.days : [raw];

    const out = [];
    for (const item of list) {
      if (item === '' || item == null) continue;

      const day = Math.round(Number(item));
      if (!Number.isFinite(day) || day < 0 || day > 6 || out.includes(day)) continue;

      out.push(day);
    }

    return out.sort((a, b) => a - b);
  }

  function formatDays(days) {
    const list = normalizeDays(days);
    if (list.length === 7) return 'todos os dias';
    if (!list.length) return 'nenhum dia';
    return list.map((day) => WEEKDAYS[day]).join(', ');
  }

  function startOfDayMs(ts) {
    const date = new Date(ts);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  }

  /** O instante está dentro da janela agendada? (sem agendador = sempre sim) */
  function isWithinSchedule(date, schedule) {
    const cfg = schedule || {};
    if (!cfg.enabled) return true;

    const days = normalizeDays(cfg.days);
    if (!days.length) return false;

    const start = timeToMinutes(cfg.startTime);
    const stop = timeToMinutes(cfg.stopTime);
    if (start == null || stop == null || start === stop) return true;

    const current = date.getHours() * 60 + date.getMinutes();
    const weekday = date.getDay();

    if (start < stop) {
      return days.includes(weekday) && current >= start && current < stop;
    }

    // Janela que cruza a meia-noite (ex.: 22:00 -> 06:00).
    if (current >= start) return days.includes(weekday);
    if (current < stop) return days.includes((weekday + 6) % 7);
    return false;
  }

  /** Próximo instante em que a janela agendada abre (Date ou null). */
  function nextScheduleStart(date, schedule) {
    const cfg = schedule || {};
    const start = timeToMinutes(cfg.startTime);
    const days = normalizeDays(cfg.days);
    if (start == null || !days.length) return null;

    const candidate = new Date(date);
    for (let i = 0; i < 8; i += 1) {
      if (i) candidate.setDate(candidate.getDate() + 1);
      candidate.setHours(Math.floor(start / 60), start % 60, 0, 0);
      if (candidate.getTime() > date.getTime() && days.includes(candidate.getDay())) {
        return candidate;
      }
    }

    return null;
  }

  /* ------------------------------------------------------------------------ */
  /* Configuração                                                              */
  /* ------------------------------------------------------------------------ */

  /** Normaliza o que veio do storage/formulário para uma configuração válida. */
  function parseSettings(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const apply = value.apply && typeof value.apply === 'object' ? value.apply : {};
    const schedule = value.schedule && typeof value.schedule === 'object' ? value.schedule : {};
    const defApply = DEFAULT_SETTINGS.apply;
    const defSchedule = DEFAULT_SETTINGS.schedule;

    const minDelayMs = num(apply.minDelayMs, MIN_DELAY_MS, MAX_DELAY_MS, defApply.minDelayMs);
    const maxDelayMs = num(apply.maxDelayMs, MIN_DELAY_MS, MAX_DELAY_MS, defApply.maxDelayMs);
    const readMinMs = num(apply.readMinMs, 0, 60000, defApply.readMinMs);
    const readMaxMs = num(apply.readMaxMs, 0, 60000, defApply.readMaxMs);

    return {
      baseUrl: String(value.baseUrl || DEFAULT_SETTINGS.baseUrl).trim(),
      location: String(value.location || '').trim(),
      terms: normalizeTerms(value.terms),
      apply: {
        enabled: apply.enabled === true,
        perTerm: num(apply.perTerm, 1, 500, defApply.perTerm),
        perHour: num(apply.perHour, 1, 1000, defApply.perHour),
        per24h: num(apply.per24h, 1, 2000, defApply.per24h),
        perDay: num(apply.perDay, 0, 5000, defApply.perDay),
        scanPerTerm: num(apply.scanPerTerm, 1, 500, defApply.scanPerTerm),
        minDelayMs: Math.min(minDelayMs, maxDelayMs),
        maxDelayMs: Math.max(minDelayMs, maxDelayMs),
        readMinMs: Math.min(readMinMs, readMaxMs),
        readMaxMs: Math.max(readMinMs, readMaxMs),
        respectUserActivity: apply.respectUserActivity !== false,
        breaksEnabled: apply.breaksEnabled !== false,
        breakEvery: num(apply.breakEvery, 1, 100, defApply.breakEvery),
        breakMs: num(apply.breakMs, 10000, 600000, defApply.breakMs),
      },
      schedule: {
        enabled: schedule.enabled === true,
        autoStart: schedule.autoStart !== false,
        startTime: normalizeTime(schedule.startTime, defSchedule.startTime),
        stopTime: normalizeTime(schedule.stopTime, defSchedule.stopTime),
        days: normalizeDays(schedule.days),
        focusTab: schedule.focusTab !== false,
      },
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Fila de execução                                                          */
  /* ------------------------------------------------------------------------ */

  /**
   * Monta a fila de termos: um item por termo, varrido em sequência. Sem termos
   * cadastrados, cai no modo antigo (varre a página de vagas aberta).
   */
  function buildRunQueue(settings) {
    const cfg = settings || DEFAULT_SETTINGS;
    const terms = Array.isArray(cfg.terms) ? cfg.terms : [];

    let urls;
    let runTerms;

    if (terms.length) {
      urls = terms.map((term) => buildSearchUrl(cfg.baseUrl, term, cfg.location));
      runTerms = terms.slice();
    } else {
      urls = [buildSearchUrl(cfg.baseUrl, '', cfg.location)];
      runTerms = [''];
    }

    return {
      running: true,
      paused: false,
      resumeAt: null,
      pauseReason: null,
      index: 0,
      term: runTerms[0],
      terms: runTerms,
      urls,
      appliedInTerm: 0,
      visitedInTerm: 0,
      appliedTotal: 0,
      sinceBreak: 0, // candidaturas desde a última pausa longa (ritmo humano)
      startedAt: new Date().toISOString(),
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Cotas de candidatura (dinâmicas)                                          */
  /* ------------------------------------------------------------------------ */

  function countBetween(timestamps, from, to) {
    let total = 0;
    for (const ts of timestamps) {
      if (ts >= from && ts < to) total += 1;
    }
    return total;
  }

  /** A candidatura mais antiga ainda dentro da janela (lista ordenada). */
  function firstBetween(timestamps, from, to) {
    for (const ts of timestamps) {
      if (ts >= from && ts < to) return ts;
    }
    return null;
  }

  /**
   * Calcula o que ainda cabe dentro das cotas.
   *
   * - `perHour`: janela móvel de 60 min;
   * - `per24h`: janela móvel de 24 h;
   * - `perDay`: dia corrido (zera à meia-noite local); 0 = sem limite;
   * - `perTerm`: reiniciado a cada termo pelo próprio content script.
   *
   * Quando uma cota estoura, devolvemos `resumeAt` (quando ela volta a ter
   * espaço) para o agendador retomar a execução sozinho.
   */
  function computeQuota(settings, appTimestamps, now, appliedInTerm) {
    const cfg = (settings && settings.apply) || DEFAULT_SETTINGS.apply;
    const when = Number.isFinite(now) ? now : Date.now();

    const timestamps = (Array.isArray(appTimestamps) ? appTimestamps : [])
      .map((value) => (typeof value === 'number' ? value : Date.parse(value)))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b);

    const hourStart = when - HOUR_MS;
    const day24Start = when - DAY_MS;
    const dayStart = startOfDayMs(when);

    const used = {
      term: Math.max(0, Number(appliedInTerm) || 0),
      hour: countBetween(timestamps, hourStart, Infinity),
      day24: countBetween(timestamps, day24Start, Infinity),
      day: countBetween(timestamps, dayStart, Infinity),
    };

    const limits = {
      term: cfg.perTerm,
      hour: cfg.perHour,
      day24: cfg.per24h,
      day: cfg.perDay > 0 ? cfg.perDay : Infinity,
    };

    const remaining = {
      term: limits.term - used.term,
      hour: limits.hour - used.hour,
      day24: limits.day24 - used.day24,
      day: limits.day === Infinity ? Infinity : limits.day - used.day,
    };

    // Instante em que cada cota estourada volta a liberar uma vaga: a
    // candidatura mais antiga da janela é que precisa "sair" dela.
    const waits = [];
    const blocks = [];

    if (remaining.hour <= 0) {
      const oldest = firstBetween(timestamps, hourStart, Infinity);
      waits.push((oldest == null ? when : oldest) + HOUR_MS + 1000);
      blocks.push('hour');
    }
    if (remaining.day24 <= 0) {
      const oldest = firstBetween(timestamps, day24Start, Infinity);
      waits.push((oldest == null ? when : oldest) + DAY_MS + 1000);
      blocks.push('day24');
    }
    if (remaining.day <= 0) {
      waits.push(dayStart + DAY_MS + 1000); // o dia corrido zera à meia-noite
      blocks.push('day');
    }

    const blockedBy = waits.length ? blocks[waits.indexOf(Math.min(...waits))] : null;
    const ok = remaining.term > 0 && !waits.length;

    return {
      ok,
      blockedBy,
      resumeAt: waits.length ? Math.min(...waits) : null,
      used,
      limits,
      remaining,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Candidatura automática: desfechos, motivos e resumo                       */
  /* ------------------------------------------------------------------------ */

  /**
   * Desfechos possíveis de uma tentativa de candidatura. `failure: false` é só
   * o sucesso; todo o resto entra no relatório de "não foi possível candidatar"
   * com o motivo legível em `reason`.
   */
  const APPLY_OUTCOMES = {
    enviada: {
      label: 'Enviada',
      failure: false,
      reason: '',
    },
    externa: {
      label: 'Externa (site da empresa)',
      failure: true,
      reason: 'A vaga não usa a Candidatura Simplificada: o botão leva ao site da empresa.',
    },
    sem_botao: {
      label: 'Sem botão de candidatura',
      failure: true,
      reason: 'A página da vaga não oferece botão de candidatura.',
    },
    sem_modal: {
      label: 'Formulário não abriu',
      failure: true,
      reason: 'O botão foi clicado, mas o formulário de candidatura não abriu.',
    },
    travada: {
      label: 'Travada em campo obrigatório',
      failure: true,
      reason:
        'O formulário parou em um campo ou pergunta obrigatória que a extensão não preenche.',
    },
    incompleta: {
      label: 'Formulário incompleto',
      failure: true,
      reason:
        'O formulário não foi concluído dentro do tempo e do número de etapas permitidos.',
    },
    cancelada: {
      label: 'Interrompida (Parar)',
      failure: true,
      reason: 'A candidatura foi abandonada porque você pediu para parar.',
    },
    bloqueio: {
      label: 'Parada por proteção do LinkedIn',
      failure: true,
      reason:
        'O LinkedIn pediu verificação ou limite de uso: a automação parou para proteger a sua conta.',
    },
    erro: {
      label: 'Erro na automação',
      failure: true,
      reason: 'Houve um erro inesperado durante a automação da candidatura.',
    },
  };

  /** Código de quem ainda não foi candidatado por falta de cota/horário. */
  const APPLY_PENDING = 'adiada';

  const APPLY_PENDING_LABEL = 'Adiada (sem cota ou fora do horário)';
  const APPLY_UNTOUCHED_LABEL = 'Não tentada';

  /* ------------------------------------------------------------------------ */
  /* Candidatura automática: motivos e resumo do relatório                     */
  /* ------------------------------------------------------------------------ */

  /** Variação aleatória em torno de um valor, para um ritmo menos robótico. */
  function jitter(baseMs, ratio, random) {
    const base = Math.max(0, Number(baseMs) || 0);
    const spread = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0.3));
    const raw = typeof random === 'function' ? Number(random()) : Math.random();
    const value = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0.5;
    return Math.max(0, Math.round(base * (1 - spread + value * spread * 2)));
  }

  function applyOutcomeLabel(code) {
    if (!code) return '';
    if (code === APPLY_PENDING) return APPLY_PENDING_LABEL;
    const outcome = APPLY_OUTCOMES[code];
    return outcome ? outcome.label : String(code);
  }

  /**
   * Por que esta vaga não foi candidatada? Devolve null quando a candidatura foi
   * enviada. Com `options.applyEnabled = false`, as vagas intocadas aparecem
   * como "candidatura automática desligada".
   */
  function describeApplyFailure(job, options) {
    const value = job || {};
    const code = value.applyStatus;

    if (code === 'enviada') return null;

    if (code === APPLY_PENDING) {
      return {
        code,
        label: APPLY_PENDING_LABEL,
        reason: value.applyReason || 'Aguardando a cota de candidaturas liberar.',
        pending: true,
      };
    }

    const outcome = APPLY_OUTCOMES[code];

    if (outcome) {
      return {
        code,
        label: outcome.label,
        reason: value.applyReason || outcome.reason,
        pending: false,
      };
    }

    const enabled = !options || options.applyEnabled !== false;

    return {
      code: 'nao_tentada',
      label: APPLY_UNTOUCHED_LABEL,
      reason: enabled
        ? value.description
          ? 'Ainda não chegou a vez desta vaga (teto de vagas por varredura).'
          : 'Vaga capturada sem a descrição completa.'
        : 'Candidatura automática desligada.',
      pending: true,
    };
  }

  /**
   * Totais do relatório: candidatadas x não candidatadas — que se divide em
   * definitivas (precisam de você) e adiadas (a extensão tenta depois).
   */
  function summarizeApply(jobs, options) {
    const list = Array.isArray(jobs) ? jobs : Object.values(jobs || {});
    const summary = { total: list.length, applied: 0, failed: 0, pending: 0, reasons: [] };
    const byLabel = new Map();

    for (const job of list) {
      const failure = describeApplyFailure(job, options);

      if (!failure) {
        summary.applied += 1;
        continue;
      }

      if (failure.pending) summary.pending += 1;
      else summary.failed += 1;

      const entry = byLabel.get(failure.label) || {
        code: failure.code,
        label: failure.label,
        pending: failure.pending,
        count: 0,
      };

      entry.count += 1;
      byLabel.set(failure.label, entry);
    }

    summary.reasons = Array.from(byLabel.values()).sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR')
    );

    return summary;
  }

  /** Ex.: "12 candidatada(s) · 8 não candidatada(s): 4 travada em campo…". */
  function describeApplySummary(summary) {
    if (!summary || !summary.total) return 'Nenhuma vaga capturada ainda.';

    let text = summary.applied + ' candidatada(s)';
    if (summary.failed) text += ' · ' + summary.failed + ' não candidatada(s)';
    if (summary.pending) text += ' · ' + summary.pending + ' na fila';

    const top = (summary.reasons || [])
      .filter((entry) => !entry.pending)
      .slice(0, 3)
      .map((entry) => entry.count + ' ' + entry.label.toLowerCase());

    return text + (top.length ? ': ' + top.join(' · ') : '');
  }

  /* ------------------------------------------------------------------------ */
  /* Textos de apoio para a interface                                          */
  /* ------------------------------------------------------------------------ */

  const LIMIT_LABELS = {
    term: 'por termo',
    hour: 'por hora',
    day24: 'em 24 h',
    day: 'no dia',
  };

  function formatCount(used, limit) {
    return used + '/' + (limit === Infinity ? '∞' : limit);
  }

  function formatClock(ts) {
    if (!Number.isFinite(ts)) return '--:--';
    const date = new Date(ts);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  }

  /** Ex.: "Candidaturas — 2/10 na hora · 5/40 em 24 h · 8 hoje". */
  function describeQuota(quota) {
    const used = quota.used;
    const limits = quota.limits;

    let text =
      'Candidaturas — ' +
      formatCount(used.hour, limits.hour) +
      ' na hora · ' +
      formatCount(used.day24, limits.day24) +
      ' em 24 h';

    if (limits.day !== Infinity) text += ' · ' + formatCount(used.day, limits.day) + ' hoje';
    if (limits.term !== Infinity) text += ' · ' + formatCount(used.term, limits.term) + ' neste termo';

    return text;
  }

  function describeSchedule(schedule, now) {
    const cfg = schedule || {};
    if (!cfg.enabled) return 'Agendador desativado.';

    const window = formatDays(cfg.days) + ', ' + cfg.startTime + ' → ' + cfg.stopTime;

    if (isWithinSchedule(now || new Date(), cfg)) return 'Janela ativa: ' + window + '.';

    const next = nextScheduleStart(now || new Date(), cfg);
    if (!next) return 'Janela: ' + window + '.';

    const stamp = next.toLocaleString('pt-BR', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    return 'Janela: ' + window + ' · próxima: ' + stamp + '.';
  }

  return {
    STORAGE,
    MSG,
    DEFAULT_SETTINGS,
    LINKEDIN_SEARCH_URL,
    MAX_TERMS,
    HOUR_MS,
    DAY_MS,
    HISTORY_LIMIT,
    WEEKDAYS,
    LIMIT_LABELS,
    APPLY_OUTCOMES,
    APPLY_PENDING,
    num,
    normalizeTerms,
    isLinkedInUrl,
    isLinkedInJobsUrl,
    buildSearchUrl,
    normalizeTime,
    timeToMinutes,
    minutesToTime,
    normalizeDays,
    formatDays,
    startOfDayMs,
    isWithinSchedule,
    nextScheduleStart,
    parseSettings,
    buildRunQueue,
    computeQuota,
    jitter,
    applyOutcomeLabel,
    describeApplyFailure,
    summarizeApply,
    describeApplySummary,
    describeQuota,
    describeSchedule,
    formatClock,
  };
})();
