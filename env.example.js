/* =============================================================================
 * PegaVaga — configuração de ambiente (EXEMPLO)
 *
 * Copie este arquivo para `env.js` e preencha. O `env.js` está no `.gitignore`
 * (não vai para o repositório) e o `tools/empacotar.sh` o inclui no zip — então
 * o destinatário viaja com a extensão **sem aparecer no Git**.
 *
 * Sem o `env.js` a extensão funciona igual: os relatos ficam **locais** (na
 * lista de Configurações → Diagnóstico, para copiar ou baixar quando quiser).
 * ===========================================================================*/
globalThis.PegaVagaEnv = {
  // Para onde vão os relatos de erro (quem analisa).
  reportEmail: '',

  // Quem entrega o e-mail. Aceita um Web App do Apps Script (`doPost`), o
  // Web3Forms, o Formspree — qualquer endereço que aceite um POST de formulário.
  // Vazio = o "Enviar diagnóstico" guarda o relato como pendente, sem enviar.
  reportEndpoint: '',

  // Token simples que vai no corpo do POST: o endpoint descarta o que não bater
  // (a URL fica dentro da extensão, então isso não é segredo forte — o teto de
  // envios do serviço é a proteção de verdade).
  reportToken: '',
};
