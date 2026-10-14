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

section('1. Exports do shared.js');
require(ROOT + 'shared.js');
const S = globalThis.PegaVagaShared;
ok('PegaVagaShared existe', Boolean(S));
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
const smoke = read('tests/SMOKE_TEST.md');
ok('smoke test cita a interface nova', ['Início', 'Configurações', 'lâmpada', 'donut', 'toast'].every((t) => smoke.includes(t)));
ok('smoke test cita os avisos do app', smoke.includes('conta e risco') && smoke.includes('Descartei'));

// Privacidade: estas checagens sustentam o que a PRIVACY.md afirma.
const allSrc = ['shared.js', 'background.js', 'content.js', 'popup.js'].map(read).join('\n');
ok('sem storage.sync (nada vai para a conta Google)', !/storage\.sync/.test(allSrc));
ok('sem XMLHttpRequest/WebSocket/sendBeacon', !/XMLHttpRequest|WebSocket|sendBeacon/.test(allSrc));
ok('fetch so de arquivo da propria extensao', (allSrc.match(/fetch\([^)]*\)/g) || []).every((c) => c.includes('chrome.runtime.getURL')));
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
eq('apply.enabled false respeitado', S.parseSettings({ apply: { enabled: false } }).apply.enabled, false);
eq('easyApplyOnly false respeitado', S.parseSettings({ easyApplyOnly: false }).easyApplyOnly, false);
eq('fillRequired true respeitado', S.parseSettings({ apply: { fillRequired: true } }).apply.fillRequired, true);
const clamp = S.parseSettings({ apply: { minDelayMs: 999999, maxDelayMs: 1, readMinMs: 99999, readMaxMs: 1, perTerm: 9999, answerNumber: 999 } });
ok('delay min<=max', clamp.apply.minDelayMs <= clamp.apply.maxDelayMs);
ok('read min<=max', clamp.apply.readMinMs <= clamp.apply.readMaxMs);
eq('perTerm clampado', clamp.apply.perTerm, 500);
eq('answerNumber clampado', clamp.apply.answerNumber, 200);
eq('answers normalizadas', S.parseSettings({ apply: { answers: { '  ': 'x', q: '', k: ' v ' } } }).apply.answers, { k: 'v' });
eq('terms do texto', S.parseSettings({ terms: 'a, b' }).terms, ['a', 'b']);
eq('helpOnStuck false respeitado', S.parseSettings({ apply: { helpOnStuck: false } }).apply.helpOnStuck, false);

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

section('17. Espera por evento (assincrono)');
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

  console.log('\n=========================================');
  console.log('RESULTADO: ' + pass + ' passaram, ' + failures.length + ' falharam');
  if (failures.length) {
    console.log('\nFALHAS:');
    failures.forEach((f) => console.log(' - ' + f));
  }
  console.log('=========================================');
  process.exit(failures.length ? 1 : 0);
})();
