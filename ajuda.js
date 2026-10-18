/* =============================================================================
 * PegaVaga - ajuda.js
 *
 * O cartão do pedido de ajuda, numa JANELA POPUP do Chrome (sem aba, sem barra
 * de endereço, sem menu: só barra de título e borda) no desktop.
 *
 * O background abre esta página com `?dados=<json>` — a vaga, o motivo e os
 * CAMPOS travados (`{ rotulo, tipo, opcoes }`). Aqui cada campo vira o controle
 * certo (um <select> com as opções ORIGINAIS do LinkedIn, ou um <input>), e a
 * decisão volta para o worker, que a entrega à aba certa e fecha esta janela.
 * ===========================================================================*/
'use strict';

(function () {
  const SHARED = globalThis.PegaVagaShared;
  const t = SHARED.t;

  const dados = SHARED.parseAjudaDados(typeof location === 'undefined' ? '' : location.search);

  const avisoId = String(dados.avisoId || '');
  const campos = Array.isArray(dados.campos) ? dados.campos : [];

  /** Manda a decisão para o worker (que fecha esta janela ao processar). */
  function responder(acao, resposta) {
    chrome.runtime
      .sendMessage({
        type: SHARED.MSG.AJUDA_RESPOSTA_JANELA,
        avisoId: avisoId,
        acao: acao,
        resposta: resposta,
      })
      .catch(() => {});

    // Sem resposta (worker dormindo?), fecha sozinha para não ficar órfã.
    setTimeout(() => window.close(), 400);
  }

  /** Textos fixos, no idioma da interface (o mesmo do pop-up). */
  function rotular() {
    const titulo = t('PegaVaga precisa de você');

    document.title = titulo;
    document.getElementById('titulo').textContent = titulo;
    document.getElementById('fechar').title = t('Fechar (a vaga segue o caminho de sempre)');
    document.getElementById('msg').textContent = t(
      'Responda os campos abaixo (com as opções originais do LinkedIn) e a extensão preenche e segue sozinha.'
    );
    document.getElementById('aplicar').textContent = t('Aplicar e continuar');
    document.getElementById('manual').textContent = t('Vou preencher à mão');
    document.getElementById('pular').textContent = t('Pular esta vaga');
  }

  /** Desenha um controle por campo travado; devolve `[{ rotulo, el }]`. */
  function desenharCampos() {
    const caixa = document.getElementById('campos');
    const controles = [];

    campos.forEach((campo) => {
      const rotulo = String((campo && campo.rotulo) || '').trim();
      if (!rotulo) return;

      const bloco = document.createElement('div');
      bloco.className = 'campo';

      const label = document.createElement('label');
      const id = 'campo-' + controles.length;
      label.textContent = rotulo;
      label.htmlFor = id;

      const opcoes = Array.isArray(campo.opcoes) ? campo.opcoes.filter(Boolean) : [];
      let el;

      if (opcoes.length) {
        // As opções ORIGINAIS do LinkedIn: o valor volta como texto e é ele que
        // o content script casa com a opção certa na hora de escrever.
        el = document.createElement('select');
        const vazio = document.createElement('option');
        vazio.value = '';
        vazio.textContent = t('Escolha uma opção');
        el.appendChild(vazio);

        opcoes.forEach((texto) => {
          const opcao = document.createElement('option');
          opcao.value = String(texto);
          opcao.textContent = String(texto);
          el.appendChild(opcao);
        });
      } else {
        el = document.createElement('input');
        el.type = campo.tipo === 'numero' ? 'number' : 'text';
        el.placeholder = t('Sua resposta');
      }

      el.id = id;
      bloco.appendChild(label);
      bloco.appendChild(el);
      caixa.appendChild(bloco);

      controles.push({ rotulo: rotulo, el: el });
    });

    return controles;
  }

  /* A posição da janela é decidida por quem conhece o monitor da aba: o content
   * script calcula (mesmo monitor da vaga) e o worker repassa no `windows.create`.
   * Aqui só guardamos onde ela foi deixada, ao arrastar — assim a próxima já abre
   * onde você trabalha. */


  /** Guarda onde a janela ficou (para a próxima abrir já no mesmo lugar). */
  function guardarPosicao(left, top) {
    chrome.storage.local
      .set({ [SHARED.STORAGE.pos]: { left: Math.round(left), top: Math.round(top) } })
      .catch(() => {});
  }

  /** Arrasta a janela pelo cabeçalho (é uma janela do sistema, não um iframe). */
  function permitirArrastar() {
    const cabeca = document.getElementById('cabeca');
    let arrastando = false;
    let deslocX = 0;
    let deslocY = 0;

    cabeca.addEventListener('mousedown', (evento) => {
      if (evento.target && evento.target.id === 'fechar') return;
      arrastando = true;
      deslocX = evento.screenX - window.screenX;
      deslocY = evento.screenY - window.screenY;
      evento.preventDefault();
    });

    document.addEventListener('mousemove', (evento) => {
      if (!arrastando) return;
      try {
        window.moveTo(Math.round(evento.screenX - deslocX), Math.round(evento.screenY - deslocY));
      } catch (error) {
        /* alguns gerenciadores de janela não deixam mover: segue onde está */
      }
    });

    document.addEventListener('mouseup', () => {
      if (!arrastando) return;
      arrastando = false;
      guardarPosicao(window.screenX, window.screenY);
    });
  }

  /** Resolve a promessa ou desiste no prazo (storage lento não trava o cartão). */
  function comPrazo(promessa, ms, padrao) {
    return new Promise((resolve) => {
      let pronto = false;

      const fim = (valor) => {
        if (pronto) return;
        pronto = true;
        clearTimeout(timer);
        resolve(valor);
      };

      const timer = setTimeout(() => fim(padrao), ms);
      Promise.resolve(promessa).then(fim, () => fim(padrao));
    });
  }

  async function iniciar() {
    // Idioma: a mesma configuração do pop-up (o cartão é texto de interface).
    // Idioma: a mesma configuração do pop-up — mas com prazo. Um storage lento
    // não pode deixar o cartão sem desenhar (e sem os botões ligados).
    const data = await comPrazo(chrome.storage.local.get(SHARED.STORAGE.settings), 2000, null);

    try {
      SHARED.setLocale(SHARED.parseSettings(data && data[SHARED.STORAGE.settings]).locale);
    } catch (error) {
      /* sem configuração: fica no idioma do navegador */
    }

    rotular();

    const vaga = [dados.titulo, dados.empresa].filter(Boolean).join(' — ');
    if (vaga) {
      const elVaga = document.getElementById('vaga');
      elVaga.textContent = vaga;
      elVaga.hidden = false;
    }

    // Desenhar os campos não pode impedir os botões de funcionar: se o HTML do
    // formulário vier estranho, o cartão ainda serve para "à mão" e "pular".
    let controles = [];
    try {
      controles = desenharCampos();
    } catch (error) {
      console.error('[PegaVaga] não desenhei os campos do cartão:', error);
    }

    if (!controles.length) {
      document.getElementById('msg').textContent = t(
        'Não consegui ler o campo travado. Assuma à mão ou pule esta vaga.'
      );
    }

    const lerResposta = () => {
      const resposta = {};
      controles.forEach((controle) => {
        const valor = String((controle.el && controle.el.value) || '').trim();
        if (valor) resposta[controle.rotulo] = valor; // o rótulo é a chave da reaplicação
      });
      return resposta;
    };

    document.getElementById('aplicar').addEventListener('click', () => responder('aplicar', lerResposta()));
    document.getElementById('manual').addEventListener('click', () => responder('manual', null));
    document.getElementById('pular').addEventListener('click', () => responder('pular', null));
    document.getElementById('fechar').addEventListener('click', () => responder('', null));

    // Enter num campo de texto aplica e continua (atalho natural).
    controles.forEach((controle) => {
      if (!controle.el || controle.el.tagName === 'SELECT') return;
      controle.el.addEventListener('keydown', (evento) => {
        if (evento.key === 'Enter') {
          evento.preventDefault();
          responder('aplicar', lerResposta());
        }
      });
    });

    if (controles.length && controles[0].el) controles[0].el.focus();

    permitirArrastar();
  }

  iniciar().catch((error) => {
    // Cartão morto é pior que cartão feio: conta o que houve na tela e deixa os
    // caminhos "à mão"/"pular" à mão do usuário (o worker também tem a notificação).
    console.error('[PegaVaga] cartão de ajuda falhou:', error);

    const msg = document.getElementById('msg');
    if (msg) msg.textContent = t('Não consegui montar o cartão aqui. Assuma à mão ou pule esta vaga.');
  });
})();
