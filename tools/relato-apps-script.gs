/**
 * PegaVaga — entregador de relatos de erro (Google Apps Script)
 * =============================================================================
 *
 * O que é: um pedaço de código que roda no Google (de graça, sem servidor seu)
 * e que recebe o relato que a extensão manda e **reenvia por e-mail** para você.
 *
 * Como usar (leva ~5 minutos, uma vez):
 *
 *   1. Abra https://script.google.com logado na conta que vai RECEBER os
 *      relatos → **Novo projeto**.
 *   2. Apague o conteúdo do editor e cole este arquivo inteiro.
 *   3. Ajuste as duas constantes abaixo: `DESTINO` (seu e-mail) e `TOKEN`
 *      (uma senha simples, sua — a mesma que vai no `env.js`).
 *   4. Salve, escolha a função **testeDeEnvio** no menu e clique em **Executar**.
 *      O Google vai pedir autorização (é o seu próprio script pedindo para
 *      enviar e-mail em seu nome) → autorize. Você deve receber um e-mail de
 *      teste. Se chegar, o entregador está funcionando.
 *   5. **Implantar** → **Nova implantação** → tipo **App da Web** →
 *      *Executar como*: **eu** · *Quem tem acesso*: **qualquer pessoa** →
 *      **Implantar**. Copie a URL que termina em `/exec`.
 *   6. No repositório do PegaVaga, abra o `env.js` e preencha:
 *        reportEmail: 'seu-email@gmail.com',
 *        reportEndpoint: 'https://script.google.com/macros/s/...../exec',
 *        reportToken: 'a mesma senha do TOKEN acima',
 *   7. Reponha a extensão (o `tools/empacotar.sh` inclui o `env.js` no zip).
 *      A partir daí o botão **Enviar diagnóstico** manda o relato em um clique,
 *      sem abrir nada para o usuário.
 *
 * Detalhes honestos:
 *   - Limite do Google para contas comuns: **100 e-mails por dia** (sobra muito,
 *     e funciona como trava contra abuso da URL).
 *   - A URL e o token viajam dentro da extensão, então não são segredo forte:
 *     o que protege é o teto acima + o `TOKEN` (que descarta ruído de quem
 *     descobrir a URL).
 *   - Quando o botão é clicado, o relato **sai do navegador** (é isso que faz o
 *     e-mail chegar). Isso precisa estar declarado na política de privacidade e
 *     no formulário de *Data usage* da Chrome Web Store.
 * ===========================================================================*/

/* ----------------------------- ajuste estas 2 ----------------------------- */
var DESTINO = 'SEU_EMAIL@EXEMPLO.COM'; // quem recebe os relatos
var TOKEN = 'troque-por-uma-senha-sua'; // o mesmo valor no env.js do PegaVaga
/* ------------------------------------------------------------------------- */

/**
 * Recebe o POST da extensão e dispara o e-mail.
 * Aceita corpo de formulário (`token`, `para`, `payload`) e corpo JSON.
 */
function doPost(e) {
  try {
    var entrada = lerEntrada(e);

    if (TOKEN && entrada.token !== TOKEN) {
      return ContentService.createTextOutput('token invalido');
    }

    var relato = entrada.relato || {};
    var para = String(entrada.para || relato.email || DESTINO).trim();

    MailApp.sendEmail({
      to: para,
      subject: montarAssunto(relato),
      body: montarCorpo(relato),
    });

    return ContentService.createTextOutput('ok');
  } catch (erro) {
    // O erro aparece no histórico de execuções (menu ▸ Execuções).
    console.error('Falha no relato do PegaVaga: ' + erro);
    return ContentService.createTextOutput('erro: ' + erro);
  }
}

/** Lê o que a extensão mandou, seja formulário ou JSON. */
function lerEntrada(e) {
  var param = (e && e.parameter) || {};

  if (param.payload) {
    return { token: param.token, para: param.para, relato: JSON.parse(param.payload) };
  }

  var texto = (e && e.postData && e.postData.contents) || '{}';
  var dados = JSON.parse(texto);

  return {
    token: dados.token,
    para: dados.para,
    relato: dados.relato || dados,
  };
}

function montarAssunto(relato) {
  var motivo = (relato && relato.motivo) || 'sem motivo informado';
  var quando = (relato && relato.quando) || new Date().toLocaleString('pt-BR');

  return 'PegaVaga — relato de erro (' + motivo + ') — ' + quando;
}

function montarCorpo(relato) {
  var r = relato || {};
  var linhas = [];

  linhas.push('Relato de erro do PegaVaga');
  linhas.push('Motivo: ' + (r.motivo || '—'));
  linhas.push('Quando: ' + (r.quando || '—'));
  linhas.push('Relato: ' + (r.id || '—'));
  linhas.push('');
  linhas.push('--- diagnóstico (texto) ---');
  linhas.push(r.diagnostico || '(sem diagnóstico)');
  linhas.push('');
  linhas.push('--- erros registrados ---');

  var erros = r.erros || [];

  for (var i = 0; i < erros.length; i++) {
    var item = erros[i] || {};
    linhas.push('- ' + (item.at || '?') + ' · ' + (item.where || '?') + ': ' + (item.message || ''));
  }

  if (!erros.length) linhas.push('(nenhum)');

  linhas.push('');
  linhas.push('--- JSON cru (para reprocessar) ---');
  linhas.push(JSON.stringify(r, null, 2));

  return linhas.join('\n');
}

/**
 * Teste manual: rode esta função no editor (menu ▸ Executar) para conferir se o
 * e-mail chega. Ela manda um relato de exemplo — e é o que valida o passo 4.
 */
function testeDeEnvio() {
  MailApp.sendEmail({
    to: DESTINO,
    subject: 'PegaVaga — teste do entregador de relatos',
    body:
      'Se você está lendo isto, o entregador está funcionando.\n\n' +
      'Agora falta só implantar como App da Web (Implantar ▸ Nova implantação ▸ ' +
      'App da Web) e copiar a URL /exec para o env.js do PegaVaga.',
  });
}
