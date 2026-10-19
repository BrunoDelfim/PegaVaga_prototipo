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
    theme: 'pegavaga_theme', // 'light' | 'dark' escolhido na lâmpada do cabeçalho
    errors: 'pegavaga_errors', // últimos erros registrados (base do "copiar diagnóstico")
    reports: 'pegavaga_reports', // relatos de erro (fila local, com status)
    // { left, top } — onde a janelinha de ajuda foi deixada da última vez.
    pos: 'pegavaga_ajuda_pos',
  };

  /* A janelinha do pedido de ajuda: largura fixa. `altura` é o tamanho de
   * criação e também o TETO: se o conteúdo couber, o ajuda.js encolhe; se não,
   * mantém 470 e o corpo ganha barra de rolagem. Não há altura mínima fixa. */
  const JANELINHA = { largura: 372, altura: 470, alturaMax: 470 };

  /* Tipos de mensagem trocadas entre pop-up, content script e agendador. */
  const MSG = {
    START: 'PEGAVAGA_START',
    STOP: 'PEGAVAGA_STOP',
    STOP_ALL: 'PEGAVAGA_STOP_ALL', // pop-up → worker: para tudo e fecha cartões/notificações
    PING: 'PEGAVAGA_PING',
    CLEAR: 'PEGAVAGA_CLEAR',
    PROGRESS: 'PEGAVAGA_PROGRESS',
    RESUME: 'PEGAVAGA_RESUME',
    HELP: 'PEGAVAGA_HELP', // content → background: mostra a notificação de ajuda
    HELP_CLEAR: 'PEGAVAGA_HELP_CLEAR', // content → background: fecha a notificação
    AJUDA_PEDIDO: 'PEGAVAGA_AJUDA_PEDIDO', // content → background: abre a janelinha de ajuda
    AJUDA_RESPOSTA: 'PEGAVAGA_AJUDA_RESPOSTA', // background → content: a decisão do usuário
    AJUDA_FECHAR: 'PEGAVAGA_AJUDA_FECHAR', // content → background: recolhe a janelinha
    AJUDA_RESPOSTA_JANELA: 'PEGAVAGA_AJUDA_RESPOSTA_JANELA', // janelinha → background
    SKIP: 'PEGAVAGA_SKIP', // pop-up/notificação → content: pula a vaga travada
    DONE: 'PEGAVAGA_DONE', // content → background: varredura terminou (ou parou por proteção)
    REPORT: 'PEGAVAGA_REPORT', // content → background: relato de erro criado (mostrar notificação)
    REPORT_SEND: 'PEGAVAGA_REPORT_SEND', // pop-up → background: envia este relato
    REPORT_KEEP: 'PEGAVAGA_REPORT_KEEP', // pop-up → background: mantém este relato local
  };

  const LINKEDIN_SEARCH_URL = 'https://www.linkedin.com/jobs/search/';
  // Filtro nativo do LinkedIn: `f_AL=true` deixa na lista só vagas com
  // Candidatura Simplificada (Easy Apply).
  const LINKEDIN_EASY_APPLY_PARAM = 'f_AL';

  const MAX_TERMS = 40; // trava de segurança por execução

  // Teto do banco de vagas (chrome.storage.local): descrição gigante é cortada e,
  // passando do limite de vagas, as mais antigas saem. Ver trimJobs().
  const MAX_JOBS = 5000;
  const DESC_MAX_CHARS = 6000;

  const ERROR_KEEP = 50; // erros guardados para o "copiar diagnóstico"
  const HOUR_MS = 3600000;
  const DAY_MS = 86400000;
  const HISTORY_LIMIT = 500; // candidaturas guardadas (base das cotas móveis)
  const MIN_DELAY_MS = 1000;
  const MAX_DELAY_MS = 600000;

  const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

  const DEFAULT_SETTINGS = {
    baseUrl: LINKEDIN_SEARCH_URL,
    location: '',
    locale: 'auto', // 'auto' | 'pt' | 'en' — idioma da interface
    // Sempre ligado (a interface mostra o interruptor desativado): a extensão só
    // trabalha com Candidatura Simplificada.
    easyApplyOnly: true, // busca só vagas com Candidatura Simplificada (filtro f_AL)
    terms: [],
    apply: {
      // Sempre ligado (interruptor desativado na interface): a extensão sempre
      // candidata — não existe mais o modo "só rastrear vagas".
      enabled: true,
      dryRun: false, // modo simulação: preenche o formulário e NÃO envia
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
      fillRequired: false, // perguntas obrigatórias: só responde se o usuário ligar
      answerYes: true, // resposta padrão em perguntas de Sim/Não
      answerNumber: 1, // resposta padrão em campo numérico (anos, quantidade…)
      answerText: '', // resposta padrão em texto livre (vazio = não inventa)
      answers: {}, // respostas específicas: { "palavra-chave da pergunta": "resposta" }
      helpOnStuck: true, // pede ajuda (notificação) em vez de descartar a vaga travada
      notifyOnFinish: true, // avisa na área de trabalho quando a varredura termina
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
  /* Idioma (pt-BR / en)                                                       */
  /* ------------------------------------------------------------------------ */

  const LOCALES = ['pt', 'en'];
  const DEFAULT_LOCALE = 'pt'; // idioma-fonte: é o texto que aparece no código

  // Idioma escolhido no pop-up ('auto' = segue o navegador).
  let chosenLocale = null;

  /** 'pt' | 'en' | '' (quando é "auto"/desconhecido). */
  function normalizeLocale(value) {
    const raw = String(value == null ? '' : value).trim().toLowerCase();

    if (!raw || raw === 'auto') return '';
    if (raw.startsWith('pt')) return 'pt';
    if (raw.startsWith('en')) return 'en';

    return '';
  }

  /** Idioma do navegador, caindo no padrão quando não é pt nem en. */
  function browserLocale() {
    const nav = typeof navigator === 'object' && navigator ? navigator : null;
    const tag = nav ? nav.language || (nav.languages && nav.languages[0]) : '';

    return normalizeLocale(tag) || DEFAULT_LOCALE;
  }

  /** Troca o idioma da interface ('auto' volta a seguir o navegador). */
  function setLocale(value) {
    chosenLocale = normalizeLocale(value) || null;
    return locale();
  }

  /**
   * Padrões derivados das chaves do dicionário que têm marcadores: `{ n }` vira
   * um grupo. Servem para traduzir texto **já pronto**, com números dentro — é
   * o que o pop-up usa para traduzir a tela sem tocar em cada `textContent`.
   */
  // Padrões derivados do dicionário. São calculados na **primeira tradução**
  // (e não no carregamento): o dicionário é declarado mais abaixo no arquivo.
  let uiPatterns = null;

  function uiPatternsList() {
    if (uiPatterns) return uiPatterns;

    uiPatterns = Object.keys(UI_EN)
      .filter((chave) => /\{[a-z0-9_]+\}/i.test(chave))
      .map((chave) => {
        const sentinelas = [];
        const chaveSegura = chave.replace(/\{([a-z0-9_]+)\}/gi, (todo, nome) => {
          sentinelas.push(nome);
          return '\u0000' + (sentinelas.length - 1) + '\u0000';
        });

        const escapado = chaveSegura.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(
          '^' + escapado.replace(/\u0000(\d+)\u0000/g, () => '([\\s\\S]+?)') + '$'
        );

        return { chave, regex, sentinelas };
      });

    return uiPatterns;
  }

  /**
   * Traduz um valor que caiu dentro de um marcador (ex.: o motivo da pausa em
   * `Pausada por { motivo } até …`). Olha o dicionário direto e depois os
   * padrões — **uma passada só**, sem recursão, para `translate()` e `t()` não
   * ficarem se chamando.
   */
  function translateValue(valor, idioma) {
    const lang = normalizeLocale(idioma) || locale();
    const texto = String(valor == null ? '' : valor);

    if (lang !== 'en') return texto;
    if (UI_EN[texto] != null) return UI_EN[texto];

    for (const padrao of uiPatternsList()) {
      const achado = texto.match(padrao.regex);
      if (!achado) continue;

      const subs = {};
      padrao.sentinelas.forEach((nome, i) => {
        subs[nome] = achado[i + 1];
      });

      return t(padrao.chave, subs, 'en');
    }

    return texto;
  }

  /**
   * Decide o que escrever num texto da tela, guardando o original em português.
   * É o miolo do `localizeDom` do pop-up, puro de propósito: o pop-up só aplica
   * o resultado, e o teste cobre os casos chatos (texto recém-escrito pelo
   * render, troca de idioma e ir-e-voltar).
   *
   * @param {string} atual texto que está na tela agora
   * @param {{pt: string, en: string}|null} registro o que já traduzimos antes
   * @param {string} [idioma]
   * @returns {{ texto: string, registro: {pt: string, en: string} }}
   */
  function syncText(atual, registro, idioma) {
    const lang = normalizeLocale(idioma) || locale();
    let reg = registro;

    // Texto novo (o render acabou de escrever) vira o novo original; texto que
    // é o que nós mesmos escrevemos mantém o registro.
    if (!reg || (atual !== reg.pt && atual !== reg.en)) {
      reg = { pt: atual, en: translate(atual, 'en') };
    }

    return { texto: lang === 'en' ? reg.en : reg.pt, registro: reg };
  }

  /**
   * Traduz um texto já montado, preservando os espaços das pontas (texto de
   * nó do DOM vem com quebras e indentação). A chave do dicionário é procurada
   * com os espaços **internos normalizados**: um rótulo quebrado em duas linhas
   * no HTML é o mesmo texto que o de uma linha só — sem isso, só traduziam os
   * rótulos que cabiam numa linha (era o que acontecia com metade do painel).
   *
   * Chave direta primeiro; depois as chaves com marcadores, como
   * `{ n } vagas capturadas`. Texto sem tradução volta como veio.
   */
  function translate(texto, idioma) {
    const base = String(texto == null ? '' : texto);
    const lang = normalizeLocale(idioma) || locale();

    if (lang !== 'en' || !base) return base;

    const antes = (base.match(/^\s*/) || [''])[0];
    const depois = (base.match(/\s*$/) || [''])[0];
    const cru = base.slice(antes.length, base.length - depois.length);

    if (!cru) return base;

    const miolo = cru.replace(/\s+/g, ' ');

    if (UI_EN[miolo] != null) return antes + UI_EN[miolo] + depois;

    for (const padrao of uiPatternsList()) {
      const achado = miolo.match(padrao.regex);
      if (!achado) continue;

      const subs = {};
      padrao.sentinelas.forEach((nome, i) => {
        subs[nome] = translateValue(achado[i + 1], 'en');
      });

      return antes + t(padrao.chave, subs, 'en') + depois;
    }

    return base;
  }

  /** Idioma em uso agora. */
  function locale() {
    return chosenLocale || browserLocale();
  }

  /** Etiqueta de idioma para formatar data/hora (`toLocaleString`). */
  function dateLocale() {
    return locale() === 'en' ? 'en-GB' : 'pt-BR';
  }

  /**
   * Texto de interface no idioma em uso. A **chave é o próprio texto em
   * português**: assim o que se lê no código é o que o usuário lê na tela, e
   * texto ainda sem tradução aparece em português (nunca como `undefined`).
   *
   * `subs` troca os marcadores `{ nome }`, que são iguais nos dois idiomas. Um
   * valor que seja, ele mesmo, um texto de interface (o motivo da pausa, por
   * exemplo) também é traduzido — casamento direto, sem recursão.
   *
   * @param {string} texto texto base (pt)
   * @param {Object} [subs]
   * @param {string} [idioma] força um idioma (ex.: 'pt' para um arquivo de dados)
   * @returns {string}
   */
  function t(texto, subs, idioma) {
    const base = String(texto == null ? '' : texto);
    const lang = normalizeLocale(idioma) || locale();
    const tabela = lang === 'en' ? UI_EN : null;
    const escrito = (tabela && tabela[base]) || base;

    if (!subs) return escrito;

    return escrito.replace(/\{([a-z0-9_]+)\}/gi, (todo, nome) =>
      subs[nome] == null ? todo : translateValue(subs[nome], lang)
    );
  }

  /**
   * Traduções para inglês, com a **chave sendo o texto em português** (o idioma
   * de origem). Serve aos dois lados: `t()` para o que é montado em código e
   * `localizeDom()` (no pop-up) para os textos fixos do HTML — que por isso não
   * precisam de marcação nenhuma.
   *
   * Regras: texto ainda sem tradução simplesmente continua em português, e os
   * marcadores `{ nome }` têm de ser os mesmos dos dois lados (há teste).
   */
  const UI_EN = {
    /* Janelinha do pedido de ajuda (ajuda.html/ajuda.js) */
    'PegaVaga precisa de você': 'PegaVaga needs you',
    'Fechar (a vaga segue o caminho de sempre)': 'Close (the job takes the usual path)',
    'Responda os campos abaixo (com as opções originais do LinkedIn) e a extensão preenche e segue sozinha.':
      'Answer the fields below (with LinkedIn\u2019s original options) and the extension fills them in and carries on.',
    'Aplicar e continuar': 'Apply and continue',
    'Vou preencher à mão': 'I\u2019ll fill it in myself',
    'Pular esta vaga': 'Skip this job',
    'Não consegui ler o campo travado. Assuma à mão ou pule esta vaga.':
      'I couldn\u2019t read the stuck field. Take over manually or skip this job.',
    'Não consegui montar o cartão aqui. Assuma à mão ou pule esta vaga.':
      'I couldn\u2019t build the card here. Take over manually or skip this job.',
    'Escolha uma opção': 'Choose an option',
    'Sua resposta': 'Your answer',
    'Marque para confirmar': 'Check to confirm',
    'Digite a opção como aparece no LinkedIn': 'Type the option as it appears on LinkedIn',
    'Obrigatório': 'Required',
    'Campo obrigatório.': 'Required field.',
    'Preencha os campos obrigatórios antes de continuar.':
      'Fill in the required fields before continuing.',
    'Este campo é de sugestão (como localização): preencha na página e escolha a sugestão do LinkedIn, ou pule a vaga.':
      'This is a suggestion field (such as location): fill it in on the page and pick the LinkedIn suggestion, or skip the job.',

    /* Pop-up: cabeçalho, abas e cards do Início */
    'Rastreamento de vagas do LinkedIn': 'LinkedIn job tracking',
    'Início': 'Home',
    'Configurações': 'Settings',
    'vagas': 'jobs',
    'Nenhuma varredura realizada': 'No scan yet',
    'Ainda não capturei nenhuma vaga. Clique em': "I haven't captured any job yet. Click",
    'Iniciar': 'Start',
    'para começar a varredura.': 'to start the scan.',
    'Candidaturas nas últimas 24 h': 'Applications in the last 24 h',
    'Vagas por termo': 'Jobs per term',
    'Números:': 'Numbers:',
    'vagas capturadas': 'jobs captured',
    'Ainda não capturei vagas por termo. Rode uma varredura para ver aqui quanto cada termo rendeu.': 'No jobs per term yet. Run a scan to see how much each term brought in.',
    '· candidatadas. Clique num termo para ver as últimas 24 h dele (barra clara = vagas, escura = candidaturas; em cinza, o que foi de ontem).': '· applied. Click a term to see its last 24 h (light bar = jobs, dark = applications; grey = yesterday).',
    ': o PegaVaga abre a busca do LinkedIn com os seus termos, varre cada um e candidata-se respeitando as cotas de hora/24 h/dia, o agendador e o ritmo humano. No CSV sai também o motivo de cada vaga que não deu para candidatar.': ': PegaVaga opens the LinkedIn search with your terms, scans each one and applies within the hourly/24 h/daily quotas, the scheduler and the human pace. The CSV also carries the reason for every job it could not apply to.',
    'e age na sua própria sessão do LinkedIn: automatizar candidaturas é uma área cinzenta dos termos de uso, e a conta pode ser limitada. Comece com cotas baixas (ex.: 5/h, 20/dia) e acompanhe as primeiras execuções. Sem vínculo com o LinkedIn.': 'and works on your own LinkedIn session: automating applications is a grey area of the terms of use, and the account may be limited. Start with low quotas (e.g. 5/h, 20/day) and watch the first runs. Not affiliated with LinkedIn.',
    'Seções': 'Sections',
    'Vagas por situação': 'Jobs by status',
    'Relatório': 'Report',
    'Exportar (CSV)': 'Export (CSV)',
    'Não candidatadas': 'Not applied',
    'Limpar vagas capturadas': 'Clear captured jobs',
    'Como funciona': 'How it works',
    'Clique em': 'Click',
    'Use por sua conta e risco.': 'Use at your own risk.',
    'Está em': 'It is in',
    'beta': 'beta',

    /* Pop-up: Configurações — busca e candidaturas */
    'URL de busca ou perfil': 'Search URL or profile',
    'Localização': 'Location',
    'Obrigatório: URL de busca no LinkedIn, localização e pelo menos 1 termo.': 'Required: a LinkedIn search URL, a location and at least 1 term.',
    'Estes dois ficam fixos: o PegaVaga só trabalha com Candidatura Simplificada.': 'These two are fixed: PegaVaga only works with Easy Apply.',
    'Preencha os campos obrigatórios: {campos}.': 'Fill in the required fields: {campos}.',
    'URL de busca no LinkedIn': 'LinkedIn search URL',
    'Termos de vaga': 'Job terms',
    'Informe pelo menos 1 termo — é obrigatório para iniciar.': 'Enter at least 1 term — it is required to start.',

    /* Relatos de erro */
    '{n} erro(s) · {quando}': '{n} error(s) · {quando}',
    'rajada de erros': 'burst of errors',
    'página sem a lista de vagas': 'page without the job list',
    'erro na automação': 'automation error',
    'Relatos de erro': 'Error reports',
    'Pendente': 'Pending',
    'Enviado': 'Sent',
    'Enviado em {quando}': 'Sent on {quando}',
    'sem destinatário': 'no destination',
    'Relato salvo em JSON.': 'Report saved as JSON.',
    'Relato descartado.': 'Report discarded.',
    'Mantido local': 'Kept locally',
    'Enviar agora': 'Send now',
    'Baixar JSON': 'Download JSON',
    'Descartar': 'Discard',
    'Nenhum relato registrado.': 'No reports recorded.',
    'Nada pendente por aqui.': 'Nothing pending here.',
    '{n} relato(s) pendente(s)': '{n} pending report(s)',
    'Enviar diagnóstico': 'Send diagnostics',
    'Manter local': 'Keep locally',
    'Ver relato': 'View report',
    'PegaVaga teve um problema na varredura': 'PegaVaga hit a problem while scanning',
    'Relato de erro enviado. Obrigado!': 'Error report sent. Thank you!',
    'Não consegui enviar agora: {motivo}': 'Could not send it now: {motivo}',
    'Sem destinatário configurado — o relato ficou pendente.': 'No destination configured — the report is pending.',
    'Relato mantido no computador.': 'Report kept on this computer.',
    'O envio vai sair do navegador: confira o texto antes.': 'Sending leaves the browser: check the text first.',
    'O relato está pronto: {resumo}.': 'The report is ready: {resumo}.',
    'O relato está pronto em Configurações → Diagnóstico.': 'The report is ready in Settings → Diagnostics.',
    'Termos de vaga (vários, separados por vírgula ou um por linha)': 'Job terms (several, separated by commas or one per line)',
    'Ex.: Brasil, São Paulo, Remoto': 'E.g. Brazil, São Paulo, Remote',
    'desenvolvedor frontend, react, node.js': 'frontend developer, react, node.js',
    'Candidaturas': 'Applications',
    'Pesquisar somente vagas com Candidatura Simplificada': 'Search only jobs with Easy Apply',
    'Candidatar-se sozinho pela Candidatura Simplificada': 'Apply by yourself with Easy Apply',
    'Modo simulação': 'Simulation mode',
    ': preencher o formulário, mas': ': fill the form but',
    'não enviar': 'do not send',
    'a candidatura (recomendado no primeiro uso)': 'the application (recommended for a first run)',
    'Pedir a minha ajuda (notificação na área de trabalho) quando uma vaga travar num campo que só eu posso preencher, em vez de descartá-la': 'Ask for my help (desktop notification) when a job gets stuck on a field only I can fill, instead of dropping it',
    'Avisar na área de trabalho quando a varredura terminar (útil quando você deixa rodando em segundo plano)': 'Notify on the desktop when the scan finishes (handy when you leave it running in the background)',
    'Por termo': 'Per term',
    'Por hora': 'Per hour',
    'Por 24 h': 'Per 24 h',
    'Por dia (0 = sem limite)': 'Per day (0 = no limit)',
    'Máx. vagas por termo': 'Max jobs per term',
    'Cotas dinâmicas: ao estourar uma delas o PegaVaga pausa e volta sozinho quando a próxima vaga liberar.': 'Dynamic quotas: when one runs out PegaVaga pauses and comes back on its own as soon as the next job is allowed.',
    'Formulário (perguntas e popups do LinkedIn)': 'Form (LinkedIn questions and popups)',
    'Responder sozinho perguntas obrigatórias (Sim/Não, listas e números)': 'Answer required questions by yourself (Yes/No, lists and numbers)',
    'Em Sim/Não, responder': 'For Yes/No, answer',
    'Sim': 'Yes',
    'Não': 'No',
    'Número (anos, quantidade)': 'Number (years, quantity)',
    'Texto livre (ex.: cidade)': 'Free text (e.g. city)',
    'Vazio = não inventa resposta': 'Empty = no invented answer',
    'O que o LinkedIn não respondeu vira estas respostas; deixar o texto livre vazio evita respostas inventadas. Popups de avaliação ou pesquisa que aparecem depois de candidatar são fechados sozinhos.': 'Whatever LinkedIn did not answer becomes these answers; leaving the free text empty avoids invented answers. Rating or survey popups that appear after applying are closed on their own.',

    /* Pop-up: Configurações — furtividade, agendador, backup e diagnóstico */
    'Furtividade e segurança': 'Stealth and safety',
    'Ceder a vez para mim: enquanto eu mexo na página, a automação espera em vez de clicar ou rolar por cima': 'Yield to me: while I use the page, the automation waits instead of clicking or scrolling over me',
    'Fazer pausas longas de tempos em tempos (ritmo de gente)': 'Take long breaks now and then (human pace)',
    'Intervalo mínimo (s)': 'Minimum interval (s)',
    'Intervalo máximo (s)': 'Maximum interval (s)',
    'Vagas entre pausas': 'Jobs between breaks',
    'Duração da pausa (s)': 'Break length (s)',
    'Os intervalos variam sozinhos (±30%), há pausas de "leitura" da vaga e, se o LinkedIn pedir verificação ou avisar de limite de uso, o PegaVaga para tudo por 1 h para proteger a sua conta.': 'Intervals vary on their own (±30%), there are "reading" pauses on each job and, if LinkedIn asks for verification or warns about usage limits, PegaVaga stops everything for 1 h to protect your account.',
    'Agendador': 'Scheduler',
    'Iniciar e parar sozinho nos horários abaixo': 'Start and stop on its own at the times below',
    'Começa às': 'Starts at',
    'Para às': 'Stops at',
    'Dias da semana': 'Days of the week',
    'Começar sozinho quando o horário abrir': 'Start on its own when the window opens',
    'Trazer a aba para frente (o Chrome pausa os timers de abas em segundo plano)': 'Bring the tab to the front (Chrome pauses timers in background tabs)',
    'Agendador desativado.': 'Scheduler off.',
    'Backup da configuração': 'Configuration backup',
    'Salve a configuração num JSON para não perdê-la ao limpar os dados ou reinstalar. O arquivo leva as buscas, as cotas, o agendador, o ritmo e as respostas do formulário (as vagas capturadas saem pela exportação em CSV).': 'Save the configuration as JSON so you do not lose it when clearing data or reinstalling. The file carries the searches, quotas, scheduler, pace and the form answers (captured jobs come out through the CSV export).',
    'Salvar (JSON)': 'Save (JSON)',
    'Restaurar de arquivo': 'Restore from file',
    'Restaurar agora': 'Restore now',
    'Cancelar': 'Cancel',
    'Diagnóstico': 'Diagnostics',
    'Deu problema? Este botão copia a versão, a configuração, a fila e os últimos erros registrados — cole no relato do problema. Confira o texto antes de publicar: ele inclui a sua configuração e as respostas do formulário.': 'Something broke? This button copies the version, the configuration, the queue and the last recorded errors — paste it into the bug report. Check the text before posting it: it includes your configuration and the form answers.',
    'Copiar diagnóstico': 'Copy diagnostics',
    'Salvo automaticamente.': 'Saved automatically.',

    /* Pop-up: barra de ações e lâmpada do tema */
    'Parar': 'Stop',
    'Pular': 'Skip',
    'Iniciar Busca e Varredura': 'Start search and scan',
    'Parar Varredura': 'Stop scan',
    'Pular vaga atual': 'Skip current job',
    'Mudar para o tema escuro': 'Switch to dark theme',
    /* Luz de status, fila e pausas */
    'Capturando': 'Capturing',
    'Pronta': 'Ready',
    'Precisa de atenção': 'Needs attention',
    'Pronta: nenhuma varredura em andamento.': 'Ready: no scan running.',
    'Capturando a página de vagas aberta.': 'Capturing the job page you have open.',
    'Capturando vagas — {posicao}: {termo}.': 'Capturing jobs — {posicao}: {termo}.',
    'termo {n} de {total}': 'term {n} of {total}',
    'página atual': 'current page',
    'Pausada por {motivo} até {hora}.': 'Paused by {motivo} until {hora}.',
    'Descansando até {hora}.': 'Resting until {hora}.',
    'LinkedIn sinalizou limite de uso ({motivo}). Descanso até {hora}.': 'LinkedIn flagged a usage limit ({motivo}). Resting until {hora}.',
    'LinkedIn sinalizou limite de uso. Descanso até {hora}.': 'LinkedIn flagged a usage limit. Resting until {hora}.',
    'PegaVaga precisa de ajuda para continuar (campo: {campo}).': 'PegaVaga needs your help to continue (field: {campo}).',
    'PegaVaga precisa de ajuda para continuar.': 'PegaVaga needs your help to continue.',
    'cota de candidaturas': 'application quota',
    'proteção da conta (limite do LinkedIn)': 'account protection (LinkedIn limit)',
    'você estava usando o navegador': 'you were using the browser',
    'janela do agendador': 'scheduler window',

    /* Notificação de fim de varredura */
    'PegaVaga terminou a varredura': 'PegaVaga finished the scan',
    'PegaVaga parou para proteger a sua conta': 'PegaVaga stopped to protect your account',
    '{n} vaga capturada': '{n} job captured',
    '{n} vagas capturadas': '{n} jobs captured',
    '{n} candidatura enviada': '{n} application sent',
    '{n} candidaturas enviadas': '{n} applications sent',
    '{n} formulário(s) preenchido(s) sem enviar (modo simulação)': '{n} form(s) filled in without sending (simulation mode)',
    '{n} antiga(s) descartada(s) por espaço': '{n} old job(s) dropped for space',
    'O LinkedIn pediu verificação ou avisou de limite de uso ({motivo}). A varredura parou sozinha e volta a funcionar depois do descanso.': 'LinkedIn asked for verification or warned about usage limits ({motivo}). The scan stopped on its own and works again after the rest.',
    'O LinkedIn pediu verificação ou avisou de limite de uso. A varredura parou sozinha e volta a funcionar depois do descanso.': 'LinkedIn asked for verification or warned about usage limits. The scan stopped on its own and works again after the rest.',

    /* Relatório: situações, resumo e legenda do donut */
    'Enviada': 'Applied',
    'Simulada (não enviada)': 'Simulated (not sent)',
    'Externa (site da empresa)': 'External (company site)',
    'Botão de candidatura não reconhecido': 'Apply button not recognised',
    'Sem botão de candidatura': 'No apply button',
    'Já candidatada antes': 'Already applied before',
    'Formulário não abriu': 'Form did not open',
    'Travada em campo obrigatório': 'Stuck on a required field',
    'Formulário incompleto': 'Incomplete form',
    'Interrompida (Parar)': 'Interrupted (Stop)',
    'Parada por proteção do LinkedIn': 'Stopped by LinkedIn protection',
    'Erro na automação': 'Automation error',
    'Não tentada': 'Not attempted',
    'Adiada (sem cota ou fora do horário)': 'Postponed (no quota or outside the window)',
    'Nenhuma vaga capturada ainda.': 'No jobs captured yet.',
    '{n} candidatada(s) nessa sessão': '{n} applied in this session',
    '{n} candidatada(s) antes': '{n} applied before',
    '{n} não candidatada(s)': '{n} not applied',
    '{n} na fila': '{n} queued',
    'nesta sessão': 'this session',
    'antes': 'before',
    'não candidatada(s)': 'not applied',
    'na fila': 'queued',
    'Vagas candidatadas nesta sessão': 'Jobs applied in this session',
    'Vagas já candidatadas antes': 'Jobs already applied before',
    'Vagas não candidatadas': 'Jobs not applied',
    'Vagas na fila': 'Jobs queued',
    'Salvo automaticamente às {hora}.': 'Saved automatically at {hora}.',

    /* Lâmpada do tema, seletor de idioma e mensagens de detecção */
    'Mudar para o tema claro': 'Switch to light theme',
    'Idioma': 'Language',
    'Idioma da interface': 'Interface language',
    'Automático (do navegador)': 'Automatic (from the browser)',
    'Português': 'Portuguese',
    'Muda os textos do pop-up, do ícone e das notificações. O CSV e o diagnóstico continuam em português.': "Changes the texts in the popup, the icon and the notifications. The CSV and the diagnostics stay in Portuguese.",
    'Redirecionado para verificação': 'Redirected to verification',
    'Aviso de limite de uso na página do LinkedIn': 'LinkedIn usage limit warning on the page',

    /* Textos montados em código (avisos, títulos e rodapés dinâmicos) */
    'Configure uma URL do LinkedIn (ex.: https://www.linkedin.com/jobs/search/).': 'Set a LinkedIn URL (e.g. https://www.linkedin.com/jobs/search/).',
    ': a varredura fica aguardando o horário.': ': the scan waits for the window.',
    'Não foi possível iniciar a varredura nesta página.': 'Could not start the scan on this page.',
    'Não consegui falar com a página. Recarregue o LinkedIn (F5) e tente de novo.': 'Could not reach the page. Reload LinkedIn (F5) and try again.',
    'Varredura interrompida.': 'Scan stopped.',
    'Pulando a vaga atual: cancelando e indo para a próxima.': 'Skipping the current job: cancelling and moving on.',
    'Nenhuma vaga esperando ajuda agora.': 'No job waiting for help right now.',
    'Não consegui pular a vaga agora. Tente de novo.': 'Could not skip the job now. Try again.',
    'Diagnóstico copiado. Cole no relato do problema (confira antes).': 'Diagnostics copied. Paste it into the bug report (check it first).',
    'Não consegui copiar o diagnóstico — veja o console do pop-up.': 'Could not copy the diagnostics — check the popup console.',
    'Configuração salva em': 'Configuration saved to',
    'Não consegui usar esse arquivo:': 'Could not use that file:',
    'Substituir a configuração atual pela de': 'Replace the current configuration with the one from',
    '? A atual será perdida.': '? The current one will be lost.',
    'Restauração cancelada.': 'Restore cancelled.',
    'Dados limpos.': 'Data cleared.',
    'Salvando…': 'Saving…',
    'A busca roda em loop, um termo por vez, nesta ordem ({n} {unidade}). Passe o mouse sobre cada um para ver a busca.': 'The search loops, one term at a time, in this order ({n} {unidade}). Hover each one to see the search.',
    'termo': 'term',
    'termos': 'terms',
    'Última varredura: {quando}': 'Last scan: {quando}',
    ': a automação está descansando até': ': the automation is resting until',
    'O LinkedIn sinalizou limite de uso: a automação fica parada até {hora}.': 'LinkedIn flagged a usage limit: the automation stays stopped until {hora}.',
    'Nesta sessão (termo)': 'In this session (term)',
    'Pausado por': 'Paused by',
    '· {n} candidatura(s) neste termo': '· {n} application(s) in this term',
    '· pausado por {motivo} até {hora}': '· paused by {motivo} until {hora}',
    '· descansando até {hora}': '· resting until {hora}',
    '✋ PegaVaga precisa de ajuda: não consegui preencher': '✋ PegaVaga needs your help: I could not fill',
    'Nenhuma vaga capturada ainda. Rode a varredura primeiro.': 'No jobs captured yet. Run the scan first.',
    'Todas as vagas capturadas foram candidatadas. Nada a relatar.': 'All captured jobs were applied to. Nothing to report.',
    'Falha ao gerar o arquivo: {motivo}': 'Failed to generate the file: {motivo}',

    /* Cotas, agendador e janelas de horário */
    'Candidaturas — {hora} na hora · {dia24} em 24 h': 'Applications — {hora} per hour · {dia24} in 24 h',
    ' · {dia} hoje': ' · {dia} today',
    ' · {termo} neste termo': ' · {termo} in this term',
    'todos os dias': 'every day',
    'nenhum dia': 'no day',
    'Dom': 'Sun',
    'Seg': 'Mon',
    'Ter': 'Tue',
    'Qua': 'Wed',
    'Qui': 'Thu',
    'Sex': 'Fri',
    'Sáb': 'Sat',
    'Janela: {janela} · próxima: {quando}.': 'Window: {janela} · next: {quando}.',
    /* Os padrões mais específicos vêm **antes**: `{ x }` casa com qualquer
       trecho, então `Janela: {janela}.` pegaria a frase longa pela metade. */
    'Janela ativa: {janela}.': 'Window open: {janela}.',
    'Janela: {janela}.': 'Window: {janela}.',
    'por termo': 'per term',
    'por hora': 'per hour',
    'em 24 h': 'in 24 h',
    'no dia': 'per day',
    'Pausado por {motivo} até {hora}. {agenda}': 'Paused by {motivo} until {hora}. {agenda}',
    'Última hora': 'Last hour',
    'Últimas 24 h': 'Last 24 h',
    'Hoje': 'Today',
    '{rotulo}: {usado} de {limite} usadas': '{rotulo}: {usado} of {limite} used',
    '{n} candidatura(s) nas últimas 24 h (pico de {max} em uma hora) · barra clara = ontem.': '{n} application(s) in the last 24 h (peak of {max} in one hour) · light bar = yesterday.',

    /* Fila de execução */
    'Termo: {termo}.': 'Term: {termo}.',
    '{n} termos em loop ({lista}).': '{n} terms in a loop ({lista}).',
    'Termo {posicao} de {total}: {rotulo}': 'Term {posicao} of {total}: {rotulo}',
    'Buscando {rotulo}': 'Searching {rotulo}',
    '· modo simulação (não envio)': '· simulation mode (no sending)',
    'sem termo': 'no term',

    /* Backup, restauração e afins */
    'Configuração salva em {arquivo}.': 'Configuration saved to {arquivo}.',
    'Não consegui usar esse arquivo: {motivo}.': 'Could not use that file: {motivo}.',
    'Configuração restaurada.': 'Configuration restored.',
    'Configuração restaurada (o arquivo era da versão {versao}).': 'Configuration restored (the file was from version {versao}).',
    'o arquivo não é um JSON válido': 'the file is not valid JSON',
    'o arquivo não tem uma configuração dentro': 'the file has no configuration inside',
    'o arquivo não parece uma configuração do PegaVaga': 'the file does not look like a PegaVaga configuration',
    'Aguardando a cota de candidaturas liberar.': 'Waiting for the application quota to free up.',
    'Vaga capturada sem a descrição completa.': 'Job captured without the full description.',
    'Candidatura automática desligada.': 'Automatic applying is off.',
    'Vagas que ainda não foram candidatadas': 'Jobs not applied to yet',

    /* Motivos do relatório (aparecem nas dicas do pop-up; no CSV saem em pt) */
    'O modo simulação estava ligado: o formulário foi todo preenchido, mas a candidatura NÃO foi enviada de propósito.': 'Simulation mode was on: the form was fully filled but the application was deliberately NOT sent.',
    'A vaga não usa a Candidatura Simplificada: o botão leva ao site da empresa, então não é possível se candidatar pelo LinkedIn.': 'This job does not use Easy Apply: the button leads to the company site, so it cannot be applied to through LinkedIn.',
    'Não reconheci o botão de candidatura desta vaga; ela não foi pulada e será aberta de novo na próxima passada.': 'I could not recognise this job\'s apply button; it was not skipped and will be opened again on the next pass.',
    'O LinkedIn mostra que você já se candidatou a esta vaga antes; a candidatura não foi enviada de novo.': 'LinkedIn shows you already applied to this job before; the application was not sent again.',
    'O formulário parou numa pergunta obrigatória que a extensão não conseguiu responder (mesmo preenchendo as anteriores).': 'The form stopped on a required question the extension could not answer (even after filling the previous ones).',
    'O formulário não foi concluído dentro do tempo e do número de etapas permitidos.': 'The form was not completed within the allowed time and number of steps.',
    'O LinkedIn pediu verificação ou limite de uso: a automação parou para proteger a sua conta.': 'LinkedIn asked for verification or warned about usage limits: the automation stopped to protect your account.',
    'A página da vaga não oferece botão de candidatura.': 'The job page offers no apply button.',
    'O botão foi clicado, mas o formulário de candidatura não abriu.': 'The button was clicked but the application form did not open.',
    'A candidatura foi abandonada porque você pediu para parar.': 'The application was abandoned because you asked to stop.',
    'Houve um erro inesperado durante a automação da candidatura.': 'An unexpected error happened while automating the application.',

    /* Avisos e faixas (frases inteiras, com os valores dentro) */
    'Navegando para a primeira busca e iniciando a varredura…': 'Opening the first search and starting the scan…',
    'Navegando para a primeira busca ({fila}) e iniciando a varredura…': 'Opening the first search ({fila}) and starting the scan…',
    'Abrindo a busca do LinkedIn em uma nova aba…': 'Opening the LinkedIn search in a new tab…',
    'Abrindo a busca do LinkedIn em uma nova aba ({fila})…': 'Opening the LinkedIn search in a new tab ({fila})…',
    'A varredura já está em andamento.': 'The scan is already running.',
    'Varredura em andamento. O PegaVaga avança pelos termos sozinho.': 'Scan running. PegaVaga moves through the terms on its own.',
    'Varredura em andamento: {fila}. O PegaVaga avança pelos termos sozinho.': 'Scan running: {fila}. PegaVaga moves through the terms on its own.',
    'Descartei {n} vaga(s) antiga(s) para o armazenamento não encher (guardo as {max} mais recentes). Exporte a planilha de vez em quando para não perder nada.': 'I dropped {n} old job(s) so storage does not fill up (I keep the {max} most recent). Export the spreadsheet now and then so you lose nothing.',
    '✋ PegaVaga precisa de ajuda: não consegui preencher {campo}. Abra a aba do LinkedIn e complete — ou clique em "Pular vaga atual".': '✋ PegaVaga needs your help: I could not fill {campo}. Open the LinkedIn tab and complete it — or click "Skip current job".',
    'um campo obrigatório': 'a required field',
    'Não encontrei a lista de vagas nesta página.': 'I could not find the job list on this page.',
    ' (versão {versao})': ' (version {versao})',
    ', salva em {quando}': ', saved on {quando}',
    'Substituir a configuração atual pela de {arquivo}{versao}{quando}? A atual será perdida.': 'Replace the current configuration with the one from {arquivo}{versao}{quando}? The current one will be lost.',
    '⛔ LinkedIn sinalizou limite de uso ({motivo}): a automação está descansando até {hora}. Aproveite para revisar as vagas já capturadas.': '⛔ LinkedIn flagged a usage limit ({motivo}): the automation is resting until {hora}. Good time to review the jobs you captured.',
    '⛔ LinkedIn sinalizou limite de uso: a automação está descansando até {hora}. Aproveite para revisar as vagas já capturadas.': '⛔ LinkedIn flagged a usage limit: the automation is resting until {hora}. Good time to review the jobs you captured.',
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
  /**
   * O que separa um termo do outro: quebra de linha, vírgula, ponto e vírgula,
   * barra vertical ou tabulação. Assim "react, node.js" e "react\nnode.js"
   * viram dois termos (um por busca) — do jeito que a fila em loop espera.
   */
  const TERM_SPLIT_RE = /\r?\n|[;|,\t]+/;

  /**
   * Lista limpa de termos: aceita texto (uma linha ou separado por vírgula) ou
   * array, tira espaços/aspas, descarta vazios e repetidos e respeita MAX_TERMS,
   * mantendo a ordem digitada (é a ordem da fila de busca).
   */
  function normalizeTerms(raw) {
    const list = Array.isArray(raw) ? raw : [raw];
    const seen = new Set();
    const out = [];

    for (const item of list) {
      const pieces = String(item == null ? '' : item).split(TERM_SPLIT_RE);

      for (const piece of pieces) {
        const term = piece
          .trim()
          .replace(/\s+/g, ' ')
          .replace(/^["']+|["']+$/g, '')
          .trim();
        if (!term) continue;

        const key = term.toLowerCase();
        if (seen.has(key)) continue;

        seen.add(key);
        out.push(term);
        if (out.length >= MAX_TERMS) return out;
      }
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
  function buildSearchUrl(baseUrl, term, location, easyApplyOnly) {
    let url;
    try {
      url = new URL(baseUrl || LINKEDIN_SEARCH_URL);
    } catch (error) {
      return baseUrl || LINKEDIN_SEARCH_URL;
    }

    if (term) url.searchParams.set('keywords', term);
    if (location) url.searchParams.set('location', location);

    // Ativa/desativa o filtro nativo de Candidatura Simplificada do LinkedIn.
    if (easyApplyOnly === true) {
      url.searchParams.set(LINKEDIN_EASY_APPLY_PARAM, 'true');
    } else {
      url.searchParams.delete(LINKEDIN_EASY_APPLY_PARAM);
    }

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
    if (list.length === 7) return t('todos os dias');
    if (!list.length) return t('nenhum dia');
    return list.map((day) => t(WEEKDAYS[day])).join(', ');
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

  /**
   * Respostas específicas do usuário (opcional): { "pergunta": "resposta" }.
   * Só o que é texto útil sobrevive — chave vazia ou valor vazio não serve.
   */
  function normalizeAnswers(raw) {
    const value = raw && typeof raw === 'object' ? raw : {};
    const out = {};

    Object.keys(value).forEach((key) => {
      const name = String(key || '').trim().slice(0, 80);
      const answer = value[key];

      if (!name || answer == null || answer === '') return;
      out[name] = String(answer).trim().slice(0, 120);
    });

    return out;
  }

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
      locale: LOCALES.indexOf(String(value.locale || '')) >= 0 ? String(value.locale) : 'auto',
      // Fixos por decisão de produto: o filtro de Candidatura Simplificada e a
      // candidatura automática não têm como ser desligados (o interruptor fica na
      // tela, mas desativado). Qualquer valor vindo da configuração é ignorado.
      easyApplyOnly: true,
      terms: normalizeTerms(value.terms),
      apply: {
        enabled: true, // fixo (ver DEFAULT_SETTINGS)
        dryRun: apply.dryRun === true, // padrão desligado: envia de verdade
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
        fillRequired: apply.fillRequired === true,
        answerYes: apply.answerYes !== false,
        answerNumber: num(apply.answerNumber, 0, 200, defApply.answerNumber),
        answerText: String(apply.answerText == null ? '' : apply.answerText)
          .trim()
          .slice(0, 120),
        answers: normalizeAnswers(apply.answers),
        helpOnStuck: apply.helpOnStuck !== false,
        notifyOnFinish: apply.notifyOnFinish !== false,
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
  /* ------------------------------------------------------------------------ */
  /* Relatos de erro (fila local, com status)                                  */
  /* ------------------------------------------------------------------------ */

  const REPORTS_MAX = 10; // relatos guardados
  const REPORT_PAYLOAD_MAX = 20000; // teto do diagnóstico congelado no relato
  const REPORT_BURST_WINDOW_MS = 5 * 60 * 1000; // janela da rajada de erros
  const REPORT_BURST_COUNT = 3; // erros na janela que já valem um relato
  const REPORT_COOLDOWN_MS = 30 * 60 * 1000; // sem repetir o mesmo problema antes disso

  const REPORT_REASONS = {
    rajada: 'rajada de erros',
    'sem-lista': 'página sem a lista de vagas',
    erro: 'erro na automação',
  };

  /** Erros do buffer que aconteceram a partir de `since` (usa o carimbo `ts`). */
  function errorsSince(errors, since) {
    return (Array.isArray(errors) ? errors : []).filter(
      (item) => Number(item && item.ts) >= Number(since || 0)
    );
  }

  /**
   * Vale um relato? Hoje: **rajada** (3+ erros na janela de 5 minutos). A outra
   * situação que gera relato — a página sem lista de vagas — vem de fora, porque
   * quem sabe disso é o content script.
   */
  function burstReason(errors, options) {
    const o = options || {};
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const janela = o.windowMs || REPORT_BURST_WINDOW_MS;
    const minimo = o.count || REPORT_BURST_COUNT;

    return errorsSince(errors, now - janela).length >= minimo ? 'rajada' : '';
  }

  /** Assinatura do problema: mesmo motivo + mesmo primeiro erro = mesmo relato. */
  function reportFingerprint(report) {
    const r = report || {};
    const primeiro = (Array.isArray(r.errors) ? r.errors[0] : null) || {};

    return [r.reason || '', primeiro.where || '', primeiro.message || ''].join('|');
  }

  /**
   * Monta o relato. O diagnóstico vem **congelado** (quem o monta é o content
   * script, no momento do erro): enviar depois não pode descrever outro momento.
   */
  function buildReport(dados) {
    const d = dados || {};
    const at = Number.isFinite(d.at) ? d.at : Date.now();

    return {
      id: 'r-' + at,
      at: at,
      when: d.when || new Date(at).toLocaleString('pt-BR'),
      reason: d.reason || 'erro',
      errors: (Array.isArray(d.errors) ? d.errors : []).slice(-10),
      payload: String(d.payload || '').slice(0, REPORT_PAYLOAD_MAX),
      status: 'pendente',
      sentAt: null,
      channel: null,
    };
  }

  /** Texto curto para a lista de relatos ("3 erro(s) · 14/10/2026, 19:58"). */
  function describeReport(report) {
    const r = report || {};

    return t('{n} erro(s) · {quando}', {
      n: Array.isArray(r.errors) ? r.errors.length : 0,
      quando: r.when || '',
    });
  }

  /** Nome do motivo, no idioma da interface. */
  function reportReasonLabel(reason) {
    return t(REPORT_REASONS[reason] || REPORT_REASONS.erro);
  }

  /**
   * Enfileira um relato: corta a lista no teto e **não repete** o mesmo problema
   * (mesma assinatura) dentro do cooldown — senão uma rajada viraria cinco
   * notificações e cinco e-mails.
   *
   * @returns {{ list: Object[], added: Object|null }} `added` nulo = já existia
   */
  function pushReport(list, report, options) {
    const o = options || {};
    const now = Number.isFinite(o.now) ? o.now : Date.now();
    const cooldown = o.cooldownMs == null ? REPORT_COOLDOWN_MS : o.cooldownMs;
    const max = o.max || REPORTS_MAX;
    const atual = (Array.isArray(list) ? list : []).filter(Boolean);
    const assinatura = reportFingerprint(report);

    const repetido = atual.some(
      (item) => reportFingerprint(item) === assinatura && now - Number(item.at) < cooldown
    );

    if (repetido) return { list: atual, added: null };

    return { list: atual.concat([report]).slice(-max), added: report };
  }

  /** Marca o relato ('pendente' | 'enviado' | 'local') e devolve a lista nova. */
  function markReport(list, id, status, options) {
    const o = options || {};
    const now = Number.isFinite(o.now) ? o.now : Date.now();

    return (Array.isArray(list) ? list : []).map((item) => {
      if (!item || item.id !== id) return item;

      return Object.assign({}, item, {
        status: status,
        sentAt: status === 'enviado' ? now : item.sentAt,
        channel: o.channel || item.channel,
      });
    });
  }

  /** Contagem para a tela ("1 pendente") e para o diagnóstico. */
  function summarizeReports(list) {
    const resumo = { total: 0, pending: 0, sent: 0, kept: 0 };

    for (const item of Array.isArray(list) ? list : []) {
      if (!item) continue;

      resumo.total += 1;
      if (item.status === 'enviado') resumo.sent += 1;
      else if (item.status === 'local') resumo.kept += 1;
      else resumo.pending += 1;
    }

    return resumo;
  }

  /** O relato pendente mais recente (é o que a notificação oferece). */
  function lastPendingReport(list) {
    const pendentes = (Array.isArray(list) ? list : []).filter(
      (item) => item && item.status === 'pendente'
    );

    return pendentes.length ? pendentes[pendentes.length - 1] : null;
  }

  /**
   * O que falta para poder iniciar uma varredura. Hoje são obrigatórios: **URL do
   * LinkedIn**, **localização** e **pelo menos 1 termo** — sem isso a extensão não
   * começa (e o pop-up mostra o motivo, apontando os campos).
   *
   * Puro e testável: devolve os campos vazios **e** a mensagem pronta, para o
   * pop-up e o service worker usarem a mesma regra.
   *
   * @param {Object} settings configuração já normalizada
   * @returns {{ fields: string[], message: string }} `fields` vazio = pode rodar
   */
  function describeMissing(settings) {
    const cfg = settings || {};
    const vazios = [];

    if (!isLinkedInUrl(cfg.baseUrl)) vazios.push('baseUrl');
    if (!String(cfg.location || '').trim()) vazios.push('location');
    if (!(Array.isArray(cfg.terms) ? cfg.terms.length : 0)) vazios.push('terms');

    const rotulos = {
      baseUrl: 'URL de busca no LinkedIn',
      location: 'Localização',
      terms: 'Termos de vaga',
    };

    return {
      fields: vazios,
      message: vazios.length
        ? t('Preencha os campos obrigatórios: {campos}.', {
            campos: vazios.map((campo) => t(rotulos[campo])).join(' · '),
          })
        : '',
    };
  }

  function buildRunQueue(settings) {
    const cfg = settings || DEFAULT_SETTINGS;
    const terms = Array.isArray(cfg.terms) ? cfg.terms : [];

    let urls;
    let runTerms;

    if (terms.length) {
      urls = terms.map((term) =>
        buildSearchUrl(cfg.baseUrl, term, cfg.location, cfg.easyApplyOnly)
      );
      runTerms = terms.slice();
    } else {
      urls = [buildSearchUrl(cfg.baseUrl, '', cfg.location, cfg.easyApplyOnly)];
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
    simulada: {
      label: 'Simulada (não enviada)',
      failure: true, // não foi candidatada: o modo simulação estava ligado
      reason:
        'O modo simulação estava ligado: o formulário foi todo preenchido, mas a candidatura NÃO foi enviada de propósito.',
    },
    externa: {
      label: 'Externa (site da empresa)',
      failure: true,
      reason:
        'A vaga não usa a Candidatura Simplificada: o botão leva ao site da empresa, então não é possível se candidatar pelo LinkedIn.',
    },
    desconhecida: {
      label: 'Botão de candidatura não reconhecido',
      failure: true,
      reason:
        'Não reconheci o botão de candidatura desta vaga; ela não foi pulada e será aberta de novo na próxima passada.',
    },
    sem_botao: {
      label: 'Sem botão de candidatura',
      failure: true,
      reason: 'A página da vaga não oferece botão de candidatura.',
    },
    ja_candidatada: {
      label: 'Já candidatada antes',
      failure: false, // não é falha: você já tinha se candidatado a esta vaga
      already: true, // categoria própria no relatório (contagem separada)
      reason:
        'O LinkedIn mostra que você já se candidatou a esta vaga antes; a candidatura não foi enviada de novo.',
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
        'O formulário parou numa pergunta obrigatória que a extensão não conseguiu responder (mesmo preenchendo as anteriores).',
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

  /* ------------------------------------------------------------------------ */
  /* Candidatura dentro ou fora do LinkedIn                                    */
  /* ------------------------------------------------------------------------ */

  /**
   * Rótulos (pt/en) de botão que manda para fora do LinkedIn: é assim que o
   * LinkedIn anuncia as vagas que terminam no site da empresa.
   */
  const EXTERNAL_APPLY_LABEL =
    /site da empresa|site da companhia|site externo|no site da|no site do|fora do linkedin|company (web ?)?site|external (site|link|apply)|apply (externally|on)( the)? company/i;

  /**
   * Rótulos (pt/en) de botão de Candidatura Simplificada (formulário do próprio
   * LinkedIn).
   */
  const EASY_APPLY_LABEL =
    /candidatura simplificada|simplificada|easy apply|(no|pelo|com o|with) linkedin|linkedin (application|bug)/i;

  /**
   * Sinais (pt/en) de que você JÁ se candidatou a esta vaga antes: nesse caso o
   * LinkedIn troca o botão de candidatura pelo aviso "Candidatou-se" /
   * "Você se candidatou" / "Candidatura enviada" (às vezes com a data).
   *
   * O core é "candidatou(-se)": cobre "Candidatou-se há 1 mês", "Você se
   * candidatou", "Já se candidatou"… O "não se candidatou" (oposto) não casa,
   * porque aqui pedimos o "candidatou" colado no "se" ou no "você se".
   */
  const ALREADY_APPLIED_RE =
    /candidatou-se|candidatou se|voce( ja)? se candidatou|ja se candidatou|candidatura (foi )?enviad|you (already )?applied|applied on|application (submitted|sent)/i;

  /** Resultado da leitura do botão de candidatura. */
  const APPLY_KINDS = {
    easy: 'simplificada', // Candidatura Simplificada: o formulário abre aqui dentro
    external: 'externa', // o botão leva para o site da empresa
    unknown: 'desconhecida', // não deu para saber (botão ainda sem rótulo/ícone)
  };

  /**
   * Domínio de um endereço (para o motivo do relatório). Entende o
   * redirecionador do LinkedIn e devolve o domínio de destino. '' se ilegível.
   */
  function hostOf(href, depth) {
    const level = Number(depth) || 0;

    try {
      const url = new URL(String(href), 'https://www.linkedin.com/');
      const host = url.hostname.toLowerCase().replace(/^www\./, '');
      const onLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');

      if (level < 3 && onLinkedIn && /\/redir\/redirect/i.test(url.pathname)) {
        const target = url.searchParams.get('url');
        if (target && isOffsiteUrl(target)) return hostOf(target, level + 1);
      }

      return host;
    } catch (error) {
      return '';
    }
  }

  /**
   * O endereço leva para fora do LinkedIn? Também entende o redirecionador do
   * LinkedIn (`/redir/redirect?url=<destino>`), que é como ele embrulha os links
   * externos.
   */
  function isOffsiteUrl(href, depth) {
    const level = Number(depth) || 0;
    if (!href || level > 3) return false;

    let url;
    try {
      url = new URL(String(href), 'https://www.linkedin.com/');
    } catch (error) {
      return false;
    }

    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const onLinkedIn = host === 'linkedin.com' || host.endsWith('.linkedin.com');

    if (!onLinkedIn) return true;

    if (/\/redir\/redirect/i.test(url.pathname)) {
      const target = url.searchParams.get('url');
      return target ? isOffsiteUrl(target, level + 1) : false;
    }

    return false;
  }

  /**
   * Que tipo de candidatura é esta, a partir dos sinais lidos na página do
   * LinkedIn: { href, label, externalIcon, easyIcon, insight }.
   *
   * A ordem é do sinal mais forte para o mais fraco: link de fora → ícone/rótulo
   * de fora → ícone/rótulo do LinkedIn → aviso de "Candidatura simplificada" na
   * vaga. Sem nenhum sinal, devolvemos `unknown` e quem chama decide — na
   * extensão a regra é: na dúvida, não clica, para nunca te levar para fora.
   */
  function classifyApply(signals) {
    const data = signals || {};
    const label = String(data.label || '').trim();
    const insight = String(data.insight || '');

    if (data.href && isOffsiteUrl(data.href)) return APPLY_KINDS.external;
    if (data.externalIcon) return APPLY_KINDS.external;
    if (label && EXTERNAL_APPLY_LABEL.test(label)) return APPLY_KINDS.external;

    if (data.easyIcon) return APPLY_KINDS.easy;
    if (label && EASY_APPLY_LABEL.test(label)) return APPLY_KINDS.easy;
    if (insight && EASY_APPLY_LABEL.test(insight)) return APPLY_KINDS.easy;

    return APPLY_KINDS.unknown;
  }

  /* ------------------------------------------------------------------------ */
  /* Popups do LinkedIn: formulário x avisos/pesquisas                         */
  /* ------------------------------------------------------------------------ */

  /**
   * Texto em minúsculas, sem acento e com espaços colapsados. É o formato usado
   * para comparar rótulos de botão e perguntas (o LinkedIn varia em caixa e
   * acentuação entre as versões pt/en).
   */
  function plainText(value) {
    return String(value == null ? '' : value)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * O texto diz que você já se candidatou a esta vaga antes? Recebe o texto do
   * topo da vaga e/ou o rótulo do botão (a comparação ignora acento e caixa).
   */
  function looksAlreadyApplied(text) {
    const value = plainText(text);
    return Boolean(value) && ALREADY_APPLIED_RE.test(value);
  }

  /**
   * O que cada dialog do LinkedIn é. Só um deles é o formulário da Candidatura
   * Simplificada — o resto (pesquisa de avaliação, "salvar vaga", "seguir
   * empresa"…) pode aparecer por cima e precisa ser fechado, não preenchido.
   */
  const DIALOG_KINDS = {
    form: 'formulario', // formulário da Candidatura Simplificada
    survey: 'pesquisa', // popup de avaliação/pesquisa que aparece depois de enviar
    notice: 'aviso', // recado/confirmação (ex.: vaga salva, seguir empresa)
    unknown: 'desconhecido',
  };

  /** Sinais de que o dialog é o formulário da Candidatura Simplificada. */
  const APPLY_FORM_RE =
    /candidatura simplificada|easy apply|enviar candidatura|submit application|revisar|review|avancar|avançar|proxima etapa|proximo|next|curr[íi]culo|resume|anexar|upload|termos/i;

  /** Sinais de popup pós-candidatura (avaliação, pesquisa ou recado). */
  const POST_APPLY_RE =
    /avalie|avaliacao|avaliação|avaliar|como foi sua experiencia|experiencia de candidatura|pesquisa|survey|feedback|nos ajude a melhorar|help us improve|rate your|give feedback|obrigado por se candidatar|thanks for applying|salvar (esta )?vaga|save (this )?job|seguir|follow|compartilhar|share|recomendar|recommend|candidatura (foi )?enviad|application (was )?sent|voce se candidatou/i;

  /**
   * Rótulos que fecham/recusam um popup (pt + en), do mais específico ao mais
   * genérico. A ordem importa: "agora nao" é melhor que "nao".
   */
  const DISMISS_PATTERNS = [
    { key: 'fechar', re: /^(fechar|close|dismiss|sair)\b/ },
    { key: 'concluir', re: /^(concluir|done|entendi|got it|certo|ok)\b/ },
    { key: 'agora_nao', re: /(agora nao|not now|mais tarde|maybe later|later|depois)/ },
    { key: 'nao_obrigado', re: /(nao,\s?obrigad|no,\s?thanks|nao,\s?grato)/ },
    { key: 'dispensar', re: /(dispensar|dispens|ignorar|skip|pular)/ },
    { key: 'cancelar', re: /^(cancelar|cancel)\b/ },
    { key: 'nao', re: /^(nao|no)$/ },
  ];

  /** Botões que nunca clicamos para fechar: descartar apaga a candidatura. */
  const NEVER_DISMISS_RE = /descartar|discard|excluir|deletar|delete|remover|apagar/;

  /**
   * Classifica um dialog a partir dos sinais lidos na página:
   * { text, hasForm, hasApplyAction, hasClose }.
   *
   * Regras (na ordem):
   *   1. rodapé com "Avançar/Enviar candidatura"   -> formulário;
   *   2. texto de pós-candidatura sem cara de form -> pesquisa;
   *   3. tem campos de formulário com cara de candidatura -> formulário;
   *   4. tem rótulo de candidatura -> formulário;
   *   5. tem texto de pós-candidatura -> pesquisa;
   *   6. tem botão de fechar -> aviso;
   *   7. nada disso -> desconhecido (quem chama decide com cautela).
   */
  function classifyDialog(signals) {
    const data = signals || {};
    const text = plainText(data.text);
    const looksForm = APPLY_FORM_RE.test(text);
    const looksPost = POST_APPLY_RE.test(text);

    if (data.hasApplyAction) return DIALOG_KINDS.form;
    if (looksPost && !looksForm) return DIALOG_KINDS.survey;
    if (data.hasForm && looksForm) return DIALOG_KINDS.form;
    if (looksForm) return DIALOG_KINDS.form;
    if (looksPost) return DIALOG_KINDS.survey;
    if (data.hasClose) return DIALOG_KINDS.notice;

    return DIALOG_KINDS.unknown;
  }

  /**
   * Devolve o tipo de ação de fechar/recusar que o rótulo representa ('' se
   * nenhum). É o que autoriza clicar num botão de popup sem risco de descartar
   * uma candidatura.
   */
  function matchDismissLabel(label) {
    const text = plainText(label);
    if (!text || NEVER_DISMISS_RE.test(text)) return '';

    for (const pattern of DISMISS_PATTERNS) {
      if (pattern.re.test(text)) return pattern.key;
    }

    return '';
  }

  /** Resposta específica configurada para a pergunta ('' se não houver). */
  function answerForQuestion(question, answers) {
    const hint = plainText(question);
    const map = answers && typeof answers === 'object' ? answers : {};

    if (!hint) return '';

    for (const key of Object.keys(map)) {
      const name = plainText(key);
      const value = map[key];

      if (name && value != null && value !== '' && hint.includes(name)) {
        return String(value);
      }
    }

    return '';
  }

  /**
   * Escolhe uma resposta entre as opções de uma pergunta (rádio/lista) que veio
   * em branco, na ordem:
   *   1. resposta específica do usuário (`answers`) que case com a pergunta;
   *   2. "Sim" (ou "Não", se `prefs.yes === false`) — é o que o LinkedIn mais
   *      pergunta ("tem autorização?", "tem experiência com…?");
   *   3. a primeira opção que não seja um aviso de "Selecione…".
   * Devolve o rótulo escolhido ('' quando não há opção utilizável).
   */
  function pickChoice(options, prefs) {
    const list = (Array.isArray(options) ? options : []).map((label) =>
      String(label == null ? '' : label).trim()
    );
    const cfg = prefs || {};

    if (!list.length) return '';

    const wanted = answerForQuestion(cfg.question, cfg.answers);

    if (wanted) {
      const needle = plainText(wanted);
      const match = list.find((label) => plainText(label).includes(needle));
      if (match) return match;
    }

    const plain = list.map(plainText);
    const wantsNo = cfg.yes === false;
    const preferred = wantsNo ? /^(nao|no)\b/ : /^(sim|yes)\b/;
    const index = plain.findIndex((label) => preferred.test(label));

    if (index >= 0) return list[index];

    return (
      list.find((label) => !/^(selecione|escolha|select|choose|--)/.test(plainText(label))) || ''
    );
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
        already: Boolean(outcome.already),
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
    const summary = { total: list.length, applied: 0, already: 0, failed: 0, pending: 0, reasons: [] };
    const byLabel = new Map();

    for (const job of list) {
      const failure = describeApplyFailure(job, options);

      if (!failure) {
        summary.applied += 1;
        continue;
      }

      if (failure.already) summary.already += 1;
      else if (failure.pending) summary.pending += 1;
      else summary.failed += 1;

      const entry = byLabel.get(failure.label) || {
        code: failure.code,
        label: failure.label,
        pending: failure.pending,
        already: Boolean(failure.already),
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

    let text = summary.applied + ' candidatada(s) nessa sessão';
    if (summary.already) text += ' · ' + summary.already + ' candidatada(s) antes';
    if (summary.failed) text += ' · ' + summary.failed + ' não candidatada(s)';
    if (summary.pending) text += ' · ' + summary.pending + ' na fila';

    const top = (summary.reasons || [])
      .filter((entry) => !entry.pending && !entry.already)
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

    let text = t('Candidaturas — {hora} na hora · {dia24} em 24 h', {
      hora: formatCount(used.hour, limits.hour),
      dia24: formatCount(used.day24, limits.day24),
    });

    if (limits.day !== Infinity) {
      text += t(' · {dia} hoje', { dia: formatCount(used.day, limits.day) });
    }

    if (limits.term !== Infinity) {
      text += t(' · {termo} neste termo', { termo: formatCount(used.term, limits.term) });
    }

    return text;
  }

  function describeSchedule(schedule, now) {
    const cfg = schedule || {};
    if (!cfg.enabled) return 'Agendador desativado.';

    const window = formatDays(cfg.days) + ', ' + cfg.startTime + ' → ' + cfg.stopTime;

    if (isWithinSchedule(now || new Date(), cfg)) return 'Janela ativa: ' + window + '.';

    const next = nextScheduleStart(now || new Date(), cfg);
    if (!next) return 'Janela: ' + window + '.';

    const stamp = next.toLocaleString(dateLocale(), {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });

    return 'Janela: ' + window + ' · próxima: ' + stamp + '.';
  }

  /* ------------------------------------------------------------------------ */
  /* Luz de status (ícone da extensão e cabeçalho do pop-up)                   */
  /* ------------------------------------------------------------------------ */

  /** Como cada motivo de pausa aparece para o usuário. */
  const PAUSE_REASON_LABELS = {
    cota: 'cota de candidaturas',
    guard: 'proteção da conta (limite do LinkedIn)',
    usuario: 'você estava usando o navegador',
    schedule: 'janela do agendador',
  };

  /**
   * As três luzinhas: verde capturando, azul pronta, vermelha atenção. Estas
   * cores valem no ícone da extensão (o ponto é desenhado com um anel branco por
   * cima do logo) e o pop-up mostra a mesma leitura no chip do cabeçalho.
   */
  const STATUS_LIGHTS = {
    capturing: { key: 'capturing', color: '#1f9d55', label: 'Capturando' },
    ready: { key: 'ready', color: '#3b9dff', label: 'Pronta' },
    attention: { key: 'attention', color: '#d93025', label: 'Precisa de atenção' },
  };

  /**
   * Traduz o estado da extensão na luzinha do ícone:
   *   capturing (verde)    - está capturando vagas agora;
   *   ready (azul)        - pronta ou esperando algo normal (cota, janela do
   *                          agendador, descanso, você no navegador): volta só;
   *   attention (vermelha) - proteção da conta ligada (o LinkedIn avisou limite)
   *                          ou varredura que parou com problema.
   * Aceita tanto o estado lido do storage quanto o `PEGAVAGA_PROGRESS` que o
   * content script envia (que traz `scanning`, `run`, `guard` e `breakUntil`).
   */
  function statusLight(input) {
    const state = input || {};
    const now = Number.isFinite(state.now) ? state.now : Date.now();
    const run = state.run && state.run.running === true ? state.run : null;
    const guard =
      state.guard && Number(state.guard.blockedUntil) > now ? state.guard : null;
    const paused = Boolean(run && run.paused);
    const reason = (run && run.pauseReason) || 'cota';
    const why = PAUSE_REASON_LABELS[reason] || 'cota de candidaturas';

    // 1) Proteção da conta: a extensão parou sozinha para o LinkedIn não
    //    bloquear você — precisa da sua atenção (e de paciência).
    if (guard || (paused && reason === 'guard')) {
      const until = guard ? guard.blockedUntil : run.resumeAt;
      const reasonText = guard && guard.reason ? ' (' + guard.reason + ')' : '';

      return light(
        'attention',
        'LinkedIn sinalizou limite de uso' +
          reasonText +
          '. Descanso até ' +
          formatClock(until) +
          '.'
      );
    }

    // 2) A varredura bateu em algo (ex.: página sem a lista de vagas).
    if (run && run.problem) return light('attention', String(run.problem));

    // 2.1) Uma vaga travou num campo que só o usuário preenche: notificamos e
    //      esperamos a ajuda dele (a vaga não é descartada).
    if (run && run.needsHelp) {
      return light(
        'attention',
        'PegaVaga precisa de ajuda para continuar' +
          (run.helpMissing ? ' (campo: ' + run.helpMissing + ')' : '') +
          '.'
      );
    }

    // 3) Pausa normal: cota, janela do agendador, descanso ou vez do usuário.
    if (paused) {
      return light(
        'ready',
        'Pausada por ' + why + ' até ' + formatClock(run.resumeAt) + '.'
      );
    }

    if (Number(state.breakUntil) > now) {
      return light('ready', 'Descansando até ' + formatClock(state.breakUntil) + '.');
    }

    // 4) Fila ativa (ou varredura em andamento): capturando agora.
    if (run || state.scanning === true) {
      if (!run) return light('capturing', 'Capturando a página de vagas aberta.');

      const total = Array.isArray(run.urls) ? run.urls.length : Number(run.total) || 1;
      const position = 'termo ' + ((Number(run.index) || 0) + 1) + (total > 1 ? ' de ' + total : '');
      const label = run.term ? '"' + run.term + '"' : 'página atual';

      return light('capturing', 'Capturando vagas — ' + position + ': ' + label + '.');
    }

    // 5) Nada rodando.
    return light('ready', 'Pronta: nenhuma varredura em andamento.');
  }

  /* ------------------------------------------------------------------------ */
  /* Espera por evento: o DOM avisa, ninguém fica perguntando de 250 em 250 ms  */
  /* ------------------------------------------------------------------------ */

  /**
   * Fila de quem está esperando um sinal da página. O `content.js` chama
   * `wake()` a cada mutação do MutationObserver; então quem espera reage no
   * mesmo instante em que o LinkedIn mexe na tela — em vez de descobrir depois,
   * numa checagem por tempo, que a internet demorou.
   *
   * Não usa DOM: é só uma lista de ouvintes, o que a torna testável de verdade.
   */
  function createSignal() {
    const listeners = new Set();

    return {
      /** Quantos estão esperando agora (0 = não há por que acordar ninguém). */
      get size() {
        return listeners.size;
      },

      /** A página mexeu: avisa todo mundo. Um erro não derruba os outros. */
      wake() {
        if (!listeners.size) return;

        Array.from(listeners).forEach((listener) => {
          try {
            listener();
          } catch (error) {
            /* segue avisando os demais */
          }
        });
      },

      /** Espera o próximo sinal. Devolve a função que cancela a inscrição. */
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  /**
   * Espera `check()` devolver algo. É acordada pelo sinal (mutação na página),
   * com `pollMs` apenas como rede de segurança — para o que muda sem gerar
   * mutação, como digitar num campo — e `timeoutMs` como prazo final.
   * Devolve o valor de `check()` ou `null`.
   */
  function waitUntil(signal, check, timeoutMs, pollMs) {
    const attempt = () => {
      try {
        return check() || null;
      } catch (error) {
        return null;
      }
    };

    const immediate = attempt();
    if (immediate) return Promise.resolve(immediate);

    const step = Number(pollMs) || 0;
    const budget = Number(timeoutMs) || 0;

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      let poll = null;
      let off = null;

      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (poll) clearInterval(poll);
        if (off) off();
        resolve(value || null);
      };

      off = signal && signal.subscribe ? signal.subscribe(() => {
        const value = attempt();
        if (value) finish(value);
      }) : null;

      if (step > 0) {
        poll = setInterval(() => {
          const value = attempt();
          if (value) finish(value);
        }, step);
      }

      if (budget > 0) timer = setTimeout(() => finish(null), budget);
    });
  }

  /**
   * Espera a página ficar quieta: nenhuma mutação dentro de `ms`. É assim que o
   * content script sabe que a etapa terminou de carregar — olhando o que a
   * página está fazendo, não quanto tempo a internet levou. Devolve `true` se
   * houve silêncio (e `false` se algo mexeu antes).
   */
  function waitForQuiet(signal, ms) {
    const silence = Math.max(16, Number(ms) || 0);

    return new Promise((resolve) => {
      let settled = false;
      let off = null;

      const finish = (quiet) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (off) off();
        resolve(quiet);
      };

      off = signal && signal.subscribe ? signal.subscribe(() => finish(false)) : null;
      const timer = setTimeout(() => finish(true), silence);
    });
  }

  /** Monta a luzinha com a cor do nível e o texto (tooltip) já pronto. */
  function light(key, detail) {
    const preset = STATUS_LIGHTS[key] || STATUS_LIGHTS.ready;

    return {
      key: preset.key,
      color: preset.color,
      label: preset.label,
      detail: detail,
      title: 'PegaVaga — ' + detail,
    };
  }

  /**
   * Aplica os tetos de armazenamento ao mapa de vagas: corta a descrição que
   * passar de `maxChars` e, havendo mais de `maxJobs` vagas, descarta as
   * capturadas há mais tempo (vaga sem `capturedAt` conta como a mais antiga).
   * Função pura: quando não há nada para cortar, devolve o próprio mapa recebido.
   * @param {Object} jobs mapa { [jobId]: vaga }
   * @param {{ maxJobs?: number, maxChars?: number }} [options] padrão: MAX_JOBS/DESC_MAX_CHARS
   * @returns {{ jobs: Object, dropped: number }} mapa (novo ou o mesmo) e quantas vagas saíram
   */
  function trimJobs(jobs, options) {
    const opts = options || {};
    const maxJobs = Number.isFinite(opts.maxJobs) ? opts.maxJobs : MAX_JOBS;
    const maxChars = Number.isFinite(opts.maxChars) ? opts.maxChars : DESC_MAX_CHARS;
    const list = jobs || {};
    const keys = Object.keys(list);

    let dropSet = null;
    let dropped = 0;

    if (keys.length > maxJobs) {
      const byAge = keys.slice().sort((a, b) => {
        const ta = Date.parse((list[a] && list[a].capturedAt) || '') || 0;
        const tb = Date.parse((list[b] && list[b].capturedAt) || '') || 0;
        return ta - tb;
      });

      dropped = keys.length - maxJobs;
      dropSet = new Set(byAge.slice(0, dropped));
    }

    const out = {};
    let changed = Boolean(dropSet);

    for (const key of keys) {
      if (dropSet && dropSet.has(key)) continue;

      const job = list[key];

      if (!job) {
        changed = true; // entrada inválida não vai para a planilha
        continue;
      }

      const text = typeof job.description === 'string' ? job.description : '';

      if (text.length > maxChars) {
        out[key] = Object.assign({}, job, { description: text.slice(0, maxChars) });
        changed = true;
      } else {
        out[key] = job;
      }
    }

    return { jobs: changed ? out : list, dropped: dropped };
  }

  /**
   * Quantas candidaturas foram feitas **hoje** (dia local, 00:00 → agora). Puro:
   * recebe o histórico de carimbos de tempo e o "agora" — o badge do ícone usa
   * isso para mostrar o total do dia. Carimbo no futuro (relógio torto, outro
   * fuso) fica de fora: candidatura feita hoje não pode ter acontecido amanhã.
   * @param {number[]} apps histórico de candidaturas (epoch ms)
   * @param {number} [now]
   * @returns {number}
   */
  function countAppsToday(apps, now) {
    const list = Array.isArray(apps) ? apps : [];
    const base = new Date(Number.isFinite(now) ? now : Date.now());
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate()).getTime();
    // Tolerância de 1 s: o carimbo e a contagem podem vir de contextos diferentes.
    const end = base.getTime() + 1000;

    return list.filter((ts) => Number.isFinite(ts) && ts >= start && ts <= end).length;
  }

  /**
   * Texto do badge do ícone: vazio quando não há nada hoje (assim o badge não
   * atrapalha a luz do status) e `99+` quando passa de 99, porque o badge do
   * Chrome não cabe mais que isso.
   * @param {number} count
   * @returns {string}
   */
  function badgeText(count) {
    const n = safeCount(count);

    if (!n) return '';
    return n > 99 ? '99+' : String(n);
  }

  /** Inteiro >= 0 no diagnóstico (nunca sai "undefined"/"NaN"). */
  function safeCount(value) {
    const parsed = Math.round(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  /** Linha do estado da fila no diagnóstico. */
  function diagRun(run) {
    if (!run || !run.running) return 'parada';

    const termo = run.term ? '"' + run.term + '"' : 'página atual';
    const estado = run.paused
      ? 'pausada (' + (PAUSE_REASON_LABELS[run.pauseReason] || run.pauseReason || 'sem motivo') + ')'
      : 'rodando';
    const total = Array.isArray(run.terms) && run.terms.length ? run.terms.length : 1;

    return (
      estado +
      ' · termo ' + termo +
      ' · ' + safeCount(run.appliedInTerm) + ' candidatura(s) no termo' +
      ' · ' + safeCount(run.appliedTotal) + ' na execução' +
      ' · ' + total + ' termo(s) na fila' +
      (run.problem ? ' · problema: ' + run.problem : '')
    );
  }

  /**
   * Texto da notificação de fim de varredura (título + corpo). Puro e testável:
   * quem mostra é o service worker, com o resumo que o `content.js` mandou.
   * `reason === 'bloqueio'` é o caso que exige atenção (o LinkedIn pediu
   * verificação); `urgent` deixa a notificação presa na tela.
   * @param {Object} data { reason, jobs, applied, dropped, dryRun, guardReason }
   * @returns {{ title: string, message: string, urgent: boolean }}
   */
  function describeRunEnd(data) {
    const d = data || {};

    if (d.reason === 'bloqueio') {
      return {
        title: t('PegaVaga parou para proteger a sua conta'),
        message: d.guardReason
          ? t(
              'O LinkedIn pediu verificação ou avisou de limite de uso ({motivo}). A varredura parou sozinha e volta a funcionar depois do descanso.',
              { motivo: d.guardReason }
            )
          : t(
              'O LinkedIn pediu verificação ou avisou de limite de uso. A varredura parou sozinha e volta a funcionar depois do descanso.'
            ),
        urgent: true,
      };
    }

    const vagas = safeCount(d.jobs);
    const candidaturas = safeCount(d.applied);
    const descartadas = safeCount(d.dropped);
    const partes = [
      t(vagas === 1 ? '{n} vaga capturada' : '{n} vagas capturadas', { n: vagas }),
    ];

    partes.push(
      d.dryRun
        ? t('{n} formulário(s) preenchido(s) sem enviar (modo simulação)', { n: candidaturas })
        : t(candidaturas === 1 ? '{n} candidatura enviada' : '{n} candidaturas enviadas', {
            n: candidaturas,
          })
    );

    if (descartadas) {
      partes.push(t('{n} antiga(s) descartada(s) por espaço', { n: descartadas }));
    }

    return {
      title: t('PegaVaga terminou a varredura'),
      message: partes.join(' · ') + '.',
      urgent: false,
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Pedido de ajuda: a janelinha e as respostas que voltam dela              */
  /* ------------------------------------------------------------------------ */

  /**
   * Id do pedido de ajuda. Ele carrega a **aba** e o **pedido**, porque é por ele
   * que a decisão volta para a aba certa (a janelinha não fala com o LinkedIn).
   */
  function ajudaId(tabId, pedidoId) {
    return 'pegavaga-ajuda:' + String(tabId == null ? '' : tabId) + ':' + String(pedidoId || '');
  }

  /** Desfaz o `ajudaId`; `null` quando o texto não é um id nosso. */
  function lerAjudaId(id) {
    const partes = String(id || '').split(':');

    if (partes.length !== 3 || partes[0] !== 'pegavaga-ajuda') return null;

    const tabId = Number(partes[1]);
    if (!Number.isFinite(tabId) || !partes[2]) return null;

    return { tabId: tabId, pedidoId: partes[2] };
  }

  /**
   * Contexto que vem na URL da janelinha (`?dados=<json>`). O `URLSearchParams`
   * **já desfaz** a codificação — decodificar de novo quebrava respostas com `%`
   * (ex.: "100%"). Devolve `{}` quando o texto não é JSON.
   */
  function parseAjudaDados(search) {
    try {
      const bruto = new URLSearchParams(search || '').get('dados') || '{}';
      const objeto = JSON.parse(bruto);
      return objeto && typeof objeto === 'object' ? objeto : {};
    } catch (error) {
      return {};
    }
  }

  /**
   * Índice do rótulo que corresponde ao que o usuário escolheu na janelinha.
   * Casa o texto **exato** antes de "contém" — senão "Sim" pegaria
   * "Sim, com restrições" — e é assim que a resposta cai na opção **original**
   * do LinkedIn, e não numa parecida.
   */
  function escolherRotulo(rotulos, alvo) {
    const desejado = plainText(alvo);
    const lista = (Array.isArray(rotulos) ? rotulos : []).map((item) => plainText(item));

    if (!desejado) return -1;

    const exato = lista.indexOf(desejado);
    if (exato >= 0) return exato;

    return lista.findIndex((item) => item && item.indexOf(desejado) >= 0);
  }

  /**
   * Dois rótulos falam da MESMA pergunta? Casa o texto normalizado exato e,
   * depois, um dentro do outro (dos dois lados): o LinkedIn muda a pontuação, o
   * "Obrigatório" colado e o acento entre a tela do formulário e o relatório.
   * Devolve `false` quando falta texto de um lado — rótulo vazio casaria com tudo.
   */
  function rotuloCombina(a, b) {
    const na = plainText(a);
    const nb = plainText(b);

    if (!na || !nb) return false;
    return na === nb || na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0;
  }

  /**
   * Monta o texto do "copiar diagnóstico" (relato de problema). Função pura:
   * recebe dados já lidos do storage e devolve o texto que vai para a área de
   * transferência — os erros vêm do buffer que o content.js mantém.
   * @param {Object} dados { version, ua, when, count, dropped, lastRun, apps, run, guard, dryRun, theme, settings, errors }
   * @returns {string}
   */
  function buildDiagnostics(dados) {
    const d = dados || {};
    const errors = (Array.isArray(d.errors) ? d.errors : []).slice(-ERROR_KEEP);
    const guard = d.guard || null;
    const linhas = [];

    linhas.push('PegaVaga — diagnóstico');
    linhas.push('Versão ' + (d.version || '?') + ' · ' + (d.ua || 'navegador não identificado'));
    linhas.push('Gerado em ' + (d.when || new Date().toLocaleString('pt-BR')));
    linhas.push('(confira antes de colar: o texto inclui a sua configuração e os últimos erros)');
    linhas.push('');
    linhas.push(
      'Vagas: ' +
        safeCount(d.count) +
        ' · descartadas por espaço: ' +
        safeCount(d.dropped) +
        ' · última varredura: ' +
        (d.lastRun || 'nenhuma')
    );
    linhas.push('Candidaturas registradas: ' + safeCount(d.apps));
    linhas.push('Fila: ' + diagRun(d.run));
    linhas.push(
      'Bloqueio: ' +
        (guard && guard.blockedUntil
          ? 'até ' +
            new Date(guard.blockedUntil).toLocaleString('pt-BR') +
            ' (' + (guard.reason || 'sem motivo') + ')'
          : 'nenhum')
    );
    linhas.push('Modo simulação: ' + (d.dryRun ? 'ligado (não envia candidaturas)' : 'desligado'));
    linhas.push('Tema: ' + (d.theme || 'claro'));
    linhas.push('');
    linhas.push('Configuração:');
    linhas.push(JSON.stringify(d.settings || {}, null, 2));
    linhas.push('');
    linhas.push('Últimos ' + errors.length + ' erro(s):');

    if (!errors.length) linhas.push('(nenhum registrado)');

    for (const item of errors) {
      linhas.push(
        '- ' + (item.at || '?') + ' · ' + (item.where || '?') + ': ' + (item.message || '')
      );
    }

    return linhas.join('\n');
  }

  /**
   * Serializa a configuração num JSON de backup. Puro (testável): o pop-up só
   * dispara o download. Leva `answers` junto — é o que dói mais perder.
   * @param {Object} settings configuração já normalizada
   * @param {Object} [options] { version, exportedAt }
   * @returns {string}
   */
  function buildSettingsBackup(settings, options) {
    const o = options || {};

    return (
      JSON.stringify(
        {
          app: 'pegavaga',
          kind: 'config',
          version: o.version || '',
          exportedAt: o.exportedAt || new Date().toISOString(),
          settings: settings || {},
        },
        null,
        2
      ) + '\n'
    );
  }

  /**
   * Lê um backup de configuração: aceita o arquivo que `buildSettingsBackup`
   * gerou e também um objeto de configuração "cru" (útil para quem edita o JSON
   * na mão). Devolve a configuração **já validada** por `parseSettings`, então
   * número fora de faixa vira o padrão e termo repetido é limpo.
   * Joga `Error` com mensagem clara quando o arquivo não serve.
   * @param {string} text conteúdo do arquivo
   * @returns {{ settings: Object, version: string, exportedAt: string }}
   */
  function parseSettingsBackup(text) {
    let data;

    try {
      data = JSON.parse(String(text == null ? '' : text));
    } catch (error) {
      throw new Error(t('o arquivo não é um JSON válido'));
    }

    const bruto =
      data && typeof data === 'object' && !Array.isArray(data) && data.settings
        ? data.settings
        : data;

    if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) {
      throw new Error(t('o arquivo não tem uma configuração dentro'));
    }

    // Um JSON qualquer (planilha, backup de outro app) não pode passar: importar
    // lixo aqui apagaria a configuração de verdade e deixaria só os padrões.
    const campos = ['baseUrl', 'location', 'easyApplyOnly', 'terms', 'apply', 'schedule'];
    const pareceConfig = campos.some((campo) =>
      Object.prototype.hasOwnProperty.call(bruto, campo)
    );

    if (!pareceConfig) {
      throw new Error(t('o arquivo não parece uma configuração do PegaVaga'));
    }

    return {
      settings: parseSettings(bruto),
      version: (data && data.version) || '',
      exportedAt: (data && data.exportedAt) || '',
    };
  }

  return {
    STORAGE,
    MSG,
    DEFAULT_SETTINGS,
    PAUSE_REASON_LABELS,
    STATUS_LIGHTS,
    statusLight,
    LINKEDIN_SEARCH_URL,
    LINKEDIN_EASY_APPLY_PARAM,
    MAX_TERMS,
    MAX_JOBS,
    DESC_MAX_CHARS,
    trimJobs,
    ERROR_KEEP,
    buildDiagnostics,
    describeRunEnd,
    countAppsToday,
    badgeText,

    /* Idioma da interface */
    LOCALES,
    DEFAULT_LOCALE,
    locale,
    dateLocale,
    setLocale,
    normalizeLocale,
    t,
    translate,
    syncText,
    UI_EN,
    buildSettingsBackup,
    parseSettingsBackup,
    HOUR_MS,
    DAY_MS,
    HISTORY_LIMIT,
    WEEKDAYS,
    LIMIT_LABELS,
    APPLY_OUTCOMES,
    APPLY_PENDING,
    APPLY_KINDS,
    DIALOG_KINDS,
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
    describeMissing,

    /* Pedido de ajuda (janelinha no desktop) */
    JANELINHA,
    ajudaId,
    lerAjudaId,
    parseAjudaDados,
    escolherRotulo,
    rotuloCombina,

    /* Relatos de erro */
    REPORTS_MAX,
    REPORT_BURST_COUNT,
    REPORT_BURST_WINDOW_MS,
    REPORT_COOLDOWN_MS,
    errorsSince,
    burstReason,
    buildReport,
    pushReport,
    markReport,
    summarizeReports,
    lastPendingReport,
    describeReport,
    reportReasonLabel,
    computeQuota,
    jitter,
    applyOutcomeLabel,
    hostOf,
    isOffsiteUrl,
    classifyApply,
    plainText,
    looksAlreadyApplied,
    classifyDialog,
    matchDismissLabel,
    answerForQuestion,
    pickChoice,
    createSignal,
    waitUntil,
    waitForQuiet,
    describeApplyFailure,
    summarizeApply,
    describeApplySummary,
    describeQuota,
    describeSchedule,
    formatClock,
  };
})();
