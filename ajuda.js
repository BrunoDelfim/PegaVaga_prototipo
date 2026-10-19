/* =============================================================================
 * PegaVaga - ajuda.js
 *
 * O cartão do pedido de ajuda, numa JANELA POPUP do Chrome (sem aba, sem barra
 * de endereço, sem menu: só barra de título e borda) no desktop.
 *
 * O background abre esta página com `?dados=<json>` — a vaga, o motivo e os
 * CAMPOS travados (`{ rotulo, tipo, opcoes }`). Aqui cada campo vira o controle
 * certo (um <select> com as opções ORIGINAIS do LinkedIn, botões de rádio, uma
 * caixa de confirmação ou um <input>), e a decisão volta para o worker, que a
 * entrega à aba certa e fecha esta janela.
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

  /** Desenha um controle por campo travado; devolve `[{ rotulo, el, tipo }]`. */
  function desenharCampos() {
    const caixa = document.getElementById('campos');
    const controles = [];

    campos.forEach((campo, indice) => {
      const rotulo = String((campo && campo.rotulo) || '').trim();
      if (!rotulo) return;

      const bloco = document.createElement('div');
      bloco.className = 'campo';

      const tipo = String((campo && campo.tipo) || '').toLowerCase();
      const opcoes = Array.isArray(campo && campo.opcoes) ? campo.opcoes.filter(Boolean) : [];
      const id = 'campo-' + indice;

      const label = document.createElement('label');
      label.textContent = rotulo;

      // Todos os campos do cartão vêm de uma pergunta obrigatória do LinkedIn:
      // o asterisco avisa antes do envio (o bloqueio de verdade é no "Aplicar").
      const marca = document.createElement('span');
      marca.className = 'obrigatorio';
      marca.textContent = '*';
      marca.title = t('Obrigatório');
      marca.setAttribute('aria-label', t('Obrigatório'));
      label.appendChild(marca);

      // Rádio/checkbox têm o próprio <label> por opção; o rótulo da pergunta é
      // só texto (apontar `for` para um grupo não associa nada no navegador).
      if (tipo !== 'radio' && tipo !== 'checkbox') label.htmlFor = id;

      if (tipo === 'checkbox') {
        const linha = document.createElement('label');
        linha.className = 'opcao';
        linha.htmlFor = id;

        const el = document.createElement('input');
        el.type = 'checkbox';
        el.id = id;

        const texto = document.createElement('span');
        texto.textContent = t('Marque para confirmar');

        linha.appendChild(el);
        linha.appendChild(texto);
        bloco.appendChild(label);
        bloco.appendChild(linha);
        caixa.appendChild(bloco);

        controles.push({ rotulo: rotulo, el: el, tipo: 'checkbox', bloco: bloco });
        return;
      }

      if (tipo === 'radio' && opcoes.length) {
        const grupo = document.createElement('div');
        grupo.className = 'opcoes';
        grupo.id = id;
        grupo.setAttribute('role', 'radiogroup');

        const itens = [];
        const nome = 'campo-' + indice;

        opcoes.forEach((texto, posicao) => {
          const linha = document.createElement('label');
          linha.className = 'opcao';

          const el = document.createElement('input');
          el.type = 'radio';
          el.name = nome;
          el.value = String(texto);
          el.id = id + '-' + posicao;

          const span = document.createElement('span');
          span.textContent = String(texto);

          linha.htmlFor = el.id;
          linha.appendChild(el);
          linha.appendChild(span);
          grupo.appendChild(linha);
          itens.push(el);
        });

        bloco.appendChild(label);
        bloco.appendChild(grupo);
        caixa.appendChild(bloco);

        controles.push({ rotulo: rotulo, el: grupo, tipo: 'radio', itens: itens, bloco: bloco });
        return;
      }

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
        el.type = tipo === 'numero' ? 'number' : 'text';
        // Lista/rádio sem opções lidas: o usuário digita o texto da opção e a
        // volta casa por texto com a opção original do LinkedIn.
        el.placeholder =
          tipo === 'lista' || tipo === 'radio'
            ? t('Digite a opção como aparece no LinkedIn')
            : t('Sua resposta');
      }

      el.id = id;
      bloco.appendChild(label);
      bloco.appendChild(el);
      caixa.appendChild(bloco);

      // Rádio sem opções lidas vira input de texto: o tipo do CONTROLE passa a
      // ser texto (senão `lerResposta` procuraria `itens` que não existem).
      const tipoControle = tipo === 'radio' && !opcoes.length ? 'texto' : tipo;
      controles.push({ rotulo: rotulo, el: el, tipo: tipoControle, bloco: bloco });
    });

    return controles;
  }

  /* ---- Obrigatórios: não deixa enviar o cartão com campo em branco -------- */

  /** Valor atual de um controle do cartão (`''` quando ainda não há resposta). */
  function valorDoControle(controle) {
    if (!controle || !controle.el) return '';

    if (controle.tipo === 'radio') {
      const marcado = (controle.itens || []).find((item) => item.checked);
      return marcado ? String(marcado.value || '') : '';
    }

    if (controle.tipo === 'checkbox') return controle.el.checked ? t('Sim') : '';

    return String(controle.el.value || '');
  }

  /** Borda + mensagem de campo obrigatório (some assim que o usuário preenche). */
  function marcarInvalido(controle, invalido) {
    if (!controle || !controle.bloco) return;

    controle.bloco.classList.toggle('invalido', invalido);

    if (!controle.erro) {
      const erro = document.createElement('span');
      erro.className = 'erro';
      erro.setAttribute('role', 'alert');
      erro.hidden = true;
      erro.textContent = t('Campo obrigatório.');
      controle.bloco.appendChild(erro);
      controle.erro = erro;
    }

    controle.erro.hidden = !invalido;

    if (controle.el && typeof controle.el.setAttribute === 'function') {
      if (invalido) controle.el.setAttribute('aria-invalid', 'true');
      else controle.el.removeAttribute('aria-invalid');
    }
  }

  /** Some com o aviso geral quando todos os campos estão preenchidos. */
  function limparAvisoSeTudoPreenchido(controles) {
    const falta = controles.some((controle) => !String(valorDoControle(controle) || '').trim());
    if (falta) return;

    const aviso = document.getElementById('aviso');
    if (aviso) {
      aviso.hidden = true;
      aviso.textContent = '';
    }
  }

  /**
   * Valida TODOS os campos do cartão (o LinkedIn trata as perguntas do Easy Apply
   * como obrigatórias). Devolve `false` e foca o primeiro que falta; quem chama
   * só manda a resposta quando isto devolve `true`.
   */
  function validarCampos(controles) {
    const aviso = document.getElementById('aviso');

    if (!controles.length) {
      if (aviso) {
        aviso.textContent = t(
          'Não consegui ler o campo travado. Assuma à mão ou pule esta vaga.'
        );
        aviso.hidden = false;
      }

      return false;
    }

    let primeiro = null;

    controles.forEach((controle) => {
      const invalido = !String(valorDoControle(controle) || '').trim();
      marcarInvalido(controle, invalido);
      if (invalido && !primeiro) primeiro = controle;
    });

    if (primeiro) {
      if (aviso) {
        aviso.textContent = t('Preencha os campos obrigatórios antes de continuar.');
        aviso.hidden = false;
      }

      const alvo = primeiro.tipo === 'radio' ? (primeiro.itens || [])[0] : primeiro.el;
      if (alvo && typeof alvo.focus === 'function') alvo.focus();
      return false;
    }

    if (aviso) {
      aviso.hidden = true;
      aviso.textContent = '';
    }

    return true;
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
        const valor = String(valorDoControle(controle) || '').trim();
        if (valor) resposta[controle.rotulo] = valor; // o rótulo é a chave da reaplicação
      });

      return resposta;
    };

    document.getElementById('aplicar').addEventListener('click', () => {
      // Campo vazio = não manda: o worker devolveria a vaga como "resolvida"
      // sem ter escrito nada, e a automação seguiria com o formulário travado.
      if (!validarCampos(controles)) return;
      responder('aplicar', lerResposta());
    });
    document.getElementById('manual').addEventListener('click', () => responder('manual', null));
    document.getElementById('pular').addEventListener('click', () => responder('pular', null));
    document.getElementById('fechar').addEventListener('click', () => responder('', null));

    // Enter num campo de texto/opção aplica e continua (atalho natural).
    controles.forEach((controle) => {
      const alvos = controle.tipo === 'radio' ? controle.itens || [] : [controle.el];

      alvos.forEach((el) => {
        if (!el || el.tagName === 'SELECT' || el.type === 'checkbox') return;
        el.addEventListener('keydown', (evento) => {
          if (evento.key === 'Enter') {
            evento.preventDefault();
            if (validarCampos(controles)) responder('aplicar', lerResposta());
          }
        });
      });
    });

    // Ao preencher, some a marca daquele campo (e o aviso geral quando tudo
    // estiver preenchido). Os vazios só são marcados quando o usuário tenta
    // enviar — não durante a digitação.
    controles.forEach((controle) => {
      const alvos = controle.tipo === 'radio' ? controle.itens || [] : [controle.el];

      alvos.forEach((el) => {
        if (!el || typeof el.addEventListener !== 'function') return;

        ['input', 'change'].forEach((evento) => {
          el.addEventListener(evento, () => {
            if (String(valorDoControle(controle) || '').trim()) marcarInvalido(controle, false);
            limparAvisoSeTudoPreenchido(controles);
          });
        });
      });
    });

    const primeiro = controles[0];
    if (primeiro) {
      const alvo = primeiro.tipo === 'radio' ? (primeiro.itens || [])[0] : primeiro.el;
      if (alvo) alvo.focus();
    }

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
