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
  let arrastou = false; // o usuário já moveu a janela? então não reposiciona mais

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

  /* ---- Tema: o mesmo do pop-up principal -------------------------------- */

  /** O sistema está em modo escuro? (só vale quando não há escolha salva) */
  function sistemaEscuro() {
    try {
      return Boolean(
        window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Aplica o tema no `<html>`: o ajuda.html tem os MESMOS tokens e o bloco
   * `html[data-theme="dark"]` do pop-up principal. `null`/desconhecido segue o
   * sistema, como a lâmpada faz quando nunca foi escolhida.
   */
  function aplicarTema(valor) {
    const escuro = valor === 'dark' || (valor !== 'light' && sistemaEscuro());
    document.documentElement.setAttribute('data-theme', escuro ? 'dark' : 'light');
  }

  /** A lâmpada do pop-up principal pode mudar com o cartão aberto. */
  function observarTema() {
    try {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'local' || !changes[SHARED.STORAGE.theme]) return;
        aplicarTema(changes[SHARED.STORAGE.theme].newValue);
      });
    } catch (error) {
      console.info('[PegaVaga] cartão sem observador de tema:', error);
    }
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
    let inicioX = 0;
    let inicioY = 0;

    cabeca.addEventListener('mousedown', (evento) => {
      if (evento.target && evento.target.id === 'fechar') return;
      arrastou = true;
      arrastando = true;
      inicioX = window.screenX;
      inicioY = window.screenY;
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

      // Só grava se a janela realmente saiu do lugar: um clique no cabeçalho
      // (para focar) não pode salvar a posição centralizada que o WM escolheu.
      if (
        Math.abs(window.screenX - inicioX) >= 4 ||
        Math.abs(window.screenY - inicioY) >= 4
      ) {
        guardarPosicao(window.screenX, window.screenY);
      }
    });
  }

  /** Espera curta (o WM pode só aplicar a posição depois de mapear a janela). */
  function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

  /** Posição de reserva: canto inferior direito do monitor que o cartão enxerga. */
  function posicaoDeReserva() {
    const tela = window.screen || {};
    const esquerda = Number.isFinite(tela.availLeft) ? tela.availLeft : 0;
    const topo = Number.isFinite(tela.availTop) ? tela.availTop : 0;
    const direita = esquerda + (tela.availWidth || 1280);
    const base = topo + (tela.availHeight || 800);

    return {
      left: Math.round(direita - SHARED.JANELINHA.largura - 16),
      top: Math.round(base - SHARED.JANELINHA.altura - 16),
    };
  }

  /**
   * A janela nasce com `SHARED.JANELINHA.altura` (para o worker posicioná-la),
   * mas o tamanho definitivo é o do conteúdo:
   *  - encolhe até caber (sem altura mínima fixa);
   *  - para no **teto** `alturaMax` (o tamanho de antes, 470) e deixa o `.corpo`
   *    rolar; nunca fica maior que isso;
   *  - reaplica a posição calculada no content script (B1), porque o
   *    `windows.create` ignora `left/top` em Wayland/alguns WMs;
   *  - pede foco de novo (a janela pode nascer atrás de tudo);
   *  - sobe o suficiente se o crescimento passaria do rodapé do monitor.
   *
   * Roda uma vez no primeiro render e mais duas com atraso (o WM pode
   * reposicionar a janela depois de mapeá-la). Se o usuário já arrastou, as
   * chamadas seguintes não mexem mais na posição.
   */
  async function ajustarJanela(opcoes) {
    if (!chrome.windows || typeof chrome.windows.update !== 'function') return;

    let janela = null;
    try {
      janela = await chrome.windows.getCurrent();
    } catch (error) {
      console.info('[PegaVaga] cartão não leu a janela para ajustar:', error);
      return;
    }

    if (!janela || janela.id == null) return;

    // Mede o conteúdo com o cartão em altura automática: com a janela no
    // tamanho antigo, `scrollHeight` devolveria o tamanho da janela, não o do
    // conteúdo.
    const cartao = document.getElementById('cartao');
    const corpo = document.querySelector('.corpo');
    const alturaAntes = cartao ? cartao.style.height : '';
    const flexAntes = corpo ? corpo.style.flex : '';
    let natural = 0;

    try {
      if (cartao) cartao.style.height = 'auto';
      if (corpo) corpo.style.flex = '0 0 auto';
      natural = Math.ceil((cartao && cartao.getBoundingClientRect().height) || 0);
    } catch (error) {
      console.info('[PegaVaga] cartão não mediu o conteúdo:', error);
    } finally {
      if (cartao) cartao.style.height = alturaAntes;
      if (corpo) corpo.style.flex = flexAntes;
    }

    if (!natural) natural = SHARED.JANELINHA.altura;

    // `windows.update({height})` conta a moldura da janela; a medição do DOM é
    // só o conteúdo. Sem somar a moldura, o cartão abriria com uma barra de
    // rolagem sobrando mesmo quando tudo caberia.
    const alturaJanela = Number(janela.height) || Number(window.outerHeight) || 0;
    const alturaConteudo =
      Number(window.innerHeight) || document.documentElement.clientHeight || 0;
    const moldura = Math.max(0, Math.round(alturaJanela - alturaConteudo));

    const tela = window.screen || {};
    const topoTela = Number.isFinite(tela.availTop) ? tela.availTop : 0;
    const alturaTela = Number.isFinite(tela.availHeight) ? tela.availHeight : 800;
    // Teto = o tamanho antigo da janela (470). Só encolhe se o conteúdo couber.
    const teto = SHARED.JANELINHA.alturaMax || SHARED.JANELINHA.altura;
    const maximo = Math.max(180, Math.min(teto, alturaTela - 24));
    const altura = Math.min(natural + moldura, maximo);

    // A posição do content script manda; se ela não veio, cai no canto do
    // monitor que o cartão enxerga (melhor que abrir centralizado).
    const alvo = (dados && dados.posicao) || posicaoDeReserva();
    const temPosicao = Boolean(
      alvo && Number.isFinite(alvo.left) && Number.isFinite(alvo.top)
    );
    const usarPosicao = temPosicao && !arrastou;

    let left = usarPosicao ? Math.round(alvo.left) : janela.left;
    let top = usarPosicao ? Math.round(alvo.top) : janela.top;

    if (Number.isFinite(top) && top + altura > topoTela + alturaTela - 8) {
      top = Math.max(topoTela, topoTela + alturaTela - altura - 8);
    }

    const atualizacao = { height: altura, focused: true };
    if (usarPosicao) atualizacao.state = 'normal';
    if (Number.isFinite(left)) atualizacao.left = Math.round(left);
    if (Number.isFinite(top)) atualizacao.top = Math.round(top);

    // Alguns WMs aplicam o `update` tarde, ou só depois de a janela sair de
    // maximizada. Repetimos e conferimos a posição REAL até ela casar; se o
    // gerenciador ignorar de vez, isso fica registrado (não é falha silenciosa).
    let aplicou = !usarPosicao;
    let ultimoErro = null;

    for (let tentativa = 0; tentativa < (usarPosicao ? 5 : 1); tentativa += 1) {
      try {
        // `state: 'normal'` separado: no mesmo update, alguns WMs descartam
        // left/top enquanto a janela ainda está saindo de maximizada.
        if (usarPosicao && tentativa === 0) {
          await chrome.windows.update(janela.id, { state: 'normal' });
        }

        await chrome.windows.update(janela.id, atualizacao);

        // Reforço no próprio documento: em alguns WMs o `windows.update` é
        // ignorado, mas `moveTo`/`resizeTo` (o mesmo caminho que o arrasto usa)
        // vale. Se o WM recusar, seguimos com o que o `update` conseguiu.
        try {
          if (Number.isFinite(left) && Number.isFinite(top)) {
            window.moveTo(Math.round(left), Math.round(top));
          }
          window.resizeTo(SHARED.JANELINHA.largura, altura);
        } catch (error) {
          /* alguns WMs não deixam a página mover a própria janela */
        }

        if (!usarPosicao) {
          aplicou = true;
        } else {
          const agora = await chrome.windows.getCurrent();
          const realLeft = Number(agora && agora.left);
          const realTop = Number(agora && agora.top);

          aplicou =
            !Number.isFinite(realLeft) ||
            !Number.isFinite(realTop) ||
            (Math.abs(realLeft - Math.round(left)) <= 24 &&
              Math.abs(realTop - Math.round(top)) <= 24);
        }

        if (aplicou) break;
      } catch (error) {
        ultimoErro = error;
        break;
      }

      await esperar(250 + tentativa * 250);
    }

    // Reforço para o caso de a janela ter nascido atrás do navegador.
    try {
      window.focus();
    } catch (error) {
      /* alguns WMs não deixam a página focar a própria janela */
    }

    if (!(opcoes && opcoes.silencioso)) {
      console.info(
        '[PegaVaga] cartão reposicionado em',
        atualizacao.left != null ? atualizacao.left : '?',
        atualizacao.top != null ? atualizacao.top : '?',
        'com altura',
        altura
      );

      // Confere o que o WM realmente aplicou (se ele centralizou, o log mostra).
      try {
        const depois = await chrome.windows.getCurrent();
        console.info(
          '[PegaVaga] cartão agora em',
          depois && depois.left,
          depois && depois.top,
          'altura',
          depois && depois.height
        );
      } catch (error) {
        /* sem leitura agora: o update já foi pedido */
      }
    }

    if (!aplicou && !(opcoes && opcoes.silencioso)) {
      console.warn(
        '[PegaVaga] o gerenciador de janelas ignorou a posição pedida; o cartão pode abrir centralizado.',
        ultimoErro || ''
      );
    }
  }

  async function iniciar() {
    // Idioma e tema vêm da mesma configuração do pop-up. O tema é lido junto e
    // com prazo: storage lento não pode deixar o cartão no tema errado nem sem
    // desenhar.
    const data = await comPrazo(
      chrome.storage.local.get([SHARED.STORAGE.settings, SHARED.STORAGE.theme]),
      2000,
      null
    );

    aplicarTema(data && data[SHARED.STORAGE.theme]);
    observarTema();

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

    // Typeahead sem notificação disponível: este cartão é só um painel de
    // "preencher na página" / "pular" — não há campo para responder aqui.
    if (dados.motivo === 'typeahead') {
      document.getElementById('msg').textContent = t(
        'Este campo é de sugestão (como localização): preencha na página e escolha a sugestão do LinkedIn, ou pule a vaga.'
      );
      const aplicar = document.getElementById('aplicar');
      if (aplicar) aplicar.hidden = true;
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

    // Depois do primeiro render: posição do content script (B1) + altura do
    // conteúdo (com teto para rolar). O gerenciador de janelas pode reposicionar
    // a janela ao mapeá-la; repetimos depois de um respiro. Se o usuário já
    // arrastou, as repetições não mexem na posição.
    await ajustarJanela();
    setTimeout(() => {
      ajustarJanela({ silencioso: true }).catch(() => {});
    }, 500);
    setTimeout(() => {
      ajustarJanela({ silencioso: true }).catch(() => {});
    }, 1500);
  }

  iniciar().catch((error) => {
    // Cartão morto é pior que cartão feio: conta o que houve na tela e deixa os
    // caminhos "à mão"/"pular" à mão do usuário (o worker também tem a notificação).
    console.error('[PegaVaga] cartão de ajuda falhou:', error);

    const msg = document.getElementById('msg');
    if (msg) msg.textContent = t('Não consegui montar o cartão aqui. Assuma à mão ou pule esta vaga.');
  });
})();
