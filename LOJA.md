# PegaVaga — o que colar no painel da Chrome Web Store

Material operacional da publicação: os textos que o painel pede, prontos para
copiar e colar. A política pública (que o painel exige por URL) é o
[`PRIVACY.md`](PRIVACY.md).

## 1. URL da política de privacidade

No campo **Privacy policy URL**, aponte para o arquivo versionado (o repositório é
público, então essa URL abre para qualquer pessoa — e para o revisor da loja):

```
https://github.com/BrunoDelfim/PegaVaga_prototipo/blob/development/PRIVACY.md
```

> Se um dia preferir um endereço mais “bonito”, ligue o **GitHub Pages** no
> repositório e use `https://brunodelfim.github.io/PegaVaga_prototipo/PRIVACY.md`.

## 2. Privacy practices → Single purpose

> Extensão de propósito único: **rastrear as vagas do LinkedIn escolhidas pelo
> usuário e automatizar as candidaturas por Candidatura Simplificada**, guardando
> tudo localmente no navegador e permitindo exportar o resultado para uma
> planilha.

## 3. Privacy practices → Data usage

**Depende de uma escolha sua.** A única coisa que pode sair do dispositivo é o
**relato de erro** — e só quando o usuário clica em *Enviar diagnóstico*:

- **Sem entregador configurado** (sem `env.js`, ou com `reportEndpoint` vazio):
  **não marque nenhuma categoria**. Nada sai do dispositivo.
- **Com o entregador configurado**: marque a categoria que corresponde ao
  conteúdo do relato — ele leva a **configuração da extensão e o log de erros**,
  ou seja, **“User activity”** — e cole esta justificativa:

  > Relatório de erro do próprio usuário, enviado **apenas** quando ele clica em
  > “Enviar diagnóstico”, para diagnóstico e correção de falhas. O conteúdo é a
  > versão da extensão, o navegador, a configuração escolhida e os últimos erros
  > registrados — nunca as vagas capturadas, os links ou o CSV. O usuário pode,
  > em vez de enviar, manter o relatório só no computador dele (copiar ou baixar
  > em JSON), e a política de privacidade descreve os dois caminhos.

As três certificações seguem **verdadeiras** (marque as três): a transferência
para o serviço de e-mail acontece **a pedido do usuário**, só para o fim
declarado, e está descrita na política.

- [x] Não vendo nem transfiro dados de usuário a terceiros, fora dos usos aprovados.
- [x] Não uso nem transfiro dados de usuário para fins não relacionados ao meu
      propósito único.
- [x] Não uso nem transfiro dados de usuário para determinar capacidade de crédito
      ou para empréstimos.

## 4. Justificativa de cada permissão

O painel pede uma justificativa por permissão. Sugestões (todas verdadeiras para o
código atual):

| Permissão | Justificativa sugerida |
| --- | --- |
| `storage` | Guardar **no próprio navegador** a configuração da busca, as cotas, o agendador e as vagas capturadas, que são a base do relatório em CSV. Nada é enviado a servidores. |
| `clipboardWrite` | Copiar o **diagnóstico** (versão, configuração e últimos erros) para a área de transferência **quando o usuário clica no botão**, para colar num relato de problema. A extensão só **escreve**, nunca lê a área de transferência. |
| `unlimitedStorage` | O histórico de vagas, com a descrição de cada uma, passa do teto padrão de ~10 MB do `chrome.storage.local`; sem esta permissão o Chrome passa a recusar as gravações e o histórico se perde. |
| `activeTab` | Falar com a aba ativa do LinkedIn (iniciar/parar a varredura e pular uma vaga) **somente** quando o usuário clica nos botões do pop-up. |
| `alarms` | Agendador: acordar o service worker no horário escolhido pelo usuário e quando uma cota de candidaturas libera. |
| `notifications` | Avisar na área de trabalho quando uma vaga trava num campo que a extensão não sabe preencher e precisa da ajuda do usuário. |
| `https://www.linkedin.com/*` | Injetar o content script nas páginas de vagas do LinkedIn para ler título, empresa, link e descrição e para preencher/enviar a Candidatura Simplificada **na sessão do próprio usuário**. |

## 5. Como as afirmações acima são sustentadas

Não é só promessa: o CI reprova se o código começar a contrariar a política —
`node tests/pegavaga.test.js` tem guardas que falham se aparecer `storage.sync`,
`XMLHttpRequest`, `WebSocket`, `sendBeacon`, script remoto no pop-up ou qualquer
`fetch` que não seja de arquivo da própria extensão.
