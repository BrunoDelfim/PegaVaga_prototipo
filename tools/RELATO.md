# Relatos de erro — como ligar a entrega por e-mail

O relato de erro do PegaVaga tem duas partes independentes:

1. **A extensão monta e guarda o relato** — isso funciona sozinha, sem nada
   externo, e é o que já está no código.
2. **Um entregador manda o e-mail** — esta é a única parte que precisa de um
   serviço. É o que este documento ensina a ligar (leva ~5 minutos, **uma vez**).

> **Se você não ligar nada**, a extensão continua útil: o relato vira uma linha
> **pendente** em *Configurações → Diagnóstico*, com **Copiar** e **Baixar JSON**
> para você mandar do jeito que quiser. Nada sai do navegador.

---

## Qual usar? (recomendação)

| | **Google Apps Script** (recomendado) | **Web3Forms** |
| --- | --- | --- |
| O que você faz | Cola ~120 linhas no Apps Script e pega a URL | Cria conta e pega uma chave |
| Código para colar | O arquivo [`relato-apps-script.gs`](relato-apps-script.gs) já está pronto | Nenhum |
| Conta para o usuário final | ❌ não precisa | ❌ não precisa |
| Servidor seu | ❌ nenhum | ❌ nenhum |
| Custo | Grátis (100 e-mails/dia) | Grátis (cota mensal) |
| Dado passa por | Google | Web3Forms |
| Trocar depois | Editar 1 arquivo (`env.js`) | Idem |

Os dois têm o mesmo efeito e o mesmo preço de política: **no clique do usuário, o
relato sai do navegador** (é o que faz o e-mail chegar). Escolhi o **Apps Script**
como recomendação porque é grátis sem cota mensal apertada, o teto diário vira
uma trava contra abuso da URL e a conta é a **sua** (o usuário final não precisa
de nada).

---

## Opção A — Google Apps Script (passo a passo)

**Acessar:** <https://script.google.com> — entre com a conta Google que vai
**receber** os relatos (pode ser a sua conta normal; não precisa ser Gmail
corporativo).

1. Clique em **Novo projeto**. Vai abrir um editor com `function myFunction() {}`.
2. Apague tudo e **cole o conteúdo de [`tools/relato-apps-script.gs`](relato-apps-script.gs)**.
3. No topo do arquivo, ajuste as duas linhas:
   ```js
   var DESTINO = 'seu-email@gmail.com';        // quem recebe os relatos
   var TOKEN = 'uma-senha-simples-sua';        // será o mesmo no env.js
   ```
4. **Salve** (ícone do disquete). No menu de funções, escolha **testeDeEnvio** e
   clique em **▶ Executar**. O Google vai pedir autorização — é o **seu** script
   pedindo para enviar e-mail em seu nome: autorize. **Você deve receber um
   e-mail de teste.** Se chegou, o entregador está bom.
5. **Implantar** → **Nova implantação** → engrenagem ▸ **App da Web** →
   - *Descrição*: `PegaVaga relatos`
   - *Executar como*: **eu (seu e-mail)**
   - *Quem tem acesso*: **qualquer pessoa**  ← sem isso a extensão não consegue
     postar (ela não tem login no seu Google)
   - Clique em **Implantar** e **copie a URL** que termina em **`/exec`**.
6. No repositório, abra **`env.js`** (está no `.gitignore`, não vai para o Git) e
   preencha:
   ```js
   globalThis.PegaVagaEnv = {
     reportEmail: 'seu-email@gmail.com',
     reportEndpoint: 'https://script.google.com/macros/s/AKfy..../exec',
     reportToken: 'uma-senha-simples-sua',   // igual ao TOKEN do script
   };
   ```
7. **Regere o pacote** (o empacotador avisa se o `env.js` ficar de fora):
   ```bash
   bash tools/empacotar.sh v0.7.18    # ou a versão atual
   ```
   e reinstale a extensão pelo zip (ou apenas **🔄 Atualizar** se você usa a
   pasta carregada sem compactação).

Pronto: o botão **Enviar diagnóstico** (na notificação **e** em Configurações)
passa a mandar o e-mail **em um clique**, sem abrir nenhuma tela para o usuário.

**Se algo não chegar:** no Apps Script, abra **Execuções** (barra lateral) e veja
se o `doPost` registrou erro; e confirme que a implantação está com acesso
**qualquer pessoa**.

---

## Opção B — Web3Forms (sem código)

1. Acesse <https://web3forms.com>, informe o e-mail de destino e receba a
   **access key** por e-mail.
2. No `env.js`:
   ```js
   reportEmail: 'seu-email@gmail.com',
   reportEndpoint: 'https://api.web3forms.com/submit',
   reportToken: 'sua-access-key',
   ```
3. Regenere o pacote e reinstale, como no passo 7 acima.

O Web3Forms usa os campos `access_key`/`subject`/`from_name` — se preferir esse
serviço, me diga que eu ajusto o corpo do POST no `background.js` (é uma linha).

---

## O que fazer junto (publicação)

Como o relato **sai do dispositivo quando o usuário clica em enviar**, duas
coisas mudam junto — e essa é a hora de ajustar:

1. **`PRIVACY.md`**: acrescentar que, **ao clicar em “Enviar diagnóstico”**, o
   conteúdo do relato (versão, configuração, fila e os últimos erros) é enviado
   para o endereço configurado pelo desenvolvedor — e **somente** nesse clique.
2. **Chrome Web Store → Privacy practices → Data usage**: declarar o envio (o
   dado deixa o dispositivo) e explicar na justificativa: *“relatório de erro do
   próprio usuário, enviado apenas quando ele pede, para diagnóstico”*.

Quem **não** configurar o entregador (nenhum `reportEndpoint`) não tem nada
disso: nesse caso nada sai do navegador e a declaração continua “não coleta”.

---

## Segurança (o que isso é e o que não é)

- A URL e o token ficam **dentro da extensão** (qualquer um consegue extrair de um
  CRX). Eles **não são segredo forte** — servem para descartar ruído de quem
  descobrir a URL.
- A proteção real é o **teto de envios** do Google (100/dia) somado ao `TOKEN`.
- O `env.js` **não é versionado**; o `.gitignore` já cuida disso. Se você trocar o
  token, atualize os dois lados (script e `env.js`).
- Se um dia a URL vazar demais: no Apps Script, **Implantar → Gerenciar
  implantações → editar** e gere uma URL nova (o `env.js` muda junto).
