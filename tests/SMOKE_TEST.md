# PegaVaga — Roteiro de teste manual (smoke test)

O teste automatizado (`node tests/pegavaga.test.js`) cobre a lógica pura e a
consistência entre os arquivos. O que depende do **navegador + LinkedIn** precisa
ser conferido na mão. Use este roteiro depois de qualquer mudança relevante.

## Preparação

1. `chrome://extensions` → **PegaVaga** → **🔄 Atualizar** (confira a versão).
2. Dê **F5** em todas as abas do LinkedIn abertas (o `content.js` é injetado no
   carregamento da página).
3. Abra o **console da página** (F12) e o **console do service worker**
   (`chrome://extensions` → PegaVaga → “service worker”). Os logs `[PegaVaga] …`
   ajudam a localizar problemas.

## Smoke test rápido (~5 min)

- [ ] Carregue a extensão sem erros em `chrome://extensions` (sem “Erros” no
      cartão do PegaVaga).
- [ ] Abra o popup: aparece o **⚙ Configurações**, o contador e os botões.
- [ ] Preencha **URL de busca** (`https://www.linkedin.com/jobs/search/`) e os
      **termos** (`react, node.js`) → a **fila numerada** aparece embaixo.
- [ ] Clique em **▶ Iniciar Busca e Varredura** → a aba do LinkedIn abre/navega
      e o contador de **vagas capturadas** sobe.
- [ ] **■ Parar Varredura** interrompe.

## Por recurso

### A. Busca e fila de termos
- [ ] Cada termo vira **uma busca própria** (`keywords=…` na URL).
- [ ] **Localização** entra como `location=…` na URL.
- [ ] Termos vazios/repetidos são descartados; o limite de 40 é respeitado.
- [ ] **Sem termos**: varre a página de vagas que estiver aberta.

### B. Filtro “Somente vagas com Candidatura Simplificada”
- [ ] Ligado, a URL da busca sai com **`f_AL=true`** (confira na barra de
      endereços ou no *title* do termo, na fila).
- [ ] Desligado, o `f_AL` **não** aparece.
- [ ] Sem termos e já numa página de vagas, com o filtro ligado a extensão
      **navega** para a URL filtrada (não usa a página aberta).

### C. Captura de vagas
- [ ] Ao passar pelos cards, título/empresa/link/descrição são capturados.
- [ ] Fechar e reabrir o popup **não** perde as vagas (persistem no storage).
- [ ] O CSV (**⬇ Exportar para Excel**) abre no Excel com acentos corretos.

### D. Candidatura automática (Candidatura Simplificada)
- [ ] Vaga com **Candidatura Simplificada**: o formulário abre, as perguntas
      obrigatórias são respondidas (Sim/1) e a candidatura é **enviada**.
- [ ] Vaga **externa** (site da empresa): **não clica**, registra
      `Externa (site da empresa)` com o motivo.
- [ ] Popups pós-candidatura (avaliação/pesquisa/salvar vaga) são **fechados**.

### E. Já candidatada antes
- [ ] Numa vaga em que você já se candidatou, o status fica
      **`Já candidatada antes`** (não “Sem botão”).
- [ ] O resumo mostra **“N já candidatada(s) antes”**.
- [ ] No console da página aparece `[PegaVaga] Vaga já candidatada antes…`.

### F. Pedir ajuda (vaga travada em campo personalizado)
- [ ] Ao travar num campo que a extensão não sabe responder, aparece a
      **notificação na área de trabalho** (“PegaVaga precisa de ajuda…”).
- [ ] O popup mostra a faixa **“✋ PegaVaga precisa de ajuda”** e a **luz fica
      vermelha**.
- [ ] Botão **“Preencher manualmente”** na notificação **traz a aba do LinkedIn
      para frente**.
- [ ] Preenchendo o campo na tela, o LinkedIn reabilita o botão e a extensão
      **retoma sozinha**.
- [ ] Botão **“Pular vaga”** (na notificação) e **“⏭ Pular vaga travada”**
      (no popup) **cancelam a vaga atual e avançam**.
- [ ] Com a opção **desligada**, o comportamento antigo volta (descarta e segue).

### G. Cotas
- [ ] Configurar **Por hora = 1** e ver a execução **pausar** ao estourar, com
      retomada automática quando a cota libera.
- [ ] **Por termo**: ao atingir, passa para o **próximo termo**.
- [ ] **Por dia = 0** significa **sem limite**.
- [ ] A linha de cotas do popup bate com o que está acontecendo.

### H. Agendador
- [ ] Ligado com uma janela que **já está aberta** → inicia sozinho.
- [ ] Fora da janela → **não** varre e a fila fica pausada.
- [ ] Janela que **cruza a meia-noite** (ex.: `22:00 → 06:00`) funciona.
- [ ] “Trazer a aba para frente” foca a aba ao (re)iniciar.

### I. Proteção da conta (guard)
- [ ] Se o LinkedIn mostrar **checkpoint/verificação/limite**, a extensão
      **para tudo** e a luz fica **vermelha** com o aviso no topo do popup.
- [ ] O agendador **não** reinicia enquanto o descanso durar (~1 h).

### J. Exportação
- [ ] **⬇ Exportar para Excel (CSV)**: todas as vagas, com status e motivo.
- [ ] **⚠ Exportar não candidatadas (CSV)**: só as que não foram candidatadas;
      as `Já candidatada antes` **ficam de fora**.
- [ ] Botão desabilitado quando não há o que exportar.

### K. Luz de status (ícone + cabeçalho)
- [ ] **Verde** capturando · **Amarela** pronta/pausada · **Vermelha** atenção
      (guard, problema de página ou “precisa de ajuda”).
- [ ] O tooltip do ícone explica o estado atual.

### L. Furtividade
- [ ] Enquanto você usa a página (mouse/teclado/rolagem), a automação **espera**
      em vez de clicar por cima.
- [ ] Pausas longas acontecem de tempos em tempos (configurável).

## Como reportar um problema

Anote sempre:

1. **Versão** (`chrome://extensions` ou `manifest.json`).
2. **O que estava fazendo** e **o que esperava**.
3. **Logs** com `[PegaVaga]` — console da página **e** console do service worker.
4. Se possível, o **termo/campo exato** que aparece na tela do LinkedIn (ex.:
   “Candidatou-se em …”) — ajuda a ajustar os detectores.

