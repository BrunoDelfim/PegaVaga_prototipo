# PegaVaga — Checklist pré-publicação

Plano de trabalho para sair da beta e publicar na **Chrome Web Store**.
Cada item diz **por quê** e **como fazer**; ao concluir, troque `[ ]` por `[x]` e
preencha a linha **Feito em** com a versão e o commit.

**Progresso:** 12 de 14 itens · **Versão:** a que está no `manifest.json`

Legenda: `[ ]` pendente · `[x]` feito · `[~]` parcial

---

## 🔴 Bloqueadores (fazer antes de publicar)

- [x] **1. Risco de estourar o `chrome.storage.local`**
  `pegavaga_jobs` guarda a **descrição completa** de cada vaga e **não tem teto**
  (há limite só para os apps). O `storage.local` tem ~10 MB: com ~2–3 mil vagas
  longas, o Chrome passa a **rejeitar gravações — em silêncio**, porque os erros
  caem em `.catch(() => {})`.
  *Como:* truncar a descrição (ex.: 2.000 caracteres) **e/ou** teto de vagas
  (ex.: 5.000, descartando as mais antigas com aviso) **e/ou** a permissão
  `unlimitedStorage`.
  *Feito em:* `0.7.2` (commit `ced7d36`) — foram os **três** caminhos, com a
  regra isolada numa função pura (`SHARED.trimJobs`, 13 testes novos):
  `unlimitedStorage` no manifest; descrição cortada em `DESC_MAX_CHARS` (6.000
  caracteres) e teto de `MAX_JOBS` (5.000 vagas), em que as capturadas há mais
  tempo saem. O total descartado vai para `pegavaga_meta.dropped` e o pop-up
  avisa no card **Início** (“descartei N vagas antigas…”). Os tetos são aplicados
  no `persist()`, antes de cada gravação — o mapa inteiro é reescrito sempre, por
  isso o teto também protege a velocidade. O contador zera junto com as vagas no
  **Limpar** (`0.7.3`), senão o aviso apareceria num banco vazio.

- [x] **2. Política de privacidade + declaração de uso de dados**
  A Chrome Web Store exige a política **e** o preenchimento do formulário de
  “Data usage”. O texto é simples: tudo fica em `chrome.storage.local` do
  próprio navegador; nada é enviado para servidor nenhum.
  *Como:* criar `PRIVACY.md` e linkar no item da loja.
  *Feito em:* `0.7.4` (commit `5231400`, documentação — sem bump) —
  [`PRIVACY.md`](PRIVACY.md) é a política pública (pt-BR + resumo em inglês) e
  [`LOJA.md`](LOJA.md) é a cola do painel: **URL da política**, **propósito
  único**, respostas do formulário de **Data usage** (nenhuma categoria marcada —
  a loja só considera “coletado” o que sai do dispositivo — e as três
  certificações) e a **justificativa de cada permissão**.
  *Antes de escrever, conferi o código:* não há `storage.sync`, `XMLHttpRequest`,
  `WebSocket`, `sendBeacon`, script remoto nem URL externa além do próprio
  `linkedin.com`; o único `fetch` é de um ícone da extensão. **Sete guardas
  novos** no teste transformam isso em CI: se alguém introduzir qualquer um
  desses, o teste falha (conferi que os guardas reprovam de verdade, com exemplos
  violando).

- [x] **3. Aviso de risco/beta dentro da extensão**
  O README tem o aviso (“área cinzenta do LinkedIn; use por sua conta e risco”),
  mas quem instala pela loja não lê o README.
  *Como:* incluir um aviso curto no card **“Como funciona”** (aba Início).
  *Feito em:* `0.7.4` (commit `6ea0976`) — caixa âmbar no fim do card **Como
  funciona**: o risco (área cinzenta dos termos de uso, conta pode ser
  limitada), que a extensão **está em beta**, a sugestão de começar com cotas
  baixas e que **não há vínculo com o LinkedIn**. A cor reaproveita os tokens
  `--warn`/`--warn-soft`, que já existiam nos dois temas (nada de cor solta no
  CSS). Um teste estático guarda o texto e a classe, para o aviso não sumir numa
  refatoração. O README ganhou a nota de que o aviso também está no app.

- [ ] **4. Material da loja**
  Descrição curta e longa, **screenshots** (640×400), tile promocional
  **440×280** e o ícone 128 (já existe em `icons/pg-128.png`).
  ⚠ Achado ao fazer o item 10: a **descrição do `manifest.json` tem 305
  caracteres** e a loja pede **até 132** (“A string of no more than 132
  characters”, docs de *Prepare your extension*) — encurtar aqui (o
  `tools/empacotar.sh` avisa enquanto isso). A descrição longa vai no campo da
  loja, não no manifest.
  *Feito em:* —

- [ ] **5. Teste em perfil limpo (smoke test completo)**
  Abrir um perfil novo do Chrome, instalar a extensão e percorrer o
  `tests/SMOKE_TEST.md` inteiro (nada de dados antigos escondendo problema).
  *Feito em:* —

## 🟠 Fortes (antes ou logo depois de publicar)

- [x] **6. CI no GitHub Actions**
  Rodar `node tests/pegavaga.test.js` a cada push (o teste já sai com código 1
  quando falha). Protege de regressão sem ninguém precisar lembrar.
  *Como:* `.github/workflows/testes.yml` com `node-version: 20`.
  *Feito em:* `0.7.4` (commit `cda8e02`) — workflow **Testes** rodando em **push
  (qualquer branch)**, **pull request** e **manual** (`workflow_dispatch`): faz
  `node --check` nos quatro scripts e depois `node tests/pegavaga.test.js`. Não
  tem `npm install` (o projeto não tem dependências), então a execução é rápida e
  não precisa de cache. Selo de status no topo do README. **A versão não subiu:**
  é infraestrutura, não muda nada da extensão.

- [x] **7. Botão “copiar diagnóstico”**
  Sem isso, reportar bug é chato. Hoje há **24 `catch` silenciosos** no
  `content.js`, então o erro desaparece sem deixar rastro.
  *Como:* guardar os erros num buffer (últimos ~50), somar versão + configuração
  e copiar para a área de transferência.
  *Feito em:* `0.7.6` (commits `28923ca` e `19733de`, tag **`v0.7.6`**) — o
  `content.js` ganhou
  **`noteError(onde, erro)`**: cada `catch` registra **hora + trecho + mensagem**
  num buffer de **50** (`SHARED.ERROR_KEEP`), gravado em `pegavaga_errors` (junto
  da gravação das vagas e, sozinho, quando o erro vem da própria gravação — sem
  laço). Dos **34 `catch`**, **32 registram**; os **2 que ficam mudos** (avisar o
  pop-up fechado e navegador sem captura passiva) são casos **normais e
  previsíveis**, com o motivo escrito no código — e um **teste reprova se
  aparecer catch mudo novo**. O pop-up ganhou **Configurações → Diagnóstico →
  “Copiar diagnóstico”**: `SHARED.buildDiagnostics()` (função pura, com 14
  verificações) monta versão, navegador, configuração, fila, bloqueio, modo
  simulação, tema e os últimos erros; a cópia usa `navigator.clipboard` **com
  queda para o `textarea` clássico**, e o texto avisa que ele traz a sua
  configuração (para conferir antes de colar em público).
  *Achado no caminho:* a lista de permissões do Chrome diz que
  **`clipboardWrite` é necessária** para o `document.execCommand('copy')` (o plano
  B da cópia). Sem ela o botão poderia nascer quebrado no navegador — então a
  permissão entrou (`19733de`), com a justificativa no `LOJA.md` e na tabela do
  README, e o **bump extra para `0.7.6`**: a `0.7.5` saiu sem ela, e tag
  publicada não se move.

- [x] **8. Modo simulação (dry-run)**
  Varre e preenche o formulário, mas **não clica em enviar**. Deixa a primeira
  experiência segura (e é um bom argumento na descrição da loja).
  *Como:* opção em Candidaturas; no `runApplyFlow`, parar antes do envio.
  *Feito em:* `0.7.6` (commit `28923ca`, tag **`v0.7.6`**) — interruptor **“Modo simulação”** nas
  Candidaturas, **desligado por padrão** (de propósito: não muda o comportamento
  de quem já usa — quem quer a primeira vez segura liga o interruptor, e o item 4
  pode citar isso na descrição da loja). No `runApplyFlow`, quando o próximo
  passo seria o **envio** (`action.kind === 'submit'`), o dry-run **fecha o
  formulário e sai com `simulada`**: nada é clicado, o rascunho continua salvo no
  LinkedIn e o novo desfecho **`Simulada (não enviada)`** entra no
  relatório/donut como não candidatada, **com motivo próprio no CSV**. A
  **cota não é consumida** (só `enviada` empurra para o histórico — confirmei que
  o `state.apps.push` está dentro desse ramo, com teste) e a barra da fila avisa
  **“modo simulação (não envio)”**.

- [x] **9. Backup/restauração da configuração**
  Hoje, limpar ou reinstalar perde tudo. Exportar/importar um JSON resolve.
  *Feito em:* `0.7.7` (commit `6441de6`, tag **`v0.7.7`**) — **Configurações →
  Backup da configuração**, com duas funções **puras** no `shared.js`:
  `buildSettingsBackup()` monta o JSON (com `app`/`version`/`exportedAt` e a
  configuração **incluindo as respostas do formulário** — é o que dói mais
  perder) e `parseSettingsBackup()` lê o arquivo, aceita tanto o JSON gerado como
  uma configuração “crua”, e **passa tudo pelo `parseSettings`** (número fora de
  faixa vira o padrão, termo repetido é limpo).
  *Decisão importante:* o parser **recusa JSON que não é do PegaVaga** — sem isso,
  escolher o arquivo errado restauraria os padrões e apagaria a configuração de
  verdade. A restauração também é **em dois tempos** (escolher o arquivo só mostra
  versão e data e pede confirmação; o botão **Restaurar agora** é que grava), o
  que evita apagar por engano — e usei **confirmação inline em vez de `confirm()`**,
  porque diálogo nativo pode fechar o pop-up. As vagas continuam saindo pelo CSV.

- [x] **10. Empacotamento (zip + tag/release)**
  Script para gerar o `.zip` de publicação (fora `tests/`, `.git`, `.md`) e uma
  **tag** no git (ex.: `v0.7.0`).
  *Feito em:* `0.7.4` (commit `fdf9efa`, tag **`v0.7.4`**) — `tools/empacotar.sh`
  gera `dist/pegavaga-0.7.4.zip` (96 KB, 9 arquivos) usando `git archive`, então
  **não depende de `zip` instalado** e só entra o que está versionado + na lista
  explícita. Três cuidados embutidos: (1) roda os testes antes e **não empacota
  se falharem**; (2) confere que o `manifest.json` ficou **na raiz** do zip — a
  loja não aceita dentro de pasta; (3) avisa se a versão do `HEAD` divergir da
  tag ou se a descrição do manifest passar de 132 caracteres (ela passa, ver item
  4). Testado com tag válida, `HEAD` e ref inexistente.

## 🟢 Polimento (depois que a base estiver no ar)

- [x] **11. Badge no ícone com as candidaturas do dia**
  O ícone já tem a luzinha de status; o badge mostraria o total do dia.
  *Feito em:* `0.7.9` (commit `766618f`, tag **`v0.7.9`**) — o badge mostra o
  **total de candidaturas de hoje**, e some quando o dia está zerado (o ícone
  fica só com a luz). Duas funções **puras** no `shared.js`:
  `countAppsToday()` (dia local) e `badgeText()` (vazio ou `99+`).
  *Detalhes que valem nota:* no caminho normal a luz vai **desenhada no próprio
  logo**, então o badge estava livre para o número; no **plano B sem
  `OffscreenCanvas`** é o badge que carrega a luz — ali ele passou a carregar os
  dois (a **cor** segue dizendo o status e o **número** entra por cima), em vez de
  perder o recado. Um **teste** me pegou uma semântica errada: carimbo no
  **futuro** (relógio torto) contava como “de hoje” — corrigi com limite superior.
  E um **alarme que se remarca sozinho na virada do dia** zera o contador, para o
  ícone não amanhecer com o número de ontem. Modo simulação não conta (nada foi
  enviado).

- [x] **12. Notificação ao terminar a varredura**
  Hoje só existe a notificação de “preciso de ajuda”. Avisar quando a fila
  termina é útil para quem deixa rodando em segundo plano.
  *Feito em:* `0.7.8` (commit `8333ea0`, tag **`v0.7.8`**) — o `content.js` manda
  **`MSG.DONE`** no fim da fila (antes de limpar a fila, que é de onde o resumo
  vem) e também quando o **guard** derruba a varredura. O texto sai de
  **`SHARED.describeRunEnd()`** (função pura, com 13 verificações), não do
  service worker: “128 vagas capturadas · 9 candidaturas enviadas” — e no **modo
  simulação** diz “formulários preenchidos sem enviar”, para o resumo não
  parecer que falhou.
  *Dois cuidados que valem nota:* o aviso é **suprimido quando a página está em
  foco** (`document.hasFocus()`), porque aí a notificação só repetiria o que você
  já está vendo; e a de **parada por proteção** usa `requireInteraction`, ficando
  na tela até ser vista (as outras somem sozinhas). Clicar traz a aba do LinkedIn
  para frente — extraí `focusTabId()`, que agora serve também ao pedido de ajuda.
  Interruptor **“Avisar quando a varredura terminar”** nas Candidaturas, **ligado
  por padrão**.

- [x] **13. Atualizar o `tests/SMOKE_TEST.md`**
  Incluir o que mudou: abas (Início/Configurações), lâmpada (tema), card “Vagas
  por termo”, tooltips/destaques dos gráficos e o toast.
  *Feito em:* `0.7.4` (commit `caee973`, documentação — sem bump) — o roteiro foi
  reorganizado e passou de **46 para 69 conferências**: entra a **interface**
  (abas, lâmpada com persistência do tema e modo “segue o sistema”, chip com o
  **azul** novo, toast, estado vazio), os **gráficos** (donut com legenda e
  destaque cruzado, tooltips em fatias e barras, cotas, “Vagas por termo”, as 24 h
  com ontem mais claro) e os **avisos** (risco/beta e o descarte do item 1, com o
  truque de console para forçar o contador sem capturar 5.000 vagas). Rótulos
  atualizados para os botões de hoje e o fim ganhou o passo de **testar o zip**
  empacotado — é o que fecha o caminho `roteiro → tag → zip → instalar`.

- [x] **14. i18n (pt/en)**
  O código já reconhece rótulos em português e inglês; falta a interface.
  *Feito em:* `0.7.10` (commit `977397a`, tag **`v0.7.10`**) — **Configurações →
  Idioma** (Automático / Português / English) traduz o **pop-up inteiro**, o
  **tooltip do ícone** e as **notificações**.
  *A escolha de projeto que fez a diferença:* o dicionário é **pt → en com a chave
  sendo o próprio texto em português** (o idioma de origem). Com isso o pop-up
  **não precisou de marcação nenhuma** no HTML — o `localizeDom()` traduz a tela
  de uma vez, inclusive **textos com números** (`128 vagas capturadas` →
  `128 jobs captured`), porque chaves com marcadores viram padrões. E **texto sem
  tradução aparece em português**, nunca como `undefined`.
  *Guardas:* um teste **reprova texto novo no pop-up sem tradução** (cobertura
  conferida no CI: hoje **0 textos** e **0 atributos** fora do dicionário), outro
  exige que os **marcadores batam** nos dois idiomas, e o miolo do `localizeDom`
  ficou numa **função pura** (`syncText`, testada com texto recém-escrito pelo
  render, ida e volta de idioma e idempotência).
  *Fica em português de propósito:* o **CSV** e o **diagnóstico** — são arquivos de
  dados, e traduzir a planilha mudaria o formato de quem já usa (o próprio aviso
  do grupo diz isso ao usuário).
  *Complemento em* `0.7.11` (commit `HASH_B`): faltavam as **frases montadas em
  código** (títulos do card de execução, “Última varredura: …”, toasts de
  diagnóstico/limpeza/backup, rodapé da fila de termos, faixa de ajuda). A
  cobertura conferida pelo teste olhava só o HTML; entrei com uma **lista de
  regressão** das frases dinâmicas — se alguém apagar uma tradução do dicionário,
  o teste reprova.

---

## Ordem sugerida

**Pacote mínimo para publicar:** `1 → 3 → 6 → 10 → 13` (risco de storage, aviso
no app, CI, empacotamento/tag e checklist atualizado).

**Se der, incluir o `8` (dry-run)** — é o que mais reduz surpresa no primeiro uso.

**Depois:** o `4` (material da loja) fica mais fácil quando os recursos
estiverem congelados, e `11`, `12`, `14` são tranquilamente pós-publicação.

---

## Registro

| Data | Item | Versão | Commit |
| --- | --- | --- | --- |
| 13/10/2026 | Checklist criado | `0.6.9` | — |
| 13/10/2026 | 1. Teto de armazenamento | `0.7.2`–`0.7.3` | `ced7d36` |
| 13/10/2026 | 3. Aviso de risco no app | `0.7.4` | `6ea0976` |
| 13/10/2026 | 6. CI no GitHub Actions | — (infra) | `cda8e02` |
| 13/10/2026 | 10. Empacotamento (zip + tag `v0.7.4`) | `0.7.4` | `fdf9efa` |
| 13/10/2026 | 13. Roteiro de smoke test | — (docs) | `caee973` |
| 13/10/2026 | 2. Política de privacidade | — (docs) | `5231400` |
| 13/10/2026 | 7. Copiar diagnóstico e 8. Modo simulação | `0.7.6` | `28923ca`, `19733de` |
| 13/10/2026 | 9. Backup da configuração em JSON | `0.7.7` | `6441de6` |
| 13/10/2026 | 12. Notificação de fim de varredura | `0.7.8` | `8333ea0` |
| 13/10/2026 | 11. Badge com as candidaturas do dia | `0.7.9` | `766618f` |
| 13/10/2026 | 14. Interface em inglês (i18n pt/en) | `0.7.10` | `977397a` |

