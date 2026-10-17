/* =============================================================================
 * PegaVaga - teste geral (estatico + unitario das funcoes puras).
 *
 * Como rodar (na raiz do projeto):
 *     node tests/pegavaga.test.js
 *
 * Cobre: manifest/permissions, exports do shared.js, mensageria entre os
 * contextos, IDs do popup, codigos de status, configuracao, cotas, horarios,
 * relatorio, luz de status, teto de armazenamento, deteccoes (Candidatou-se,
 * externa, ...) e a espera por evento. Sai com codigo 0 quando tudo passa e 1
 * quando ha falha.
 * ===========================================================================*/
const fs = require('fs');
const ROOT = require('path').resolve(__dirname, '..') + '/';

let pass = 0;
const failures = [];
function ok(name, cond, extra) {
  if (cond) pass += 1;
  else failures.push(name + (extra ? '  ->  ' + extra : ''));
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), 'got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want));
}
const read = (f) => fs.readFileSync(ROOT + f, 'utf8');
const section = (t) => console.log('\n=== ' + t + ' ===');

section('0. Arquivos e manifest');
['manifest.json', 'shared.js', 'background.js', 'content.js', 'popup.html', 'popup.js'].forEach((f) =>
  ok('existe ' + f, fs.existsSync(ROOT + f))
);
const manifest = JSON.parse(read('manifest.json'));
eq('manifest_version', manifest.manifest_version, 3);
ok('service_worker', manifest.background.service_worker === 'background.js');
eq('content_scripts js', manifest.content_scripts[0].js, ['shared.js', 'content.js']);
eq('content_scripts matches', manifest.content_scripts[0].matches, ['https://www.linkedin.com/*']);
['storage', 'clipboardWrite', 'alarms', 'notifications', 'activeTab', 'unlimitedStorage'].forEach((p) => ok('permissao ' + p, manifest.permissions.includes(p)));
ok('host_permissions linkedin', manifest.host_permissions.includes('https://www.linkedin.com/*'));
ok('versao semver', /^\d+\.\d+\.\d+$/.test(manifest.version), manifest.version);

// Ícone renomeado/esquecido é erro silencioso: a extensão fica sem ícone e o zip
// sai incompleto. Aqui todo caminho citado tem de existir no disco.
const iconesCitados = [
  ...new Set(
    [...read('manifest.json').matchAll(/icons\/[\w.-]+\.png/g), ...read('background.js').matchAll(/icons\/[\w.-]+\.png/g)]
      .map((achado) => achado[0])
  ),
];
ok('ha icones citados', iconesCitados.length >= 4);
eq('todo icone citado existe', iconesCitados.filter((caminho) => !fs.existsSync(ROOT + caminho)), []);

section('1. Exports do shared.js');
require(ROOT + 'shared.js');
const S = globalThis.PegaVagaShared;
ok('PegaVagaShared existe', Boolean(S));
// Idioma fixo no pt: o teste não pode depender do idioma do sistema/navegador
// onde roda (no Node 20 nem existe `navigator`, no 26 o idioma vem do sistema).
S.setLocale('pt');
const consumers = ['content.js', 'popup.js', 'background.js'].map(read).join('\n');
const usedShared = [...new Set([...consumers.matchAll(/SHARED\.([A-Za-z0-9_]+)/g)].map((m) => m[1]))];
eq('todos os SHARED.* usados existem', usedShared.filter((n) => !(n in S)), []);
console.log('   ' + usedShared.length + ' simbolos SHARED.* verificados: ' + usedShared.join(', '));
const usedMsg = [...new Set([...consumers.matchAll(/MSG\.([A-Z_]+)/g)].map((m) => m[1]))];
eq('todos os MSG.* usados existem', usedMsg.filter((k) => !(k in S.MSG)), []);
const usedStorage = [...new Set([...consumers.matchAll(/STORAGE\.([a-z0-9_]+)/g)].map((m) => m[1]))];
eq('todos os STORAGE.* usados existem', usedStorage.filter((k) => !(k in S.STORAGE)), []);

section('2. IDs do popup (HTML x JS)');
const popupJs = read('popup.js');
const popupHtml = read('popup.html');
const ids = [...new Set([...popupJs.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]))];
eq('todos os IDs do popup.js existem no HTML', ids.filter((id) => !popupHtml.includes('id="' + id + '"')), []);
console.log('   ' + ids.length + ' IDs verificados');
ok('popup carrega shared.js antes de popup.js', popupHtml.indexOf('shared.js') < popupHtml.indexOf('popup.js'));

section('3. Codigos de status');
const codes = [...new Set([...read('content.js').matchAll(/status:\s*'([a-z_]+)'/g)].map((m) => m[1]))];
const known = new Set(Object.keys(S.APPLY_OUTCOMES).concat([S.APPLY_PENDING]));
eq('status do content.js sao conhecidos', codes.filter((c) => !known.has(c)), []);
console.log('   ' + codes.join(', '));
ok('todo APPLY_OUTCOMES tem label; reason so falta em "enviada"', Object.keys(S.APPLY_OUTCOMES).every((k) => S.APPLY_OUTCOMES[k].label && (k === 'enviada' || S.APPLY_OUTCOMES[k].reason)), Object.keys(S.APPLY_OUTCOMES).filter((k) => !S.APPLY_OUTCOMES[k].reason).join(','));
console.log('   desfechos: ' + Object.keys(S.APPLY_OUTCOMES).join(', '));

section('4. Higiene');
['shared.js', 'background.js', 'content.js', 'popup.js'].forEach((f) => {
  const src = read(f);
  ok(f + ': sem debugger', !/\bdebugger\b/.test(src));
  ok(f + ': sem TODO/FIXME', !/TODO|FIXME/.test(src));
});
ok('content.js tem 1 onMessage', (read('content.js').match(/chrome\.runtime\.onMessage\.addListener/g) || []).length === 1);
ok('popup.js tem 1 onMessage', (read('popup.js').match(/chrome\.runtime\.onMessage\.addListener/g) || []).length === 1);
ok('CLEAR zera o contador de descartes', /MSG\.CLEAR:[\s\S]{0,300}state\.dropped = 0;/.test(read('content.js')));
ok('popup le e mostra o contador de descartes', read('popup.js').includes('meta.dropped') && read('popup.html').includes('id="trim-hint"'));
ok('aviso de risco/beta no pop-up', popupHtml.includes('conta e risco') && popupHtml.includes('class="notice"'));
ok('CI roda os testes', fs.existsSync(ROOT + '.github/workflows/testes.yml') && read('.github/workflows/testes.yml').includes('node tests/pegavaga.test.js'));
const packSh = read('tools/empacotar.sh');
ok('script de empacotamento existe', fs.existsSync(ROOT + 'tools/empacotar.sh'));
ok('zip empacota os arquivos da extensao', ['manifest.json', 'shared.js', 'background.js', 'content.js', 'popup.html', 'popup.js', 'icons'].every((f) => packSh.includes(f)));
const packBlock = packSh.slice(packSh.indexOf('FILES=('), packSh.indexOf(')', packSh.indexOf('FILES=(')));
ok('pacote nao inclui tests/.github/.md', !/tests|\.github|\.md/.test(packBlock), packBlock);
ok('git archive sem --prefix (manifest na raiz)', !/git archive[^\n]*--prefix/.test(packSh));
ok('empacotar sem unzip em cano com grep -q', !/unzip -Z1[^\n]*\|[^\n]*grep/.test(packSh));
const smoke = read('tests/SMOKE_TEST.md');
ok('smoke test cita a interface nova', ['Início', 'Configurações', 'lâmpada', 'donut', 'toast'].every((t) => smoke.includes(t)));
ok('smoke test cita os avisos do app', smoke.includes('conta e risco') && smoke.includes('Descartei'));

// Privacidade: estas checagens sustentam o que a PRIVACY.md afirma.
const allSrc = ['shared.js', 'background.js', 'content.js', 'popup.js'].map(read).join('\n');
ok('sem storage.sync (nada vai para a conta Google)', !/storage\.sync/.test(allSrc));
ok('sem XMLHttpRequest/WebSocket/sendBeacon', !/XMLHttpRequest|WebSocket|sendBeacon/.test(allSrc));
ok('fetch so de arquivo da propria extensao ou do entregador de relatos', (allSrc.match(/fetch\([^)]*\)/g) || []).every((chamada) => chamada.includes('chrome.runtime.getURL') || chamada.includes('REPORT_ENDPOINT')));
ok('popup sem script/estilo remoto', !/<script[^>]+src="https?:/.test(popupHtml) && !/@import\s+url\(https?:/.test(popupHtml));
ok('PRIVACY.md existe e cita o storage local', fs.existsSync(ROOT + 'PRIVACY.md') && read('PRIVACY.md').includes('chrome.storage.local'));
ok('PRIVACY.md afirma que nada sai do navegador', /nada sai do seu navegador/i.test(read('PRIVACY.md')));
const loja = read('LOJA.md');
ok('LOJA.md traz o formulario de dados e todas as permissoes', loja.includes('Data usage') && ['storage', 'unlimitedStorage', 'activeTab', 'alarms', 'notifications'].every((p) => loja.includes('`' + p + '`')));

section('5. Numeros e termos');
eq('num normal', S.num('5', 1, 10, 3), 5);
eq('num vazio -> fallback', S.num('', 1, 10, 3), 3);
eq('num invalido -> fallback', S.num('abc', 1, 10, 3), 3);
eq('num acima do max', S.num(20, 1, 10, 3), 10);
eq('num abaixo do min', S.num(-5, 1, 10, 3), 1);
eq('num arredonda', S.num(3.6, 1, 10, 3), 4);
eq('normalizeTerms virgula+linha', S.normalizeTerms('react, node.js\nVUE'), ['react', 'node.js', 'VUE']);
eq('normalizeTerms dedupe (case)', S.normalizeTerms('react, React, REACT'), ['react']);
eq('normalizeTerms aspas', S.normalizeTerms('"react"'), ['react']);
eq('normalizeTerms array', S.normalizeTerms(['a', 'b']), ['a', 'b']);
eq('normalizeTerms vazio', S.normalizeTerms(''), []);
eq('normalizeTerms limite 40', S.normalizeTerms(Array.from({ length: 45 }, (_, i) => 't' + i)).length, 40);

section('6. URLs');
ok('isLinkedInUrl ok', S.isLinkedInUrl('https://www.linkedin.com/jobs/search/'));
ok('isLinkedInUrl nao', !S.isLinkedInUrl('https://example.com/'));
ok('isLinkedInJobsUrl ok', S.isLinkedInJobsUrl('https://www.linkedin.com/jobs/search/'));
ok('isLinkedInJobsUrl feed nao', !S.isLinkedInJobsUrl('https://www.linkedin.com/feed/'));
eq('buildSearchUrl simples', S.buildSearchUrl('https://www.linkedin.com/jobs/search/', 'react', 'Brasil', false), 'https://www.linkedin.com/jobs/search/?keywords=react&location=Brasil');
eq('buildSearchUrl com filtro', S.buildSearchUrl('https://www.linkedin.com/jobs/search/', 'react', '', true), 'https://www.linkedin.com/jobs/search/?keywords=react&f_AL=true');
eq('buildSearchUrl remove f_AL', S.buildSearchUrl('https://www.linkedin.com/jobs/search/?f_AL=true&keywords=x', 'react', '', false), 'https://www.linkedin.com/jobs/search/?keywords=react');
eq('buildSearchUrl base invalida', S.buildSearchUrl('%%%', 'x', '', false), '%%%');

section('7. Horario e dias');
eq('normalizeTime 8:5', S.normalizeTime('8:5', '08:00'), '08:05');
eq('normalizeTime invalido', S.normalizeTime('25:00', '08:00'), '08:00');
eq('timeToMinutes', S.timeToMinutes('08:30'), 510);
eq('timeToMinutes 24:00 null', S.timeToMinutes('24:00'), null);
eq('minutesToTime', S.minutesToTime(510), '08:30');
eq('minutesToTime negativo', S.minutesToTime(-5), '00:00');
eq('normalizeDays limpa/ordena', S.normalizeDays([1, 1, 7, -2, '3']), [1, 3]);
eq('normalizeDays null -> padrao', S.normalizeDays(null), [1, 2, 3, 4, 5]);
eq('formatDays uteis', S.formatDays([1, 2, 3, 4, 5]), 'Seg, Ter, Qua, Qui, Sex');
eq('formatDays todos', S.formatDays([0, 1, 2, 3, 4, 5, 6]), 'todos os dias');
eq('formatDays nenhum', S.formatDays([]), 'nenhum dia');
const seg1200 = new Date(2026, 0, 5, 12, 0);
ok('segunda 2026-01-05 e dia 1', seg1200.getDay() === 1);
ok('schedule desligado -> true', S.isWithinSchedule(seg1200, { enabled: false }) === true);
ok('schedule dentro', S.isWithinSchedule(seg1200, { enabled: true, startTime: '08:00', stopTime: '18:00', days: [1, 2, 3, 4, 5] }) === true);
ok('schedule fora (hora)', S.isWithinSchedule(new Date(2026, 0, 5, 19, 0), { enabled: true, startTime: '08:00', stopTime: '18:00', days: [1, 2, 3, 4, 5] }) === false);
ok('schedule fora (domingo)', S.isWithinSchedule(new Date(2026, 0, 4, 12, 0), { enabled: true, startTime: '08:00', stopTime: '18:00', days: [1, 2, 3, 4, 5] }) === false);
ok('schedule cruza meia-noite', S.isWithinSchedule(new Date(2026, 0, 5, 23, 0), { enabled: true, startTime: '22:00', stopTime: '06:00', days: [1] }) === true);
const next = S.nextScheduleStart(seg1200, { enabled: true, startTime: '08:00', stopTime: '18:00', days: [1, 2, 3, 4, 5] });
ok('nextScheduleStart futuro/dia valido', next instanceof Date && next.getTime() > seg1200.getTime() && [1, 2, 3, 4, 5].includes(next.getDay()), next && next.toString());

section('8. Configuracao');
const def = S.parseSettings(null);
eq('default baseUrl', def.baseUrl, S.LINKEDIN_SEARCH_URL);
eq('default easyApplyOnly', def.easyApplyOnly, true);
eq('default apply.enabled', def.apply.enabled, true);
eq('default fillRequired', def.apply.fillRequired, false);
eq('default helpOnStuck', def.apply.helpOnStuck, true);
eq('default schedule.enabled', def.schedule.enabled, false);
eq('default terms', def.terms, []);
eq('default dias', def.schedule.days, [1, 2, 3, 4, 5]);
eq('apply.enabled sempre ligado (fixo)', S.parseSettings({ apply: { enabled: false } }).apply.enabled, true);
eq('easyApplyOnly sempre ligado (fixo)', S.parseSettings({ easyApplyOnly: false }).easyApplyOnly, true);
eq('agendador continua desligado por padrao', S.parseSettings({ schedule: { enabled: true } }).schedule.enabled, true);
eq('fillRequired true respeitado', S.parseSettings({ apply: { fillRequired: true } }).apply.fillRequired, true);
const clamp = S.parseSettings({ apply: { minDelayMs: 999999, maxDelayMs: 1, readMinMs: 99999, readMaxMs: 1, perTerm: 9999, answerNumber: 999 } });
ok('delay min<=max', clamp.apply.minDelayMs <= clamp.apply.maxDelayMs);
ok('read min<=max', clamp.apply.readMinMs <= clamp.apply.readMaxMs);
eq('perTerm clampado', clamp.apply.perTerm, 500);
eq('answerNumber clampado', clamp.apply.answerNumber, 200);
eq('answers normalizadas', S.parseSettings({ apply: { answers: { '  ': 'x', q: '', k: ' v ' } } }).apply.answers, { k: 'v' });
eq('terms do texto', S.parseSettings({ terms: 'a, b' }).terms, ['a', 'b']);
eq('helpOnStuck false respeitado', S.parseSettings({ apply: { helpOnStuck: false } }).apply.helpOnStuck, false);

section('8b. Campos obrigatorios para iniciar');
const semNada = S.describeMissing(S.parseSettings(null));
eq('falta localizacao e termos', semNada.fields, ['location', 'terms']);
eq('mensagem diz o que falta', semNada.message, 'Preencha os campos obrigatórios: Localização · Termos de vaga.');
eq('url de outro site conta como faltando', S.describeMissing(S.parseSettings({ baseUrl: 'https://example.com/jobs', location: 'Recife', terms: 'react' })).fields, ['baseUrl']);
eq('url vazia cai no padrao do LinkedIn (e aparece na tela)', S.parseSettings({ baseUrl: '' }).baseUrl, S.LINKEDIN_SEARCH_URL);
eq('localizacao so com espacos nao conta', S.describeMissing(S.parseSettings({ baseUrl: 'https://www.linkedin.com/jobs/search/', location: '   ', terms: 'react' })).fields, ['location']);
const completa = S.parseSettings({ baseUrl: 'https://www.linkedin.com/jobs/search/', location: 'Recife', terms: 'react' });
eq('com tudo preenchido pode rodar', S.describeMissing(completa).fields, []);
eq('sem pendencia nao ha mensagem', S.describeMissing(completa).message, '');
ok('a regra usa a mesma URL do LinkedIn do resto', S.describeMissing(S.parseSettings({ baseUrl: 'https://br.linkedin.com/jobs/search/', location: 'Recife', terms: 'react' })).fields.length === 0);

ok('interruptores fixos ficam desativados na tela', popupHtml.includes('id="easy-apply-only" disabled') && popupHtml.includes('id="apply-enabled" disabled'));
ok('popup valida os obrigatorios antes de iniciar', popupJs.includes('SHARED.describeMissing(parsed)') && popupJs.includes('markMissingFields(falta.fields)'));
ok('campo que falta fica marcado em vermelho', /#settings \.falta \{[\s\S]{0,140}border-color: var\(--danger\)/.test(popupHtml));
ok('aviso de obrigatorios na tela', popupHtml.includes('Obrigatório: URL de busca no LinkedIn, localização e pelo menos 1 termo.'));
ok('rodape da fila avisa que o termo e obrigatorio', popupJs.includes('Informe pelo menos 1 termo'));

section('9. Fila e cotas');
const run = S.buildRunQueue(S.parseSettings({ terms: 'react, node', easyApplyOnly: true }));
eq('fila: 2 urls', run.urls.length, 2);
eq('fila: termo 1', run.terms[0], 'react');
eq('fila: url com filtro', run.urls[0], 'https://www.linkedin.com/jobs/search/?keywords=react&f_AL=true');
ok('fila running/index', run.running === true && run.index === 0);
const runNoTerms = S.buildRunQueue(S.parseSettings(null));
eq('fila sem termos: 1 url', runNoTerms.urls.length, 1);
eq('fila sem termos: termo vazio', runNoTerms.terms[0], '');
const now = Date.now();
ok('cota inicial ok', S.computeQuota(S.parseSettings(null), [], now, 0).ok === true);
const qHour = S.computeQuota(S.parseSettings({ apply: { perHour: 1, per24h: 100, perDay: 0, perTerm: 100 } }), [now], now, 0);
ok('cota hora estoura', qHour.ok === false && qHour.blockedBy === 'hour', JSON.stringify(qHour.used));
ok('resumeAt futuro', qHour.resumeAt > now);
ok('perDay 0 -> Infinity', S.computeQuota(S.parseSettings(null), [], now, 0).limits.day === Infinity);
eq('jitter meio', S.jitter(1000, 0.3, () => 0.5), 1000);
eq('jitter minimo', S.jitter(1000, 0.3, () => 0), 700);
eq('jitter maximo', S.jitter(1000, 0.3, () => 1), 1300);

section('10. Relatorio de candidatura');
eq('label ja_candidatada', S.applyOutcomeLabel('ja_candidatada'), 'Já candidatada antes');
eq('label enviada', S.applyOutcomeLabel('enviada'), 'Enviada');
eq('label desconhecido', S.applyOutcomeLabel('xyz'), 'xyz');
eq('failure enviada -> null', S.describeApplyFailure({ applyStatus: 'enviada' }), null);
const fJa = S.describeApplyFailure({ applyStatus: 'ja_candidatada' });
ok('failure ja: already e nao pending', fJa.already === true && fJa.pending === false, JSON.stringify(fJa));
eq('failure sem status -> nao_tentada', S.describeApplyFailure({}).code, 'nao_tentada');
eq('resumo 1 candidatada', S.describeApplySummary(S.summarizeApply([{ applyStatus: 'enviada' }], { applyEnabled: true })), '1 candidatada(s) nessa sessão');
eq('resumo so ja-candidatadas', S.describeApplySummary(S.summarizeApply([{ applyStatus: 'ja_candidatada' }, { applyStatus: 'ja_candidatada' }], { applyEnabled: true })), '0 candidatada(s) nessa sessão · 2 candidatada(s) antes');
eq('resumo misto', S.describeApplySummary(S.summarizeApply([{ applyStatus: 'enviada' }, { applyStatus: 'travada' }, { applyStatus: 'externa' }], { applyEnabled: true })), '1 candidatada(s) nessa sessão · 2 não candidatada(s): 1 externa (site da empresa) · 1 travada em campo obrigatório');
ok('resumo em uma linha so', S.describeApplySummary(S.summarizeApply([{ applyStatus: 'enviada' }, { applyStatus: 'travada' }], { applyEnabled: true })).indexOf('\n') === -1);
const q = S.computeQuota(S.parseSettings(null), [], now, 0);
eq('describeQuota', S.describeQuota(q), 'Candidaturas — 0/6 na hora · 0/25 em 24 h · 0/8 neste termo');
eq('describeSchedule off', S.describeSchedule({ enabled: false }), 'Agendador desativado.');

section('11. Luz de status');
eq('luz idle', S.statusLight({}).key, 'ready');
eq('luz capturando', S.statusLight({ run: { running: true } }).key, 'capturing');
eq('luz pausa cota', S.statusLight({ run: { running: true, paused: true, pauseReason: 'cota', resumeAt: now + 60000 } }).key, 'ready');
eq('luz guard', S.statusLight({ guard: { blockedUntil: now + 60000, reason: 'x' } }).key, 'attention');
eq('luz problema', S.statusLight({ run: { running: true, problem: 'sem lista' } }).key, 'attention');
eq('luz precisa de ajuda', S.statusLight({ run: { running: true, needsHelp: true, helpMissing: 'Cidade' } }).key, 'attention');

section('12. Deteccao e dialogos');
ok('already candidatou-se', S.looksAlreadyApplied('Candidatou-se há 1 mês') === true);
ok('already voce se candidatou', S.looksAlreadyApplied('Você se candidatou em 12 de out.') === true);
ok('already candidatura enviada', S.looksAlreadyApplied('Candidatura enviada') === true);
ok('already applied (en)', S.looksAlreadyApplied('You applied on March 3') === true);
ok('already NAO casa "nao se candidatou"', S.looksAlreadyApplied('Você ainda não se candidatou a esta vaga') === false);
ok('already NAO casa empresa', S.looksAlreadyApplied('Applied Materials') === false);
eq('plainText', S.plainText('Você se candidatou'), 'voce se candidatou');
eq('hostOf externo', S.hostOf('https://careers.acme.com/x/y'), 'careers.acme.com');
ok('isOffsiteUrl externo', S.isOffsiteUrl('https://careers.acme.com') === true);
ok('isOffsiteUrl linkedin', S.isOffsiteUrl('https://www.linkedin.com/jobs/view/1/') === false);
eq('classifyApply easy', S.classifyApply({ label: 'Candidatura simplificada' }), 'simplificada');
eq('classifyApply externa href', S.classifyApply({ href: 'https://careers.acme.com' }), 'externa');
eq('classifyApply externa label', S.classifyApply({ label: 'Candidatar-se no site da empresa' }), 'externa');
eq('classifyApply desconhecida', S.classifyApply({}), 'desconhecida');
eq('classifyDialog form', S.classifyDialog({ hasApplyAction: true }), 'formulario');
eq('classifyDialog survey', S.classifyDialog({ text: 'avalie como foi sua experiencia' }), 'pesquisa');
eq('classifyDialog aviso', S.classifyDialog({ hasClose: true }), 'aviso');
eq('classifyDialog desconhecido', S.classifyDialog({}), 'desconhecido');
eq('dismiss Fechar', S.matchDismissLabel('Fechar'), 'fechar');
eq('dismiss Agora nao', S.matchDismissLabel('Agora não'), 'agora_nao');
eq('dismiss Descartar (nunca)', S.matchDismissLabel('Descartar'), '');
eq('dismiss Pular', S.matchDismissLabel('Pular'), 'dispensar');
eq('answerForQuestion casa', S.answerForQuestion('Você tem autorização?', { autorizacao: 'Não' }), 'Não');
eq('pickChoice sim', S.pickChoice(['Selecione uma opção', 'Sim', 'Não'], { yes: true }), 'Sim');
eq('pickChoice nao', S.pickChoice(['Selecione', 'Não', 'Sim'], { yes: false }), 'Não');
eq('pickChoice so placeholder', S.pickChoice(['Selecione uma opção'], { yes: true }), '');
eq('pickChoice vazio', S.pickChoice([], {}), '');

section('13. Teto de armazenamento');
const vaga = (id, chars, at) => ({ id: id, description: 'x'.repeat(chars), capturedAt: at });
const dia = (n) => new Date(2026, 0, n, 12, 0).toISOString();
const mapa = {};
for (let i = 1; i <= 5; i += 1) mapa['j' + i] = vaga('j' + i, 10, dia(i));
const cortado = S.trimJobs(mapa, { maxJobs: 3, maxChars: 100 });
eq('trimJobs respeita o teto de vagas', Object.keys(cortado.jobs).length, 3);
eq('trimJobs conta os descartados', cortado.dropped, 2);
eq('trimJobs mantem as mais novas', Object.keys(cortado.jobs).sort(), ['j3', 'j4', 'j5']);
const curta = S.trimJobs(mapa, { maxJobs: 9, maxChars: 4 });
eq('trimJobs corta a descricao longa', curta.jobs.j1.description, 'xxxx');
eq('trimJobs preserva o resto da vaga', curta.jobs.j1.id, 'j1');
eq('trimJobs nao corta o que cabe', S.trimJobs(mapa, { maxJobs: 9, maxChars: 50 }).jobs.j2.description.length, 10);
ok('trimJobs devolve o mesmo mapa quando nao ha nada a cortar', S.trimJobs(mapa, { maxJobs: 9, maxChars: 50 }).jobs === mapa);
eq('trimJobs mapa vazio', Object.keys(S.trimJobs({}).jobs).length, 0);
eq('trimJobs sem parametros usa o padrao', S.trimJobs(mapa).dropped, 0);
eq('trimJobs descarta entrada invalida', Object.keys(S.trimJobs({ a: null, b: vaga('b', 5, dia(2)) }, { maxJobs: 9 }).jobs), ['b']);
eq('trimJobs vaga sem capturedAt e a mais antiga', Object.keys(S.trimJobs({ novo: vaga('novo', 5, dia(9)), velho: { id: 'velho', description: 'z' } }, { maxJobs: 1 }).jobs), ['novo']);
ok('teto de vagas definido', S.MAX_JOBS >= 1000);
ok('limite de descricao definido', S.DESC_MAX_CHARS >= 2000);

section('14. Modo simulacao (dry-run)');
const contentJs = read('content.js');
ok('dryRun desligado por padrao', S.DEFAULT_SETTINGS.apply.dryRun === false);
ok('dryRun aceita true', S.parseSettings({ apply: { dryRun: true } }).apply.dryRun === true);
ok('dryRun recusa valor solto', S.parseSettings({ apply: { dryRun: 'sim' } }).apply.dryRun === false);
ok('desfecho simulada registrado', Boolean(S.APPLY_OUTCOMES.simulada));
ok('simulada nao e "enviada" nem "ja candidatada"', S.APPLY_OUTCOMES.simulada.failure === true && !S.APPLY_OUTCOMES.simulada.already);
eq('rotulo da simulada', S.applyOutcomeLabel('simulada'), S.APPLY_OUTCOMES.simulada.label);
ok('motivo da simulada explica que nao enviou', /simula/i.test(S.APPLY_OUTCOMES.simulada.reason));

const resumoDry = S.summarizeApply(
  [{ id: 'a', applyStatus: 'simulada' }, { id: 'b', applyStatus: 'enviada' }],
  { applyEnabled: true }
);
eq('simulada nao conta como enviada', resumoDry.applied, 1);
eq('simulada entra nas nao candidatadas', resumoDry.failed, 1);
ok('resumo cita a simulada', /simulada/i.test(S.describeApplySummary(resumoDry)));
eq('relatorio da vaga simulada', S.describeApplyFailure({ applyStatus: 'simulada' }).code, 'simulada');

ok('a extensao para antes do envio', /if \(action\.kind === 'submit' && cfg\.dryRun\)/.test(contentJs));
ok('dry-run fecha o formulario sem enviar', /cfg\.dryRun\)[\s\S]{0,160}closeModal\(modal, true\)[\s\S]{0,80}status: 'simulada'/.test(contentJs));
ok('so "enviada" consome cota', /result\.status === 'enviada'[\s\S]{0,160}state\.apps\.push/.test(contentJs));
ok('popup tem o interruptor do modo simulacao', popupHtml.includes('id="apply-dry-run"'));
ok('popup le e grava o dryRun', popupJs.includes('settings.apply.dryRun') && popupJs.includes('dryRun: els.applyDryRun.checked'));
ok('fila avisa que esta em simulacao', popupJs.includes('modo simulação (não envio)'));

section('15. Diagnostico (relato de problema)');
const diag = S.buildDiagnostics({
  version: '9.9.9',
  ua: 'Chrome/1 · Linux',
  when: '13/10/2026, 10:00',
  count: 7,
  dropped: 2,
  lastRun: '13/10/2026, 09:00',
  apps: 3,
  run: { running: true, term: 'react', appliedInTerm: 2, appliedTotal: 4, terms: ['react', 'node'] },
  guard: { blockedUntil: seg1200.getTime(), reason: 'verificacao' },
  dryRun: true,
  theme: 'dark',
  settings: { terms: ['react'] },
  errors: [{ at: '13/10/2026, 09:59', where: 'clicar', message: 'elemento sumiu' }],
});
ok('diagnostico comeca pelo cabecalho', diag.startsWith('PegaVaga — diagnóstico'));
ok('diagnostico traz versao e navegador', diag.includes('9.9.9') && diag.includes('Chrome/1'));
ok('diagnostico traz as contagens', diag.includes('Vagas: 7') && diag.includes('descartadas por espaço: 2') && diag.includes('Candidaturas registradas: 3'));
ok('diagnostico descreve a fila', diag.includes('rodando') && diag.includes('"react"') && diag.includes('2 termo(s) na fila'));
ok('diagnostico mostra o bloqueio', /Bloqueio: até/.test(diag));
ok('diagnostico mostra o modo simulacao', diag.includes('Modo simulação: ligado'));
ok('diagnostico embute a configuracao', diag.includes('"terms"') && diag.includes('react'));
ok('diagnostico lista o erro com rotulo', diag.includes('clicar') && diag.includes('elemento sumiu'));
ok('diagnostico avisa para conferir antes de colar', /confira antes de colar/.test(diag));
ok('diagnostico vazio nao quebra', ['Fila: parada', 'Modo simulação: desligado', '(nenhum registrado)'].every((t) => S.buildDiagnostics({}).includes(t)));
ok('diagnostico tolera entrada invalida', S.buildDiagnostics(null).includes('PegaVaga — diagnóstico') && S.buildDiagnostics({ count: 'x' }).includes('Vagas: 0'));
const muitos = S.buildDiagnostics({ errors: Array.from({ length: 80 }, (_, i) => ({ where: 'e' + i, message: 'x' })) });
ok('diagnostico corta nos ultimos ' + S.ERROR_KEEP, muitos.includes('Últimos ' + S.ERROR_KEEP + ' erro(s):') && !muitos.includes('e0:'));

const catchesMudos = (contentJs.match(/\}\s*catch\s*\([^)]*\)\s*\{\s*(?:\/\*[^*]*\*\/\s*)?\}/g) || []);
ok('so 2 catches mudos de proposito', catchesMudos.length <= 2, catchesMudos.length + ' mudos');
ok('content.js registra os erros', (contentJs.match(/noteError\('/g) || []).length >= 30);
ok('um unico catch realmente mudo', (contentJs.match(/\.catch\(\(\)\s*=>\s*\{\s*\}\)/g) || []).length <= 1);
ok('ERROR_KEEP em faixa util', S.ERROR_KEEP >= 20 && S.ERROR_KEEP <= 200);
ok('popup tem o botao de diagnostico', popupHtml.includes('id="btn-diag"'));
ok('popup copia o diagnostico', popupJs.includes('buildDiagnostics') && popupJs.includes('navigator.clipboard.writeText'));

section('16. Backup e restauracao da configuracao');
const cfgBackup = S.parseSettings({
  baseUrl: 'https://www.linkedin.com/jobs/search/',
  terms: 'react, node.js, react',
  apply: { perHour: 4, dryRun: true, answers: { cidade: 'Recife' } },
  schedule: { enabled: true, startTime: '08:00', stopTime: '18:00' },
});
const backup = S.buildSettingsBackup(cfgBackup, {
  version: '1.2.3',
  exportedAt: '2026-10-13T10:00:00.000Z',
});
const backupJson = JSON.parse(backup);
eq('backup tem cabecalho proprio', [backupJson.app, backupJson.kind, backupJson.version], ['pegavaga', 'config', '1.2.3']);
eq('backup leva as buscas sem repeticao', backupJson.settings.terms, ['react', 'node.js']);
eq('backup leva as respostas do formulario', backupJson.settings.apply.answers.cidade, 'Recife');
eq('backup leva o modo simulacao', backupJson.settings.apply.dryRun, true);
ok('backup e um JSON legivel (2 espacos + quebra final)', backup.includes('\n  "app"') && backup.endsWith('\n'));

const volta = S.parseSettingsBackup(backup);
eq('ida e volta preserva as buscas', volta.settings.terms, ['react', 'node.js']);
eq('ida e volta preserva o dry-run', volta.settings.apply.dryRun, true);
eq('ida e volta preserva as respostas', volta.settings.apply.answers.cidade, 'Recife');
eq('ida e volta preserva o agendador', [volta.settings.schedule.enabled, volta.settings.schedule.startTime], [true, '08:00']);
eq('ida e volta lembra de onde veio', [volta.version, volta.exportedAt], ['1.2.3', '2026-10-13T10:00:00.000Z']);

const cru = S.parseSettingsBackup(JSON.stringify({ terms: 'python' }));
eq('aceita configuracao crua (sem cabecalho)', cru.settings.terms, ['python']);
eq('cru sem versao fica vazio', cru.version, '');

const clampado = S.parseSettingsBackup(JSON.stringify({ apply: { perHour: 99999, perTerm: 'x' } }));
eq('restauracao passa pelo parseSettings (clampa)', clampado.settings.apply.perHour, 1000);
eq('restauracao corrige valor invalido', clampado.settings.apply.perTerm, S.DEFAULT_SETTINGS.apply.perTerm);

const recusados = [];
['', 'nao e json', '[]', '"texto"', 'null', '{"foo": 1}', '{"settings": null}'].forEach((t) => {
  try {
    S.parseSettingsBackup(t);
    recusados.push('passou: ' + t);
  } catch (error) {
    if (!/JSON válido|configuração/.test(error.message)) recusados.push('msg: ' + error.message);
  }
});
eq('arquivo que nao serve e recusado com mensagem', recusados, []);

ok('popup tem salvar e restaurar', ['id="btn-backup"', 'id="btn-restore"', 'id="input-restore"', 'id="btn-restore-go"', 'id="btn-restore-cancel"'].every((t) => popupHtml.includes(t)));
ok('popup usa os helpers puros do backup', popupJs.includes('buildSettingsBackup') && popupJs.includes('parseSettingsBackup'));
const trechoEscolher = popupJs.slice(
  popupJs.indexOf('async function onRestoreFile'),
  popupJs.indexOf('async function onRestoreConfirm')
);
ok(
  'escolher o arquivo nao grava nada',
  trechoEscolher.includes('restoreCheck.hidden = false') && !trechoEscolher.includes('storage.local.set')
);
ok('restauracao grava e repoe a tela depois de confirmar', /async function onRestoreConfirm[\s\S]{0,600}storage\.local\.set[\s\S]{0,200}loadSettingsToForm[\s\S]{0,200}saveSettingsFromForm/.test(popupJs));
ok('download aceita tipo proprio', popupJs.includes('function downloadFile(content, filename, type)'));

section('17. Notificacao de fim de varredura');
ok('notifyOnFinish ligado por padrao', S.DEFAULT_SETTINGS.apply.notifyOnFinish === true);
ok('notifyOnFinish aceita desligar', S.parseSettings({ apply: { notifyOnFinish: false } }).apply.notifyOnFinish === false);
ok('notifyOnFinish recusa valor solto', S.parseSettings({ apply: { notifyOnFinish: 'nao' } }).apply.notifyOnFinish === true);
ok('MSG.DONE registrada', S.MSG.DONE === 'PEGAVAGA_DONE');

const fimRun = S.describeRunEnd({ reason: 'fila', jobs: 128, applied: 9, dropped: 0, dryRun: false });
eq('titulo da conclusao', fimRun.title, 'PegaVaga terminou a varredura');
ok('conclusao traz vagas e candidaturas', fimRun.message.includes('128 vagas capturadas') && fimRun.message.includes('9 candidaturas enviadas'));
ok('conclusao nao e urgente', fimRun.urgent === false);
eq('singular com uma vaga e uma candidatura', S.describeRunEnd({ jobs: 1, applied: 1 }).message, '1 vaga capturada · 1 candidatura enviada.');
ok('modo simulacao muda o texto', /sem enviar \(modo simulação\)/.test(S.describeRunEnd({ jobs: 3, applied: 2, dryRun: true }).message));
ok('descarte entra no texto quando existe', S.describeRunEnd({ jobs: 3, applied: 1, dropped: 4 }).message.includes('4 antiga(s) descartada(s) por espaço'));
ok('sem descarte o texto nao fala disso', !S.describeRunEnd({ jobs: 3, applied: 1 }).message.includes('descartada'));

const paradaRun = S.describeRunEnd({ reason: 'bloqueio', guardReason: 'Aviso de limite de uso na página do LinkedIn' });
eq('titulo da parada por protecao', paradaRun.title, 'PegaVaga parou para proteger a sua conta');
ok('parada e urgente e traz o motivo', paradaRun.urgent === true && paradaRun.message.includes('Aviso de limite de uso'));
ok('parada sem motivo tambem funciona', S.describeRunEnd({ reason: 'bloqueio' }).message.includes('limite de uso'));
ok('texto tolera dados vazios', S.describeRunEnd({}).message === '0 vagas capturadas · 0 candidaturas enviadas.' && S.describeRunEnd(null).title.length > 0);

ok('content avisa o fim da fila antes de limpar', /notifyRunEnded\('fila'\);[\s\S]{0,90}clearRun\(\)/.test(contentJs));
ok('content avisa a parada por protecao', /notifyRunEnded\('bloqueio'\)/.test(contentJs));
ok('aviso respeita a opcao e o foco da pagina', /notifyOnFinish === false\) return/.test(contentJs) && contentJs.includes('document.hasFocus()'));
const bgJs = read('background.js');
ok('background mostra o aviso de fim', bgJs.includes('showRunEndNotification') && bgJs.includes('MSG.DONE') && bgJs.includes('DONE_NOTIFICATION_ID'));
ok('clique no aviso traz a aba para frente', /DONE_NOTIFICATION_ID\) focusRunTab/.test(bgJs));
ok('popup tem o interruptor do aviso', popupHtml.includes('id="apply-notify-finish"') && popupJs.includes('notifyOnFinish: els.applyNotifyFinish.checked'));

section('18. Badge com as candidaturas do dia');
const agoraBadge = new Date(2026, 9, 13, 15, 30).getTime(); // 13/10/2026 15:30 (local)
const meiaNoiteHoje = new Date(2026, 9, 13, 0, 0).getTime();
const ontemBadge = new Date(2026, 9, 12, 23, 59).getTime();
const amanhaBadge = new Date(2026, 9, 14, 0, 1).getTime();

eq('conta so as de hoje', S.countAppsToday([ontemBadge, meiaNoiteHoje, agoraBadge, amanhaBadge], agoraBadge), 2);
eq('lista vazia', S.countAppsToday([], agoraBadge), 0);
eq('lista invalida', S.countAppsToday(null, agoraBadge), 0);
eq('lixo no historico e ignorado', S.countAppsToday(['x', null, NaN, agoraBadge], agoraBadge), 1);
eq('meia-noite de hoje conta', S.countAppsToday([meiaNoiteHoje], agoraBadge), 1);
eq('um segundo antes nao conta', S.countAppsToday([meiaNoiteHoje - 1], agoraBadge), 0);

eq('badge vazio quando nao ha nada', S.badgeText(0), '');
eq('badge com um digito', S.badgeText(7), '7');
eq('badge no limite', S.badgeText(99), '99');
eq('badge acima de 99', S.badgeText(100), '99+');
eq('badge tolera lixo', S.badgeText('x'), '');
eq('badge aceita numero em texto', S.badgeText('12'), '12');

ok('background usa o contador no badge', bgJs.includes('SHARED.badgeText(todayCount)') && bgJs.includes("setAction('setBadgeText'"));
ok('contador acompanha o historico de candidaturas', /changes\[STORAGE\.apps\]\) refreshBadge\(\)/.test(bgJs));
ok('virada do dia zera e remarca o alarme', /alarm\.name === ALARM_BADGE_RESET[\s\S]{0,120}refreshBadge\(\)\.then\(\(\) => scheduleBadgeReset\(\)\)/.test(bgJs));
ok('contador aparece tambem ao subir o worker', /refreshBadge\(\);\s*\n\s*scheduleBadgeReset\(\)/.test(bgJs) && bgJs.includes('refreshLocale().then(() => refreshStatus())'));
ok('plano B mantem o selo colorido da luz', /paintedLight == null/.test(bgJs) && bgJs.includes('setBadgeBackgroundColor'));

section('18b. Parar imediato');
// O Parar não pode esperar a pausa/etapa atual terminar (12 s de leitura, 20 s
// de confirmação eram o que fazia o botão parecer que não funcionava).
ok('parar acorda as esperas', /case MSG\.STOP:[\s\S]{0,320}wakeWaiters\(\)/.test(contentJs));
ok('limpar tambem acorda as esperas', /case MSG\.CLEAR:[\s\S]{0,320}wakeWaiters\(\)/.test(contentJs));
ok('pausa humana obedece ao parar', /function humanPause\(baseMs, ratio\) \{\s*\n\s*return pause\(/.test(contentJs));
ok('a pausa desiste no abort', /function pause\(ms\)[\s\S]{0,260}state\.abort \? true : null/.test(contentJs));
ok('aba reage a fila removida no storage', /changes\[STORAGE_RUN_KEY\][\s\S]{0,260}state\.abort = true;[\s\S]{0,80}wakeWaiters\(\)/.test(contentJs));

section('18c. Relatos de erro (fila local)');
const agoraRelato = new Date(2026, 9, 14, 20, 0).getTime();
const errosRajada = [
  { ts: agoraRelato - 1000, where: 'clicar', message: 'boom' },
  { ts: agoraRelato - 2000, where: 'clicar', message: 'boom' },
  { ts: agoraRelato - 3000, where: 'clicar', message: 'boom' },
];

eq('rajada de 3 erros vale relato', S.burstReason(errosRajada, { now: agoraRelato }), 'rajada');
eq('dois erros nao valem', S.burstReason(errosRajada.slice(0, 2), { now: agoraRelato }), '');
eq('erro antigo sai da janela', S.burstReason(errosRajada, { now: agoraRelato + 6 * 60 * 1000 }), '');
eq('errorsSince corta pela janela', S.errorsSince(errosRajada, agoraRelato - 2500).length, 2);
eq('errorsSince tolera lixo', S.errorsSince(null, 0).length, 0);

const relatoBase = S.buildReport({
  reason: 'rajada',
  errors: errosRajada,
  payload: 'diagnostico congelado',
  at: agoraRelato,
  when: '14/10/2026, 20:00',
});
eq('relato nasce pendente', relatoBase.status, 'pendente');
eq('relato guarda o motivo', relatoBase.reason, 'rajada');
eq('relato congela o diagnostico', relatoBase.payload, 'diagnostico congelado');
eq('relato tem id com o carimbo', relatoBase.id, 'r-' + agoraRelato);
eq('relato corta a lista de erros', S.buildReport({ errors: new Array(30).fill(errosRajada[0]), at: agoraRelato }).errors.length, 10);
ok('relato corta o diagnostico gigante', S.buildReport({ payload: 'x'.repeat(50000), at: agoraRelato }).payload.length === 20000);

const fila = S.pushReport([], relatoBase, { now: agoraRelato });
eq('relato entra na fila', fila.list.length, 1);
ok('relato adicionado volta como added', fila.added && fila.added.id === relatoBase.id);
const repetido = S.pushReport(fila.list, S.buildReport({ reason: 'rajada', errors: errosRajada, at: agoraRelato + 60000 }), { now: agoraRelato + 60000 });
eq('mesmo problema nao entra de novo', repetido.list.length, 1);
eq('mesmo problema nao volta como added', repetido.added, null);
const outroMotivo = S.pushReport(fila.list, S.buildReport({ reason: 'sem-lista', errors: [{ ts: agoraRelato, where: 'x', message: 'y' }], at: agoraRelato + 60000 }), { now: agoraRelato + 60000 });
eq('motivo diferente entra', outroMotivo.list.length, 2);
const depoisDoCooldown = S.pushReport(fila.list, S.buildReport({ reason: 'rajada', errors: errosRajada, at: agoraRelato + 31 * 60 * 1000 }), { now: agoraRelato + 31 * 60 * 1000 });
eq('passado o cooldown entra de novo', depoisDoCooldown.list.length, 2);

const cheia = S.pushReport(new Array(9).fill(0).map((zero, i) => S.buildReport({ reason: 'erro' + i, errors: [{ ts: agoraRelato - i, where: 'w' + i, message: 'm' + i }], at: agoraRelato - i })), S.buildReport({ reason: 'novo', errors: [], at: agoraRelato }), { now: agoraRelato });
eq('lista respeita o teto', cheia.list.length, S.REPORTS_MAX);

const marcada = S.markReport(fila.list, relatoBase.id, 'enviado', { now: agoraRelato + 1000, channel: 'endpoint' });
eq('marcar enviado muda o status', marcada[0].status, 'enviado');
eq('marcar enviado guarda a hora', marcada[0].sentAt, agoraRelato + 1000);
eq('marcar enviado guarda o canal', marcada[0].channel, 'endpoint');
eq('marcar mantem o resto', marcada[0].payload, 'diagnostico congelado');
eq('marcar id desconhecido nao estraga a lista', S.markReport(fila.list, 'r-nao-existe', 'enviado').length, 1);
eq('marcar como local nao guarda hora', S.markReport(fila.list, relatoBase.id, 'local')[0].sentAt, null);

eq('resumo da fila', JSON.stringify(S.summarizeReports(marcada)), '{"total":1,"pending":0,"sent":1,"kept":0}');
eq('resumo de lista invalida', JSON.stringify(S.summarizeReports(null)), '{"total":0,"pending":0,"sent":0,"kept":0}');
eq('pendente mais recente', S.lastPendingReport([relatoBase, S.buildReport({ reason: 'sem-lista', at: agoraRelato + 5 })][0] ? [relatoBase] : []) === relatoBase && S.lastPendingReport([{ status: 'enviado', id: 'x' }]) === null, true);
eq('sem pendente devolve null', S.lastPendingReport([{ id: 'x', status: 'enviado' }]), null);
ok('descricao do relato', S.describeReport(relatoBase).includes('3 erro(s)') && S.describeReport(relatoBase).includes('14/10/2026, 20:00'));
ok('rotulo do motivo', S.reportReasonLabel('rajada') === 'rajada de erros' && S.reportReasonLabel('sei-la') === 'erro na automação');

// Fiação: quem cria é o content, quem envia é o service worker.
ok('content cria relato na rajada e sem lista', /burstReason\(state\.errors\)\) createReport\('rajada'\)/.test(contentJs) && /if \(problem\) createReport\('sem-lista'\)/.test(contentJs));
ok('content congela o diagnostico', /createReport\(reason\)[\s\S]{0,700}buildDiagnostics\(/.test(contentJs) && /createReport\(reason\)[\s\S]{0,900}buildReport\(/.test(contentJs));
ok('relato nao gera relato (sem laco)', !/catch[\s\S]{0,200}noteError/.test(contentJs.slice(contentJs.indexOf('async function createReport'), contentJs.indexOf('async function createReport') + 900)));
const bgRelato = read('background.js');
ok('background le o env com tolerancia', /try \{\s*\n\s*importScripts\('env\.js'\)/.test(bgRelato));
ok('background envia pelo endpoint configurado', bgRelato.includes("mode: 'no-cors'") && bgRelato.includes('REPORT_ENDPOINT'));
ok('background agrupa a notificacao de relato', /reportNotifiedAt/.test(bgRelato) && bgRelato.includes('REPORT_NOTIFICATION_ID'));
ok('background tem os dois botoes do relato', bgRelato.includes("sendPendingReport()") || bgRelato.includes('sendPendingReport(message.id)'));
ok('popup lista os relatos e envia', popupJs.includes('function renderReports') && popupJs.includes('MSG.REPORT_SEND') && popupJs.includes('data-acao'));
ok('env de exemplo documentado e o real fora do git', read('env.example.js').includes('reportEndpoint') && read('.gitignore').includes('env.js'));
ok('empacotador inclui o env.js', packSh.includes("zipfile") && packSh.includes('env.js'));

section('18d. Pop-up fecha ao perder o foco');
ok('popup fecha no blur', /window\.addEventListener\('blur'[\s\S]{0,140}window\.close\(\)/.test(popupJs));
ok('segurar o foco so no seletor de arquivo', /segurarFoco = true;[\s\S]{0,90}inputRestore\.click\(\)/.test(popupJs));
ok('foco de volta libera o fechamento', /window\.addEventListener\('focus'[\s\S]{0,90}segurarFoco = false/.test(popupJs));

section('19. Idioma da interface (pt/en)');
const marcadoresDe = (s) => [...String(s).matchAll(/\{([a-z0-9_]+)\}/gi)].map((m) => m[1]).sort().join(',');
const neutrosI18n = ['PegaVaga', 'English', 'https://www.linkedin.com/jobs/search/'];

eq('idioma padrao e automatico', S.parseSettings(null).locale, 'auto');
eq('idioma aceito', S.parseSettings({ locale: 'en' }).locale, 'en');
eq('idioma invalido volta para automatico', S.parseSettings({ locale: 'klingon' }).locale, 'auto');
eq('normalizeLocale entende variantes', [S.normalizeLocale('pt-BR'), S.normalizeLocale('en-US'), S.normalizeLocale('auto'), S.normalizeLocale('fr')].join('|'), 'pt|en||');
eq('LOCALES', S.LOCALES.join(','), 'pt,en');

S.setLocale('pt');
eq('t() em pt devolve o proprio texto', S.t('Início'), 'Início');
eq('t() substitui marcadores', S.t('{n} vagas capturadas', { n: 3 }), '3 vagas capturadas');
ok('notificacao sai em pt por padrao', S.describeRunEnd({ jobs: 3, applied: 2 }).message === '3 vagas capturadas · 2 candidaturas enviadas.');

S.setLocale('en');
eq('t() em en traduz', S.t('Início'), 'Home');
eq('t() traduz com marcadores', S.t('{n} vagas capturadas', { n: 3 }), '3 jobs captured');
eq('t() sem valor deixa o marcador', S.t('{n} vagas capturadas', {}), '{n} jobs captured');
eq('t() sem traducao devolve o original', S.t('Texto que ninguem traduziu'), 'Texto que ninguem traduziu');
eq('t() aceita idioma forcado', S.t('Início', null, 'pt'), 'Início');
eq('translate() traduz texto pronto', S.translate('Nenhuma varredura realizada'), 'No scan yet');
eq('translate() preserva os espacos das pontas', S.translate('\n      Início\n    '), '\n      Home\n    ');
eq('translate() traduz texto com numero', S.translate('128 vagas capturadas'), '128 jobs captured');
eq('translate() traduz o valor dentro do marcador', S.translate('Pausada por cota de candidaturas até 14:30.'), 'Paused by application quota until 14:30.');
eq('translate() nao inventa traducao', S.translate('Texto solto por ai'), 'Texto solto por ai');
eq('translate() em pt nao mexe', S.translate('Início', 'pt'), 'Início');
const notificacaoEn = S.describeRunEnd({ jobs: 3, applied: 2 });
ok('notificacao sai traduzida', notificacaoEn.title === 'PegaVaga finished the scan' && notificacaoEn.message === '3 jobs captured · 2 applications sent.');
const urgenteEn = S.describeRunEnd({ reason: 'bloqueio', guardReason: 'Aviso de limite de uso na página do LinkedIn' });
ok('notificacao urgente traduz o motivo', urgenteEn.urgent === true && urgenteEn.message.includes('LinkedIn usage limit warning on the page'));
S.setLocale('pt');

// Cobertura: nada da interface fica sem tradução no idioma novo.
const corpoPopup = popupHtml.slice(popupHtml.indexOf('</style>'));
// Texto **cru**, como o navegador entrega: com as quebras de linha e a
// indentação do HTML. Normalizar aqui esconderia o bug que deixava metade do
// painel em português (rótulo quebrado em duas linhas não casava com a chave).
const nosDaTela = [...corpoPopup.matchAll(/>([^<>{}]{3,}?)</g)].map((m) => m[1]);
const textosPopup = nosDaTela.map((t) => t.replace(/\s+/g, ' ').trim()).filter((t) => /[A-Za-zÀ-ÿ]{3}/.test(t));
const atributosPopup = [...corpoPopup.matchAll(/(?:title|placeholder|aria-label)="([^"]{3,})"/g)].map((m) => m[1]);
S.setLocale('en'); // as duas verificações abaixo olham o idioma de destino
eq('todo texto do pop-up tem traducao', [...new Set(textosPopup)].filter((t) => S.UI_EN[t] == null && !neutrosI18n.includes(t)), []);
eq('todo atributo do pop-up tem traducao', [...new Set(atributosPopup)].filter((t) => S.UI_EN[t] == null && !neutrosI18n.includes(t)), []);
const nosSemTraducao = [...new Set(nosDaTela)].filter((cru) => {
  const miolo = cru.replace(/\s+/g, ' ').trim();
  if (!/[A-Za-zÀ-ÿ]{3}/.test(miolo) || !/\s/.test(miolo)) return false;
  if (neutrosI18n.includes(miolo)) return false;
  return S.translate(cru) === cru; // ficou igual = continua em português
});
eq('nenhum no da tela fica em portugues', nosSemTraducao, []);
eq('marcadores batem nos dois idiomas', Object.entries(S.UI_EN).filter((par) => marcadoresDe(par[0]) !== marcadoresDe(par[1])).map((par) => par[0]), []);
eq('nenhuma traducao vazia', Object.entries(S.UI_EN).filter((par) => !String(par[1]).trim()).map((par) => par[0]), []);
ok('dicionario tem volume util', Object.keys(S.UI_EN).length >= 120);

// Garantia de cobertura: varre o código atrás de texto de interface sem
// tradução. Antes disso o teste só olhava o HTML, e foi assim que frases
// montadas em código (e depois compostas) ficaram em português.
const IGNORAR_I18N = [
  /^[a-z0-9_.:-]+$/i, /^[.#\[>]/, /^[A-Z_]+$/, /px$|^\d|^\s*$/,
  /https?:|[<>{}();=]|\\|function |querySelector|classList|use strict|text\/csv/,
  /^\[PegaVaga\]/, /^(prev|full|light|hint ok|failure)$/, /^[a-z_]+$/,
  /^[a-z-]+( [a-z-]+)*$/, // nomes de classe CSS ("btn ghost", "report pendente")
  /^(ID|Titulo|Empresa|Link|Descricao|Capturado em|Termo|Tentativas|Candidatado em|Ultima tentativa|Status da candidatura|Motivo da nao candidatura)$/,
  /(sistema|navegador) não identificado/, // só no diagnóstico, que é em pt
];
const REGIOES_PT_I18N = [/function buildDiagnostics/, /function diagRun/, /function safeCount/];
// Fragmentos que só aparecem **montados**: quem está no dicionário é a frase
// inteira (ver as verificações de composição logo abaixo).
const FRAGMENTOS_OK = [
  'Navegando para a primeira busca',
  ' e iniciando a varredura…',
  'Abrindo a busca do LinkedIn em uma nova aba',
  'Fora da janela do agendador',
  ': a varredura fica aguardando o horário.',
  'Varredura em andamento',
  ' O PegaVaga avança pelos termos sozinho.',
  'Configuração restaurada',
  'Configuração salva em ',
  'Não consegui usar esse arquivo: ',
  'Termo: ',
  'Salvo automaticamente às ',
  'Última varredura: ',
  'Descartei ',
  '⛔ LinkedIn sinalizou limite de uso',
  ': a automação está descansando até ',
  'O LinkedIn sinalizou limite de uso: a automação fica parada até ',
  ' até ',
  'Pausado por ',
  '✋ PegaVaga precisa de ajuda: não consegui preencher ',
  'Falha ao gerar o arquivo: ',
  'Janela ativa: ',
  'Janela: ',
  ' · próxima: ',
  'LinkedIn sinalizou limite de uso',
  'PegaVaga precisa de ajuda para continuar',
  'Pausada por ',
  'Descansando até ',
  'Capturando vagas — ',
  'PegaVaga — ',
  ' na fila',
  'termo ',
];

const textosSemTraducao = [];
const corpoCodigo = ['popup.js', 'shared.js'].map(read);

S.setLocale('en'); // a varredura precisa enxergar o idioma de destino

for (const fonte of corpoCodigo) {
  const linhas = fonte.split('\n');
  let noDicionario = false;
  let emRegiaoPt = null;

  linhas.forEach((linha) => {
    // Comentário não é interface (e o JSDoc cita trechos de código).
    const enxuta = linha.trim();
    if (enxuta.startsWith('*') || enxuta.startsWith('//') || enxuta.startsWith('/*')) return;

    if (/const UI_EN = \{/.test(linha)) noDicionario = true;
    if (noDicionario) {
      if (/^  \};/.test(linha)) noDicionario = false;
      return;
    }

    const regiao = REGIOES_PT_I18N.find((re) => re.test(linha));
    if (regiao) emRegiaoPt = regiao;
    if (emRegiaoPt && /^  \}/.test(linha)) emRegiaoPt = null;
    if (emRegiaoPt) return;

    const literais = [
      ...linha.matchAll(/'((?:[^'\\\n]|\\.)*)'/g),
      ...linha.matchAll(/`([^`]*)`/g),
    ].map((m) => m[1]);

    for (const texto of literais) {
      if (texto.length < 4 || !/[A-Za-zÀ-ÿ]{3}/.test(texto)) continue;
      if (!/\s/.test(texto) && !/[À-ÿ]/.test(texto)) continue;
      if (IGNORAR_I18N.some((re) => re.test(texto.trim()))) continue;
      if (FRAGMENTOS_OK.includes(texto)) continue;
      if (S.translate(texto) !== texto) continue;
      if (!textosSemTraducao.includes(texto)) textosSemTraducao.push(texto);
    }
  });
}

S.setLocale('en');
eq('nenhum texto de interface sem traducao', textosSemTraducao, []);

// Composições: aqui é onde estavam os buracos — frase montada por código com
// valores dentro precisa sair traduzida inteira.
eq('toast de inicio (com fila)', S.translate('Navegando para a primeira busca (Termo: react.) e iniciando a varredura…'), 'Opening the first search (Term: react.) and starting the scan…');
eq('aviso de limite de uso', S.translate('⛔ LinkedIn sinalizou limite de uso: a automação está descansando até 14:30. Aproveite para revisar as vagas já capturadas.'), '⛔ LinkedIn flagged a usage limit: the automation is resting until 14:30. Good time to review the jobs you captured.');
eq('faixa de ajuda', S.translate('✋ PegaVaga precisa de ajuda: não consegui preencher Telefone. Abra a aba do LinkedIn e complete — ou clique em "Pular vaga atual".'), '✋ PegaVaga needs your help: I could not fill Telefone. Open the LinkedIn tab and complete it — or click "Skip current job".');
eq('aviso de descarte', S.translate('Descartei 3 vaga(s) antiga(s) para o armazenamento não encher (guardo as 5000 mais recentes). Exporte a planilha de vez em quando para não perder nada.'), 'I dropped 3 old job(s) so storage does not fill up (I keep the 5000 most recent). Export the spreadsheet now and then so you lose nothing.');
eq('dica da barra de cota', S.translate('Última hora: 3 de 6 usadas'), 'Last hour: 3 of 6 used');
eq('rodape do grafico de 24 h', S.translate('5 candidatura(s) nas últimas 24 h (pico de 2 em uma hora) · barra clara = ontem.'), '5 application(s) in the last 24 h (peak of 2 in one hour) · light bar = yesterday.');
eq('motivo do relatorio na dica', S.translate('A página da vaga não oferece botão de candidatura.'), 'The job page offers no apply button.');
eq('linha da fila', S.t('Termo {posicao} de {total}: {rotulo}', { posicao: 2, total: 3, rotulo: '"react"' }), 'Term 2 of 3: "react"');
eq('motivo de pausa dentro da frase', S.t('· pausado por {motivo} até {hora}', { motivo: S.t('cota de candidaturas'), hora: '14:30' }), '· paused by application quota until 14:30');
eq('aviso do arquivo de backup', S.t('Não consegui usar esse arquivo: {motivo}.', { motivo: S.t('o arquivo não é um JSON válido') }), 'Could not use that file: the file is not valid JSON.');
S.setLocale('pt');
const dinamicasI18n = [
  'Configure uma URL do LinkedIn (ex.: https://www.linkedin.com/jobs/search/).',
  'Varredura interrompida.',
  'Nenhuma vaga capturada ainda. Rode a varredura primeiro.',
  'Todas as vagas capturadas foram candidatadas. Nada a relatar.',
  '· {n} candidatura(s) neste termo',
  '· pausado por {motivo} até {hora}',
  '· descansando até {hora}',
  'Última varredura: {quando}',
  'Nesta sessão (termo)',
  'Pausado por',
  'Diagnóstico copiado. Cole no relato do problema (confira antes).',
  'Dados limpos.',
  'Salvando…',
  'A busca roda em loop, um termo por vez, nesta ordem ({n} {unidade}). Passe o mouse sobre cada um para ver a busca.',
];
eq('frases dinamicas seguem traduzidas', dinamicasI18n.filter((f) => !S.UI_EN[f] || S.UI_EN[f] === f), []);
ok('popup tem o seletor de idioma', popupHtml.includes('id="locale"') && popupJs.includes('SHARED.setLocale(settings.locale)'));

// Toggle: ligado/desligado precisam ter cores diferentes nos DOIS temas. O bug
// era o override do tema escuro vencer a regra do ligado por especificidade.
ok('toggle ligado tem cor propria', /#settings \.switch input\[type="checkbox"\]:checked \{\s*\n\s*background: var\(--ok\)/.test(popupHtml));
ok('toggle ligado tem cor propria no tema escuro', /html\[data-theme="dark"\] #settings \.switch input\[type="checkbox"\]:checked \{\s*\n\s*background: #1f9d55/.test(popupHtml));
ok('override do escuro vale so para o desligado', popupHtml.includes('html[data-theme="dark"] #settings .switch input[type="checkbox"]:not(:checked)'));
ok('nao sobrou override do escuro sem :not', (popupHtml.match(/html\[data-theme="dark"\] #settings \.switch input\[type="checkbox"\] \{/g) || []).length === 0);

// Papel do primeiro grupo e do select: o grupo do idioma abre o painel, então
// não pode ter o traço de separação, e o select precisa de ar depois do título.
ok('primeiro grupo nao tem traco de separacao', /\.settings-body > \.group:first-child \{[^}]*border-top: none/.test(popupHtml));
ok('select do grupo tem margem no topo', /#settings \.group > select \{[^}]*margin-top/.test(popupHtml));
ok('popup traduz a tela pelo dicionario', popupJs.includes('function localizeDom') && popupJs.includes('SHARED.syncText(textosOriginais.get(no)') === false && popupJs.includes('SHARED.syncText(atual,') && popupJs.includes('MutationObserver'));
ok('background usa o idioma no tooltip e nas notificacoes', bgJs.includes('SHARED.translate(light.title)') && bgJs.includes('refreshLocale'));

// O miolo do localizeDom (pop-up): o que escrever na tela e o que guardar.
const primeiraEn = S.syncText('Início', null, 'en');
eq('texto novo em en e traduzido', primeiraEn.texto, 'Home');
eq('registro guarda o original em pt', primeiraEn.registro.pt, 'Início');
eq('traduzir de novo nao muda nada', S.syncText('Home', primeiraEn.registro, 'en').texto, 'Home');
eq('voltar para pt devolve o original', S.syncText('Home', primeiraEn.registro, 'pt').texto, 'Início');
eq('texto que o render trocou vira novo original', S.syncText('Configurações', primeiraEn.registro, 'en').texto, 'Settings');
eq('texto com numero tambem passa', S.syncText('128 vagas capturadas', null, 'en').texto, '128 jobs captured');
// Texto cru de nó do DOM, com as quebras de linha do HTML: tem de traduzir igual.
eq(
  'rotulo quebrado em duas linhas traduz',
  S.syncText('\n                Ceder a vez para mim: enquanto eu mexo na página, a automação espera em\n                vez de clicar ou rolar por cima\n              ', null, 'en').texto.trim(),
  'Yield to me: while I use the page, the automation waits instead of clicking or scrolling over me'
);
eq('sem idioma en o texto fica em pt', S.syncText('Início', null, 'pt').texto, 'Início');
eq('texto desconhecido fica como esta', S.syncText('???', null, 'en').texto, '???');
eq('espacos das pontas sobrevivem', S.syncText('\n   Início\n ', null, 'en').texto, '\n   Home\n ');

section('19c. tools/configurar-relato.sh (entregador dos relatos)');

const cp = require('child_process');
const os = require('os');
const net = require('net');
const http = require('http');
const path = require('path');

const SCRIPT_RELATO = 'tools/configurar-relato.sh';
const tmpEnv = path.join(os.tmpdir(), 'pegavaga-env-teste-' + process.pid + '.js');

/** Roda o configurador e devolve { code, out } sem estourar no erro. */
const rodarConfig = (args) => {
  try {
    const out = cp.execFileSync('bash', [SCRIPT_RELATO, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (erro) {
    return {
      code: erro.status == null ? 1 : erro.status,
      out: String(erro.stdout || '') + String(erro.stderr || ''),
    };
  }
};

/** Lê o env.js gerado do jeito que a extensão lê (executando o arquivo). */
const lerEnvGerado = (arquivo) => {
  const caixa = {};
  require('vm').runInNewContext(fs.readFileSync(arquivo, 'utf8'), caixa);
  return caixa.PegaVagaEnv || {};
};

const porta_livre = () =>
  new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });

const esperarPorta = (porta, limiteMs = 6000) =>
  new Promise((resolve) => {
    const inicio = Date.now();
    const tentar = () => {
      const req = http.get(
        { host: '127.0.0.1', port: porta, path: '/ping', timeout: 600 },
        (res) => {
          res.resume();
          resolve(true);
        }
      );
      const desistir = () => {
        req.destroy();
        if (Date.now() - inicio > limiteMs) resolve(false);
        else setTimeout(tentar, 120);
      };
      req.on('error', desistir);
      req.on('timeout', desistir);
    };
    tentar();
  });

/** Sobe o servidor de mentira e espera ele atender. */
const subirServidorFalso = async (modo) => {
  const porta = await porta_livre();
  const processo = cp.spawn(
    process.execPath,
    ['tests/fixtures/servidor-relato.js', modo, String(porta)],
    { cwd: ROOT, stdio: 'ignore' }
  );
  const pronto = await esperarPorta(porta);
  return { porta, processo, pronto };
};

ok('script existe', fs.existsSync(ROOT + SCRIPT_RELATO));
ok('servidor de teste existe', fs.existsSync(ROOT + 'tests/fixtures/servidor-relato.js'));

// O --testar manda um relato de mentira, e o e-mail precisa dizer isso: senão o
// teste chega sem navegador nem configuração e parece que a extensão esqueceu
// de mandar (foi a dúvida real de quem configurou).
const scriptRelato = read(SCRIPT_RELATO);
ok('--testar marca o relato como teste manual', /TESTE MANUAL/.test(scriptRelato));
ok(
  '--testar diz onde vao o navegador e a configuracao',
  /navegador\/sistema\s+operacional/.test(scriptRelato) && /configuração completa/.test(scriptRelato)
);

// O aviso "O Google não verificou este app" é a primeira parede de quem configura
// o entregador: o guia precisa dizer que é esperado, que o "desenvolvedor" da
// tela é o próprio usuário e por onde se sai (Avançado ▸ não seguro ▸ Permitir).
const guiaRelato = read('tools/RELATO.md');
ok(
  'guia explica o aviso do app nao verificado',
  /O Google não verificou este app/.test(guiaRelato) && /Avançado/.test(guiaRelato) && /não seguro/.test(guiaRelato)
);
ok('guia diz que o desenvolvedor citado e o proprio usuario', /é o seu próprio/.test(guiaRelato));
ok('guia diz que a permissao pedida e so enviar e-mail', /script\.send_mail/.test(guiaRelato));
ok('guia oferece a saida sem Google (Web3Forms)', /Web3Forms/.test(guiaRelato));
ok(
  'guia explica por que o teste do editor pode nao chegar',
  /Executou, mas o e-mail não chega/.test(guiaRelato) && /DESTINO/.test(guiaRelato)
);
ok(
  'guia explica o que acontece se clonarem o repositorio',
  /Se alguém clonar o repositório/.test(guiaRelato) && /o próprio/.test(guiaRelato)
);

// O script do Google agora recusa destino de exemplo (o Google aceitava o envio
// e ninguém recebia) e registra a cota em Execuções.
const scriptGoogle = read('tools/relato-apps-script.gs');
ok(
  'script do Google recusa DESTINO de exemplo',
  /function destinoEmBranco/.test(scriptGoogle) && /SEU_EMAIL@EXEMPLO\.COM/.test(scriptGoogle)
);
ok(
  'script do Google mostra a cota do dia',
  /function cota/.test(scriptGoogle) && /getRemainingDailyQuota/.test(scriptGoogle)
);
ok(
  'script do Google tem resumo do entregador',
  /function resumo/.test(scriptGoogle) && /function tokenEmBranco/.test(scriptGoogle)
);
ok(
  'resumo mostra o token sem revela-lo',
  /function mascarar/.test(scriptGoogle) && /substring\(0, 3\)/.test(scriptGoogle)
);
ok(
  'guia manda comecar pelo resumo e avisa que o teste e opcional',
  /resumo\(\)/.test(guiaRelato) && /opcional/.test(guiaRelato)
);
ok(
  'script do Google recusa relato sem destinatario',
  /destinatario nao configurado/.test(scriptGoogle)
);

// O .gs não roda no CI (depende do MailApp), mas dá para garantir que é
// JavaScript válido: um erro de sintaxe ali só apareceria dentro do editor do
// Google, do jeito mais confuso possível.
let gsValido = true;
let gsErro = '';
try {
  new Function(scriptGoogle);
} catch (erro) {
  gsValido = false;
  gsErro = String(erro && erro.message);
}
// Além da sintaxe: rodar o .gs contra um MailApp de mentira. É o que pega erro de
// execução (nome errado, caminho que estoura) sem depender do Google — e prova o
// comportamento que interessa: recusar destino de exemplo e não vazar o token.
const logsGoogle = [];
const enviados = [];
const caixaGoogle = {
  MailApp: {
    sendEmail: (mensagem) => enviados.push(mensagem),
    getRemainingDailyQuota: () => 97,
    getAliases: () => [],
  },
  Logger: { log: (linha) => logsGoogle.push(String(linha)) },
  console: { error: (linha) => logsGoogle.push('ERRO ' + linha) },
  ContentService: { createTextOutput: (texto) => ({ getContent: () => String(texto) }) },
};
let googleRodou = true;
let googleErro = '';
try {
  require('vm').runInNewContext(scriptGoogle, caixaGoogle);
} catch (erro) {
  googleRodou = false;
  googleErro = String(erro && erro.message);
}
ok('script do Google roda num MailApp de mentira', googleRodou, googleErro);

if (googleRodou) {
  // DESTINO ainda no exemplo: o teste tem que RECUSAR, em vez de enviar para o
  // vazio e aparecer como "executado" (o sintoma que confundiu de verdade).
  let recusou = '';
  try {
    caixaGoogle.testeDeEnvio();
  } catch (erro) {
    recusou = String(erro && erro.message);
  }
  ok('testeDeEnvio recusa DESTINO de exemplo', /DESTINO/.test(recusou), recusou);

  // Com o destino preenchido, o envio acontece e o log diz para quem foi.
  logsGoogle.length = 0;
  caixaGoogle.DESTINO = 'quem-recebe@exemplo.com';
  caixaGoogle.testeDeEnvio();
  eq('testeDeEnvio envia uma mensagem', enviados.length, 1);
  eq('testeDeEnvio envia para o DESTINO', enviados[0].to, 'quem-recebe@exemplo.com');
  ok(
    'log do teste mostra destinatario e cota',
    logsGoogle.some((l) => l.includes('quem-recebe@exemplo.com')) && logsGoogle.some((l) => l.includes('97'))
  );

  // O resumo avisa o que está configurado, sem imprimir o token.
  logsGoogle.length = 0;
  caixaGoogle.TOKEN = 'segredo-bem-grande-123';
  caixaGoogle.resumo();
  ok(
    'resumo() imprime destinatario e cota',
    logsGoogle.some((l) => /DESTINO/.test(l)) && logsGoogle.some((l) => /97/.test(l))
  );
  ok(
    'resumo() nao imprime o token',
    logsGoogle.some((l) => /seg\*\*\*/.test(l)) && !logsGoogle.some((l) => l.includes('segredo-bem-grande-123'))
  );

  // doPost: token errado é recusado; relato sem destinatário também.
  eq(
    'doPost recusa token errado',
    caixaGoogle.doPost({ parameter: { token: 'outro', payload: '{}' } }).getContent(),
    'token invalido'
  );

  caixaGoogle.DESTINO = 'SEU_EMAIL@EXEMPLO.COM';
  eq(
    'doPost recusa relato sem destinatario',
    caixaGoogle.doPost({ parameter: { token: 'segredo-bem-grande-123', payload: JSON.stringify({ motivo: 'x' }) } }).getContent(),
    'erro: destinatario nao configurado'
  );

  enviados.length = 0;
  eq(
    'doPost entrega quando o token e o destinatario batem',
    caixaGoogle.doPost({
      parameter: {
        token: 'segredo-bem-grande-123',
        para: 'quem-recebe@exemplo.com',
        payload: JSON.stringify({ id: 'r-1', motivo: 'rajada', erros: [{ at: 'agora', where: 'teste', message: 'oi' }] }),
      },
    }).getContent(),
    'ok'
  );
  eq('doPost mandou uma mensagem', enviados.length, 1);
  ok('assunto do relato cita o motivo', /rajada/.test(enviados[0].subject));
}

// O que garante que o destinatario e o token ficam fora do repositorio: o
// .gitignore (env.js e os zips) e o exemplo com os campos vazios. E a regua
// final: nenhum endpoint de verdade pode existir em arquivo versionado.
const ignorados = read('.gitignore');
ok('env.js fora do git', /^env\.js$/m.test(ignorados));
ok('zips fora do git', /^\*\.zip$/m.test(ignorados));

const exemploEnv = read('env.example.js');
ok(
  'env.example.js nao traz valor nenhum preenchido',
  /reportEmail: ''/.test(exemploEnv) &&
    /reportEndpoint: ''/.test(exemploEnv) &&
    /reportToken: ''/.test(exemploEnv)
);

const arquivosVersionados = [
  'manifest.json',
  'shared.js',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'env.example.js',
  'README.md',
  'PRIVACY.md',
  'LOJA.md',
  'PRE_PUBLICACAO.md',
  'tools/RELATO.md',
  'tools/configurar-relato.sh',
  'tools/relato-apps-script.gs',
  'tools/empacotar.sh',
  'tests/SMOKE_TEST.md',
  'tests/fixtures/servidor-relato.js',
];
const comEndpointDeVerdade = arquivosVersionados.filter((f) =>
  /script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}/.test(read(f))
);
eq('nenhum endpoint real em arquivo versionado', comEndpointDeVerdade, []);

ok(
  'cabecalho do script .gs avisa do app nao verificado',
  /não verificou este app/.test(scriptGoogle)
);

const ajuda = rodarConfig(['--help']);
ok('--help sai limpo', ajuda.code === 0 && /--endpoint/.test(ajuda.out) && /--testar/.test(ajuda.out));

const gravou = rodarConfig([
  '--arquivo', tmpEnv,
  '--email', 'relato.teste@exemplo.com',
  '--endpoint', 'https://exemplo.invalido/exec',
  '--token', 's3nh4-secreta',
  '-q',
]);
eq('grava o env.js (codigo 0)', gravou.code, 0);

const envGerado = lerEnvGerado(tmpEnv);
eq('destino gravado', envGerado.reportEmail, 'relato.teste@exemplo.com');
eq('endpoint gravado', envGerado.reportEndpoint, 'https://exemplo.invalido/exec');
eq('token gravado', envGerado.reportToken, 's3nh4-secreta');

const mostra = rodarConfig(['--arquivo', tmpEnv, '--mostrar']);
ok('--mostrar avisa que o envio esta LIGADO', /LIGADO/.test(mostra.out));
ok('--mostrar nao imprime o token', !mostra.out.includes('s3nh4-secreta') && /\.\.\./.test(mostra.out));

rodarConfig(['--arquivo', tmpEnv, '--token', 'outro-token', '-q']);
const envParcial = lerEnvGerado(tmpEnv);
eq(
  'trocar so o token mantem destino e endpoint',
  [envParcial.reportEmail, envParcial.reportEndpoint, envParcial.reportToken],
  ['relato.teste@exemplo.com', 'https://exemplo.invalido/exec', 'outro-token']
);

ok('endpoint sem https e recusado', rodarConfig(['--arquivo', tmpEnv, '--endpoint', 'ftp://x']).code !== 0);
ok('email sem arroba e recusado', rodarConfig(['--arquivo', tmpEnv, '--email', 'semarroba']).code !== 0);
ok('opcao desconhecida e recusada', rodarConfig(['--foo']).code !== 0);

const tmpVazio = tmpEnv + '.vazio';
rodarConfig(['--arquivo', tmpVazio, '--limpar', '-q']);
const envVazio = lerEnvGerado(tmpVazio);
eq('--limpar zera tudo', [envVazio.reportEmail, envVazio.reportEndpoint, envVazio.reportToken], ['', '', '']);

const semEntregador = rodarConfig(['--arquivo', tmpVazio, '--testar']);
ok('--testar sem endpoint avisa e falha', semEntregador.code !== 0 && /nada para testar/.test(semEntregador.out));

const mostraVazio = rodarConfig(['--arquivo', tmpVazio, '--mostrar']);
ok('--mostrar sem endpoint diz que o envio esta DESLIGADO', /DESLIGADO/.test(mostraVazio.out));

section('21. Janelinha do pedido de ajuda');

const ajudaHtml = read('ajuda.html');
const ajudaJs = read('ajuda.js');
const backgroundJs = read('background.js');

ok('ajuda.html existe e carrega shared.js + ajuda.js', ajudaHtml.indexOf('src="shared.js"') < ajudaHtml.indexOf('src="ajuda.js"'));
ok('ajuda.js usa a mensagem de resposta da janelinha', /AJUDA_RESPOSTA_JANELA/.test(ajudaJs));
ok('janelinha tem os tres botoes (aplicar/manual/pular)', ['aplicar', 'manual', 'pular'].every((id) => ajudaHtml.includes('id="' + id + '"')));
ok('janelinha guarda a posicao', /STORAGE\.pos/.test(ajudaJs));

eq('ajudaId carrega aba e pedido', S.ajudaId(7, 'p1'), 'pegavaga-ajuda:7:p1');
eq('lerAjudaId desfaz o id', S.lerAjudaId('pegavaga-ajuda:7:p1'), { tabId: 7, pedidoId: 'p1' });
eq('lerAjudaId recusa id estranho', S.lerAjudaId('outra:coisa'), null);
eq('lerAjudaId recusa aba nao numerica', S.lerAjudaId('pegavaga-ajuda:x:p1'), null);
eq('lerAjudaId recusa pedido vazio', S.lerAjudaId('pegavaga-ajuda:7:'), null);
eq('lerAjudaId tolera vazio', S.lerAjudaId(''), null);

eq('escolherRotulo prefere o texto exato', S.escolherRotulo(['Sim, com restrições', 'Sim'], 'sim'), 1);
eq('escolherRotulo aceita acento e caixa', S.escolherRotulo(['Não', 'Sim'], 'nao'), 0);
eq('escolherRotulo cai no "contem" quando precisa', S.escolherRotulo(['Sim, com restrições'], 'sim'), 0);
eq('escolherRotulo devolve -1 sem alvo', S.escolherRotulo(['Sim'], ''), -1);
eq('escolherRotulo devolve -1 sem lista', S.escolherRotulo([], 'sim'), -1);
eq('escolherRotulo devolve -1 quando nada casa', S.escolherRotulo(['Talvez'], 'sim'), -1);

eq('medidas da janelinha', [S.JANELINHA.largura, S.JANELINHA.altura], [372, 470]);
// `chrome.windows` (usado na janelinha de ajuda) NÃO pede permissão: criar, mover
// e fechar janelas é livre; a permissão `windows` só serviria para ler a URL/título
// das abas — e permissão a mais pesa na revisão da loja.
ok('nenhuma permissao extra para abrir a janelinha', !manifest.permissions.includes('windows'));
ok('empacotador leva a janelinha', /ajuda\.html/.test(read('tools/empacotar.sh')) && /ajuda\.js/.test(read('tools/empacotar.sh')));

// Não pode existir caminho que abra a janelinha como janela NORMAL: é ela que traz
// barra de endereço e abas (o pedido explícito é "só título e borda").
const trechoJanela = backgroundJs.slice(backgroundJs.indexOf('async function mostrarAjuda'), backgroundJs.indexOf('function fecharJanelaAjuda'));
eq('uma unica criacao de janela', (trechoJanela.match(/windows\.create\(/g) || []).length, 1);
ok('a janela e sempre type popup', /type:\s*'popup'/.test(trechoJanela));
ok('sem fallback para janela normal', !/setSelfAsOpener/.test(trechoJanela));
ok('fecha a janela quando a aba some', /lerAjudaId[\s\S]{0,160}windows\.remove/.test(backgroundJs));

ok('content pede a ajuda na janelinha', /async function pedirAjuda/.test(contentJs) && /AJUDA_PEDIDO/.test(contentJs));
ok('content espera a decisao com prazo e Parar', /function esperarDecisao[\s\S]{0,900}state\.abort/.test(contentJs));
ok('content descreve os campos com as opcoes originais', /function descreverCamposAjuda/.test(contentJs) && /function opcoesDoCampo/.test(contentJs));
ok('content aplica a resposta no campo certo', /async function aplicarRespostaNosCampos/.test(contentJs) && /SHARED\.escolherRotulo/.test(contentJs));
ok('content guarda as respostas para a proxima vaga', /async function salvarRespostas/.test(contentJs));
ok(
  'ajuda tenta a janelinha antes da notificacao',
  contentJs.indexOf('await pedirAjuda(') < contentJs.indexOf('notifyHelp(labels, job.title', contentJs.indexOf('async function askForHelp'))
);
ok('decisao "pular" devolve skip', /decisao\.acao === 'pular'[\s\S]{0,20}return 'skip'/.test(contentJs));
ok(
  'sem escrita no formulario nao finge sucesso',
  /nenhuma resposta do cartão pôde ser escrita/.test(contentJs)
);

eq('janelinha em ingles: aplicar', S.t('Aplicar e continuar', null, 'en'), 'Apply and continue');
eq('janelinha em ingles: pular', S.t('Pular esta vaga', null, 'en'), 'Skip this job');
eq('janelinha em portugues', S.t('Aplicar e continuar', null, 'pt'), 'Aplicar e continuar');

section('20. Espera por evento (assincrono)');
(async () => {
  const sig = S.createSignal();
  eq('waitUntil imediato', await S.waitUntil(sig, () => 42, 100, 0), 42);

  const t0 = Date.now();
  const nulo = await S.waitUntil(S.createSignal(), () => null, 60, 0);
  ok('waitUntil timeout -> null', nulo === null && Date.now() - t0 >= 50);

  await S.waitForQuiet(S.createSignal(), 40).then((quieto) => ok('waitForQuiet true (sem wake)', quieto === true));

  const sigW = S.createSignal();
  const pQuiet = S.waitForQuiet(sigW, 5000);
  setTimeout(() => sigW.wake(), 20);
  ok('waitForQuiet false (com wake)', (await pQuiet) === false);

  const sigA = S.createSignal();
  let flag = false;
  const pA = S.waitUntil(sigA, () => (flag ? 'ok' : null), 5000, 0);
  setTimeout(() => { flag = true; sigA.wake(); }, 20);
  eq('waitUntil acorda no sinal', await pA, 'ok');

  // --testar de ponta a ponta, contra um servidor que imita o Apps Script:
  // o POST volta 302 e a resposta ("ok") vem no endereco de retorno, como no
  // Google. Este teste e o que guarda o `curl -X POST -L` (que entrava em laco).
  const bom = await subirServidorFalso('ok');
  ok('servidor de mentira (entregador bom) subiu', bom.pronto);
  try {
    const arquivoBom = tmpEnv + '.srv';
    rodarConfig(['--arquivo', arquivoBom, '--email', 'a@b.com', '--endpoint', 'http://127.0.0.1:' + bom.porta + '/exec', '--token', 'tk', '-q']);
    const testeBom = rodarConfig(['--arquivo', arquivoBom, '--testar']);
    ok(
      '--testar reconhece o entregador bom',
      testeBom.code === 0 && /OK — o entregador rodou/.test(testeBom.out),
      testeBom.out.trim()
    );
  } finally {
    bom.processo.kill();
  }

  const ruim = await subirServidorFalso('token');
  ok('servidor de mentira (token errado) subiu', ruim.pronto);
  try {
    const arquivoRuim = tmpEnv + '.srv2';
    rodarConfig(['--arquivo', arquivoRuim, '--email', 'a@b.com', '--endpoint', 'http://127.0.0.1:' + ruim.porta + '/exec', '--token', 'outro', '-q']);
    const testeRuim = rodarConfig(['--arquivo', arquivoRuim, '--testar']);
    ok(
      '--testar avisa que o token foi recusado',
      testeRuim.code !== 0 && /recusou o token/.test(testeRuim.out),
      testeRuim.out.trim()
    );
  } finally {
    ruim.processo.kill();
  }

  [tmpEnv, tmpEnv + '.vazio', tmpEnv + '.srv', tmpEnv + '.srv2'].forEach((arquivo) => {
    try { fs.unlinkSync(arquivo); } catch (erro) { /* nada a limpar */ }
  });

  console.log('\n=========================================');
  console.log('RESULTADO: ' + pass + ' passaram, ' + failures.length + ' falharam');
  if (failures.length) {
    console.log('\nFALHAS:');
    failures.forEach((f) => console.log(' - ' + f));
  }
  console.log('=========================================');
  process.exit(failures.length ? 1 : 0);
})();
