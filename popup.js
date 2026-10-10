/* =============================================================================
 * PegaVaga - popup.js
 * Interface do usuário: dispara a varredura no content.js, mostra o contador
 * de vagas e gera/baixa o relatório .csv (compatível com Excel).
 * ===========================================================================*/

'use strict';

/* -------------------------------------------------------------------------- */
/* Constantes compartilhadas com o content.js                                  */
/* -------------------------------------------------------------------------- */

const STORAGE_JOBS_KEY = 'pegavaga_jobs';
const STORAGE_META_KEY = 'pegavaga_meta';

const MSG = {
  START: 'PEGAVAGA_START',
  STOP: 'PEGAVAGA_STOP',
  PING: 'PEGAVAGA_PING',
  CLEAR: 'PEGAVAGA_CLEAR',
  PROGRESS: 'PEGAVAGA_PROGRESS',
};

const CSV_HEADERS = ['ID', 'Titulo', 'Empresa', 'Link', 'Descricao', 'Capturado em'];
const CSV_SEPARATOR = ';'; // Excel pt-BR usa ponto e vírgula como separador padrão

/* -------------------------------------------------------------------------- */
/* Elementos da interface                                                      */
/* -------------------------------------------------------------------------- */

const els = {};

document.addEventListener('DOMContentLoaded', init);

async function init() {
  cacheElements();
  bindEvents();

  await refresh();
  await syncScanningState();

  chrome.runtime.onMessage.addListener(onRuntimeMessage);
  chrome.storage.onChanged.addListener(onStorageChanged);
}

function cacheElements() {
  els.count = document.getElementById('count');
  els.lastRun = document.getElementById('last-run');
  els.status = document.getElementById('status');
  els.btnStart = document.getElementById('btn-start');
  els.btnStop = document.getElementById('btn-stop');
  els.btnExport = document.getElementById('btn-export');
  els.btnClear = document.getElementById('btn-clear');
}

function bindEvents() {
  els.btnStart.addEventListener('click', onStartClick);
  els.btnStop.addEventListener('click', onStopClick);
  els.btnExport.addEventListener('click', onExportClick);
  els.btnClear.addEventListener('click', onClearClick);
}

/* -------------------------------------------------------------------------- */
/* Ações                                                                       */
/* -------------------------------------------------------------------------- */

async function onStartClick() {
  const tab = await getActiveTab();

  if (!tab || !tab.id) {
    setStatus('Nenhuma aba ativa encontrada.', 'error');
    return;
  }

  // tab.url só existe se a extensão tiver acesso à aba; avisamos apenas quando
  // sabemos com certeza que a página não é do LinkedIn.
  if (tab.url && !tab.url.includes('linkedin.com')) {
    setStatus('Abra uma página de vagas do LinkedIn (/jobs/search/) primeiro.', 'warn');
    return;
  }

  try {
    const response = await sendToTab(tab.id, { type: MSG.START });

    if (!response || response.ok === false) {
      setStatus(
        response && response.reason === 'already_scanning'
          ? 'A varredura já está em andamento.'
          : 'Não foi possível iniciar a varredura.',
        'warn'
      );
      return;
    }

    setScanning(true);
    setStatus('Varredura em andamento. Role a página para carregar mais vagas.', 'ok');
  } catch (error) {
    setStatus(
      'Não foi possível conversar com a página. Recarregue o LinkedIn (F5) e tente novamente.',
      'error'
    );
  }
}

async function onStopClick() {
  const tab = await getActiveTab();
  if (tab && tab.id) {
    try {
      await sendToTab(tab.id, { type: MSG.STOP });
    } catch (error) {
      /* a página pode ter sido fechada; ignoramos */
    }
  }
  setScanning(false);
  setStatus('Varredura interrompida.', 'warn');
}

async function onClearClick() {
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
  setStatus('Dados limpos.', 'ok');
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

/* -------------------------------------------------------------------------- */
/* Render                                                                      */
/* -------------------------------------------------------------------------- */

async function refresh() {
  const jobs = await getJobsArray();
  const meta = await getMeta();

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
}

/** Pergunta ao content script se uma varredura está em andamento. */
async function syncScanningState() {
  const tab = await getActiveTab();
  if (!tab || !tab.id) {
    setScanning(false);
    return;
  }

  try {
    const response = await sendToTab(tab.id, { type: MSG.PING });
    setScanning(Boolean(response && response.scanning));
  } catch (error) {
    setScanning(false);
  }
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
  if (message && message.type === MSG.PROGRESS) {
    els.count.textContent = String(message.count || 0);
    setScanning(Boolean(message.scanning));
  }
}

function onStorageChanged(changes, areaName) {
  if (areaName === 'local' && changes[STORAGE_JOBS_KEY]) {
    refresh();
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
