# PegaVaga — Roteiro de teste manual (smoke test)

O teste automatizado (`node tests/pegavaga.test.js`) cobre a lógica pura e a
consistência entre os arquivos. O que depende do **navegador + LinkedIn** precisa
ser conferido na mão: use este roteiro depois de qualquer mudança relevante e
**inteiro, num perfil limpo**, antes de publicar (item 5 do
[`PRE_PUBLICACAO.md`](../PRE_PUBLICACAO.md)).

Marque `[x]` no que passar. Se algo falhar, veja **Como reportar um problema** no
fim — e não siga adiante antes de entender a falha.

## Preparação

1. `chrome://extensions` → **PegaVaga** → **🔄 Atualizar**. Confira a **versão** no
   cartão: tem de bater com o `manifest.json` (e com a tag, se você gerou o zip).
2. Dê **F5** em todas as abas do LinkedIn abertas (o `content.js` é injetado no
   carregamento da página).
3. Abra o **console da página** (F12) e o **console do service worker**
   (`chrome://extensions` → PegaVaga → “service worker”). Os logs `[PegaVaga] …`
   ajudam a localizar problemas.
4. Para testar num **perfil limpo**: Modo do desenvolvedor → **Carregar sem
   compactação** e comece da extensão vazia (sem dados antigos escondendo problema).

## Smoke test rápido (~5 min)

- [ ] Carrega sem erro em `chrome://extensions` (sem “Erros” no cartão).
- [ ] O popup abre com o **cabeçalho azul**, a **lâmpada**, o **chip de status**
      (“Pronta”, bolinha **azul**) e as abas **Início** / **Configurações**.
- [ ] Aba **Início**: donut com o total no centro (`0 vagas`), a ilustração do
      estado vazio e o card **Como funciona** terminando no **aviso de risco**.
- [ ] Aba **Configurações**, ainda vazia, clique em **Iniciar** → aparece
      **“Preencha os campos obrigatórios: Localização · Termos de vaga.”**, os
      campos ficam **marcados em vermelho** e a aba de Configurações abre. Confira
      também que os **dois interruptores de Candidatura Simplificada** estão
      **ligados e desativados**.
- [ ] Preencha a **localização** (`São Paulo`) e os **termos** (`react, node.js`) →
      a **fila numerada** aparece embaixo do campo e o vermelho sai quando você
      digita.
- [ ] **Iniciar** (barra fixa embaixo) → o LinkedIn abre/navega, as vagas são
      capturadas (o número no donut sobe) e o toast confirma a ação.
- [ ] **Parar** interrompe **na hora** — inclusive no meio de uma pausa de
      “leitura” da vaga ou de uma etapa do formulário (não espera a espera atual
      terminar).
- [ ] **Parar com outra aba ativa** também funciona: mude de aba, clique em
      **Parar** e volte para a do LinkedIn — ela para sem continuar varrendo.
- [ ] Se estiver em **English**, confira que **nada** do painel ficou em português
      (seção T).

## Por recurso

### A. Interface e tema
- [ ] **Abas**: **Início** e **Configurações** trocam de painel; a aba ativa fica
      destacada e a rolagem volta para o topo ao trocar.
- [ ] **Lâmpada**: no tema **claro** ela fica **acesa** (bulbo amarelo com brilho) e
      o tooltip diz “Mudar para o tema escuro”; ao clicar, o popup vai para o
      **escuro**, a lâmpada **apaga** e o tooltip passa a “Mudar para o tema claro”.
- [ ] A escolha do tema **persiste**: feche e reabra o popup.
- [ ] Sem escolha salva, o popup **segue o tema do sistema** (troque o tema do
      sistema com o popup fechado e reabra).
- [ ] Nos dois temas o contraste está bom: textos legíveis, cabeçalho com degradê
      próprio, nada “sumindo” (confira também o aviso âmbar do item C).
- [ ] Nos **interruptores** das Configurações, ligado e desligado se distinguem
      **nos dois temas**: trilho **verde** com a bolinha à direita quando ligado,
      trilho cinza com a bolinha à esquerda quando desligado (era o bug: no tema
      escuro os dois ficavam iguais).
- [ ] **Chip de status** (cabeçalho): **verde** capturando · **azul** pronta ·
      **vermelha** quando precisa de atenção; o texto acompanha o estado.
- [ ] **Toast** (faixa da barra de baixo): aparece nas ações (iniciar, parar,
      pular, exportar, limpar) e some sozinho — verde/ok, âmbar/aviso, vermelho/erro.
- [ ] **Estado vazio**: com 0 vagas aparece “Ainda não capturei nenhuma vaga…”;
      some assim que entra a primeira.
- [ ] **Primeiro clique** nos botões (Iniciar/Parar/Pular/Exportar/Limpar):
      funciona de primeira; o pop-up **não fecha** antes de a ação rodar. Ele só
      fecha depois, quando a ação abre/foca outra janela ou quando você clica fora.
- [ ] **Fecha ao perder o foco**: com o pop-up aberto, clique fora dele (na página,
      na barra do Chrome, em outro programa) → ele **fecha**.
      *Obs.: com o **Inspecionar** (DevTools) aberto no pop-up, o Chrome costuma
      segurá-lo — é comportamento do navegador, não da extensão.*
- [ ] O **seletor de arquivo** da restauração (Configurações → Backup) continua
      funcionando: escolher o arquivo **mantém** o pop-up aberto com o aviso de
      confirmação, e cancelar também não fecha nada.

### B. Gráficos e resumo
- [ ] **Donut** (Início): fatias de candidatadas / já candidatadas / falharam / na
      fila, com o **total no centro**. Sem vagas, o anel fica vazio.
- [ ] **Legenda** ao lado: passe o mouse num item → a fatia correspondente
      **acende**; os números batem com o donut.
- [ ] **Tooltips**: passe o mouse nas fatias do donut, nas barras de cota, nas
      barras de “Vagas por termo” e nas barras de 24 h → aparece o balão com a
      explicação daquele pedaço, e ele **some** ao sair com o mouse.
- [ ] **Cotas** (card abaixo do resumo): barras do usado/limite de **hora**,
      **24 h**, **dia** e **termo**, batendo com a execução em andamento.
- [ ] **Vagas por termo**: uma barra por termo de busca (total, com as candidatadas
      destacadas); vaga sem termo identificado entra como `sem termo`.
- [ ] **24 h**: o card “Candidaturas nas últimas 24 h” traz uma barra por hora, com
      as de **ontem mais claras** que as de hoje; embaixo, o total e o **pico de uma
      hora**. Sem candidatura nas últimas 24 h, o card **não aparece**.
- [ ] Com o popup **aberto**, os gráficos acompanham a varredura (sem fechar/abrir).
### C. Avisos do app
- [ ] **Risco/beta** (fim do card **Como funciona**): caixa âmbar com “Use por sua
      conta e risco”, o aviso de **beta**, a sugestão de **cotas baixas** e a
      ausência de vínculo com o LinkedIn. Legível nos **dois temas**.
- [ ] **Descarte por falta de espaço**: com o banco cheio (5.000 vagas) o card
      **Início** mostra a linha âmbar “Descartei N vaga(s) antiga(s)…”. Para testar
      **sem** capturar 5.000 vagas, force o contador pelo console do **popup**
      (clique com o botão direito dentro do popup → **Inspecionar** → Console):
      ```js
      chrome.storage.local.get('pegavaga_meta').then((d) =>
        chrome.storage.local.set({ pegavaga_meta: { ...d.pegavaga_meta, dropped: 3 } })
      );
      ```
      Reabra o popup: o aviso aparece. **Limpar vagas capturadas** → o aviso some
      (o contador zera junto com as vagas).
- [ ] **Descrição cortada**: numa vaga com descrição gigante, a coluna `Descricao`
      do CSV vem preenchida (cortada em 6.000 caracteres), nunca vazia por causa do corte.

### D. Busca e fila de termos
- [ ] Cada termo vira **uma busca própria** (`keywords=…` na URL).
- [ ] **Localização** entra como `location=…` na URL.
- [ ] Termos vazios/repetidos são descartados; o limite de 40 é respeitado.
- [ ] **Sem nenhum termo não inicia**: clique em **Iniciar** → o aviso “Preencha os
      campos obrigatórios: …” aparece e o campo de termos fica **marcado em
      vermelho**.
- [ ] **Localização obrigatória**: apague a localização e clique em **Iniciar** →
      o aviso aponta a **localização**, o campo fica marcado e o cursor vai para
      ele; o vermelho sai assim que você digita. (Com os dois vazios, o aviso lista
      **os dois**.)
- [ ] **URL**: apague e cole uma URL que **não** é do LinkedIn (ex.:
      `https://exemplo.com/vagas`) → o aviso aponta a **URL de busca no LinkedIn**.
- [ ] Na **fila numerada**, passe o mouse num termo → o tooltip mostra a URL daquela
      busca (com `f_AL=true`, já que o filtro é fixo).

### E. Filtro “Pesquisar somente vagas com Candidatura Simplificada”
- [ ] Vem **ligado e desativado**: o interruptor aparece na tela, mas **não dá para
      desmarcar** (o PegaVaga só trabalha com Candidatura Simplificada).
- [ ] Em toda busca a URL sai com **`f_AL=true`** (confira na barra de endereços ou
      no *title* do termo, na fila).
- [ ] O aviso “Estes dois ficam fixos…” aparece logo abaixo dos dois interruptores
      fixos.

### F. Captura de vagas
- [ ] Ao passar pelos cards, título/empresa/link/descrição são capturados.
- [ ] Fechar e reabrir o popup **não** perde as vagas (persistem no storage).
- [ ] O CSV (**Exportar (CSV)**) abre no Excel com acentos corretos.

### G. Candidatura automática (Candidatura Simplificada)
- [ ] **“Candidatar-se sozinho pela Candidatura Simplificada”** vem **ligado e
      desativado** (fixo): a extensão **sempre** candidata, respeitando as cotas.
- [ ] **Modo simulação** (ligue o interruptor e rode): a extensão busca, abre o
      formulário e **preenche**, mas **não envia** — no relatório a vaga aparece
      como **`Simulada (não enviada)`**, o formulário é fechado sozinho e a
      **cota não é consumida** (confira o card de cotas e “Candidaturas
      registradas”, que não sobem). A barra da fila mostra **“modo simulação (não
      envio)”**. Desligue depois para voltar a candidatar de verdade.
- [ ] Com **“Responder sozinho perguntas obrigatórias”** ligado, as perguntas
      Sim/Não, listas e números são respondidas (Sim/1) e a candidatura é
      **enviada**. Desligado (padrão), pergunta personalizada cai no pedido de ajuda.
- [ ] Vaga **externa** (site da empresa): **não clica**, registra
      `Externa (site da empresa)` com o motivo.
- [ ] Popups pós-candidatura (avaliação/pesquisa/salvar vaga) são **fechados**.

### H. Já candidatada antes
- [ ] Numa vaga em que você já se candidatou, o status fica
      **`Já candidatada antes`** (não “Sem botão”).
- [ ] O resumo mostra **“N já candidatada(s) antes”** e a fatia do donut acompanha.
- [ ] No console da página aparece `[PegaVaga] Vaga já candidatada antes…`.

### I. Pedir ajuda (vaga travada em campo personalizado)
- [ ] Ao travar num campo que a extensão não sabe responder, aparece a
      **notificação na área de trabalho** (“PegaVaga precisa de ajuda…”).
- [ ] O popup mostra a faixa **“✋ PegaVaga precisa de ajuda”** e a luz fica
      **vermelha** (bolinha do chip e do ícone).
- [ ] Botão **“Preencher manualmente”** na notificação **traz a aba do LinkedIn
      para frente**.
- [ ] Preenchendo o campo na tela, o LinkedIn reabilita o botão e a extensão
      **retoma sozinha**.
- [ ] Botão **“Pular vaga”** (na notificação) e **Pular** (no popup) **cancelam a
      vaga atual e avançam**.
- [ ] Com a opção **desligada**, o comportamento antigo volta (descarta e segue).
### J. Cotas
- [ ] Configurar **Por hora = 1** e ver a execução **pausar** ao estourar, com
      retomada automática quando a cota libera.
- [ ] **Por termo**: ao atingir, passa para o **próximo termo**.
- [ ] **Por dia = 0** significa **sem limite**.
- [ ] O card de cotas e o chip de status batem com o que está acontecendo.

### K. Agendador
- [ ] Vem **desligado por padrão** (numa instalação limpa o interruptor está
      desmarcado).
- [ ] Ligado com uma janela que **já está aberta** → inicia sozinho.
- [ ] Fora da janela → **não** varre e a fila fica pausada.
- [ ] Janela que **cruza a meia-noite** (ex.: `22:00 → 06:00`) funciona.
- [ ] “Trazer a aba para frente” foca a aba ao (re)iniciar.

### L. Proteção da conta (guard)
- [ ] Se o LinkedIn mostrar **checkpoint/verificação/limite**, a extensão
      **para tudo** e a luz fica **vermelha** com o aviso no topo do popup.
- [ ] O agendador **não** reinicia enquanto o descanso durar (~1 h).

### M. Exportação
- [ ] **Exportar (CSV)**: todas as vagas, com status e motivo.
- [ ] **Não candidatadas**: só as que não foram candidatadas; as
      `Já candidatada antes` **ficam de fora**.
- [ ] Os dois botões ficam **desabilitados** quando não há o que exportar.
- [ ] Abra o arquivo no Excel/LibreOffice: acentos corretos, colunas `ID`, `Titulo`,
      `Empresa`, `Link`, `Descricao`, `Capturado em`, `Termo`, `Status da
      candidatura`, `Motivo da nao candidatura`, `Tentativas`, `Candidatado em`.

### N. Luz de status (ícone + cabeçalho)
- [ ] **Verde** capturando · **azul** pronta/pausada · **vermelha** atenção (guard,
      problema de página ou “precisa de ajuda”).
- [ ] A cor do **ponto no ícone** da extensão é a mesma leitura do chip do cabeçalho.
- [ ] O **tooltip** do ícone explica o estado atual.
- [ ] Pausa por cota e pausa pelo agendador aparecem como **azul/pronta**, com o
      motivo no tooltip.

### O. Furtividade
- [ ] Enquanto você usa a página (mouse/teclado/rolagem), a automação **espera**
      em vez de clicar por cima.
- [ ] Pausas longas acontecem de tempos em tempos (configurável).

### P. Diagnóstico (relato de problema)
- [ ] Em **Configurações → Diagnóstico**, **Copiar diagnóstico** mostra o toast de
      sucesso (e nada é copiado se o clique falhar — aí aparece o aviso de erro).
- [ ] Cole num editor e confira o conteúdo: **versão** (igual à do
      `manifest.json`), navegador, data, **vagas**, **descartadas por espaço**,
      **candidaturas registradas**, **estado da fila**, **bloqueio**, **modo
      simulação**, **tema**, a **configuração** em JSON e a lista de erros.
- [ ] Sem erro registrado, a lista diz **“(nenhum registrado)”**.
- [ ] Provoque um erro de verdade (ex.: desconecte a internet no meio de uma
      candidatura) e confira que ele aparece na lista **com a hora e o trecho**
      onde aconteceu.
- [ ] Com muitos erros acumulados, a lista guarda **só os 50 últimos**.
- [ ] O próprio texto avisa que ele **inclui a sua configuração e as respostas do
      formulário** — é o lembrete para conferir antes de colar em público.

### Q. Backup da configuração
- [ ] **Salvar (JSON)** baixa `pegavaga_config_….json`; abra num editor e confira
      `app`, `version`, `exportedAt` e `settings` com buscas, cotas, agendador e
      as **respostas do formulário**.
- [ ] Mude algo na configuração (ex.: acrescente um termo) e clique em
      **Restaurar de arquivo** escolhendo o JSON salvo → aparece o **aviso com a
      versão e a data** do arquivo; **Cancelar** não grava nada (o termo novo
      continua lá).
- [ ] **Restaurar agora** repõe a configuração do arquivo: os campos voltam ao
      que estava salvo e a fila de termos é redesenhada.
- [ ] Escolha um **JSON que não é do PegaVaga** (qualquer outro arquivo) → aviso
      de erro e **nada é perdido**.
- [ ] O teste que importa — **reinstale a extensão** (remova e carregue de novo),
      restaure o JSON e confirme que a configuração volta completa, **inclusive
      as respostas do formulário**.

### R. Notificação de fim de varredura
- [ ] Com **“Avisar quando a varredura terminar”** ligado, deixe uma varredura
      curta terminar **com a janela em segundo plano** (troque de aba ou use outro
      programa) → aparece **“PegaVaga terminou a varredura”** com o resumo
      (vagas · candidaturas · descartadas).
- [ ] Clicar na notificação **traz a aba do LinkedIn para frente**.
- [ ] Com a **página em foco**, o fim da varredura **não** gera notificação.
- [ ] Com a opção **desligada**, nenhuma notificação de fim aparece.
- [ ] Em **modo simulação**, o texto diz “formulários preenchidos sem enviar”.
- [ ] Se o LinkedIn pedir verificação/limite (guard), aparece **“PegaVaga parou
      para proteger a sua conta”** e ela **fica na tela** até você vê-la (as
      outras somem sozinhas).

### S. Badge de candidaturas do dia
- [ ] Depois de uma candidatura (num dia ainda zerado), o **badge do ícone** mostra
      **1** e sobe a cada nova candidatura enviada.
- [ ] Com o dia zerado, o badge **não aparece** — o ícone fica só com a luz.
- [ ] O badge **não** sobe com `Simulada (não enviada)`: modo simulação não conta.
- [ ] A luz de status continua funcionando com o badge ligado (badge e luz convivem
      no mesmo ícone).
- [ ] Se der, deixe passar da meia-noite (ou ajuste o relógio do sistema): o
      contador volta a zero **sozinho**.

### T. Idioma (português / English)
- [ ] Selecione **English**: o pop-up inteiro vira
      inglês (abas, grupos, botões, dicas e títulos dos campos) — inclusive o
      **primeiro grupo** (Idioma), que também **não** deve ter traço de separação
      em cima, e o **select** precisa de um respiro depois do título do grupo.
- [ ] Os pedaços que o app **desenha depois** também: fila de termos, donut,
      resumo, **card de cotas** (rótulos e as dicas ao passar o mouse), barras de
      24 h, **linha do agendador**, faixa de ajuda, aviso de limite de uso,
      **aviso de descarte** e o toast — inclusive **com números** (ex.:
      `128 jobs captured`).
- [ ] Passe o mouse no **ícone da extensão**: o tooltip sai em inglês.
- [ ] Termine uma varredura curta com a janela em segundo plano: a
      **notificação** sai em inglês.
- [ ] Volte para **Português**: tudo volta ao português, sem texto “preso” em
      inglês.
- [ ] **Automático (do navegador)**: com o Chrome em inglês o pop-up abre em
      inglês; em português, em português.
- [ ] **CSV** e **diagnóstico** continuam em português (é o que o aviso do próprio
      grupo diz).
- [ ] Nada do que você **digita** é traduzido: termos, localização e respostas do
      formulário ficam iguais.

### U. Relato de erro (fila local e envio)
Para não depender de um erro real, injete um relato de teste (console do pop-up:
botão direito dentro dele → **Inspecionar** → Console):
```js
chrome.storage.local.set({ pegavaga_reports: [ {
  id: 'r-teste', at: Date.now(), when: 'teste', reason: 'rajada',
  errors: [ { at: 'teste', where: 'teste', message: 'erro de teste' } ],
  payload: 'diagnóstico de teste', status: 'pendente', sentAt: null, channel: null } ] });
```
- [ ] Aba **Configurações → Diagnóstico**: aparece **Relatos de erro** com uma
      linha **Pendente**, o motivo (“rajada de erros”) e os botões.
- [ ] **Copiar diagnóstico** copia o texto e mostra o toast de sucesso.
- [ ] **Baixar JSON** salva `pegavaga_relato_….json` (abra e confira o conteúdo).
- [ ] **Descartar** remove a linha da lista (e some do storage).
- [ ] **Sem entregador configurado** (`env.js` vazio): **Enviar agora** avisa que
      não há destinatário e o relato continua **Pendente**.
- [ ] **Com o entregador configurado**: **Enviar agora** → a linha vira **Enviado
      em …** e uma notificação confirma o envio; **confira o e-mail** na caixa de
      entrada configurada.
- [ ] Erro de verdade: com a varredura rodando, provoque uma rajada (ex.: deixe a
      internet cair por um tempo) → aparece a **notificação de problema** com os
      botões, e o botão **Enviar diagnóstico** manda em um clique.
- [ ] Os relatos sobrevivem a fechar/reabrir o pop-up e **não** são apagados por
      **Limpar vagas capturadas**.
- [ ] `bash tools/configurar-relato.sh --mostrar` diz **LIGADO**/**DESLIGADO**
      certo e **não** imprime o token (só `abcd...yz`).
- [ ] Com a URL do `/exec` já no lugar: `bash tools/configurar-relato.sh --testar`
      responde **OK** e o **e-mail de teste chega**; com o token trocado de
      propósito, ele avisa **“recusou o token”** (e o `--testar` sai com erro).
- [ ] No editor do Google, **`Executar ▸ testeDeEnvio`** chega no e-mail da
      constante **`DESTINO`** — conferindo antes que a função escolhida no
      **menu é `testeDeEnvio`** (com outra selecionada, o ▶ Executar “conclui” e
      não faz nada) —, e **`Executar ▸ resumo`** mostra destinatário, token
      mascarado e cota em **Execuções**.

### V. Janelinha de ajuda (pergunta sem resposta)
Para provocar sem depender do sorteio de vagas: use uma vaga com **pergunta
personalizada** (resposta não salva) e deixe a automação chegar ao formulário.
- [ ] O cartão abre numa **janela própria**, no **canto inferior direito** do
      desktop: **só barra de título e borda** — sem aba, sem barra de endereço,
      sem menu.
- [ ] O cartão mostra a vaga (título — empresa) e **um controle por pergunta**;
      numa pergunta de lista, as opções são **as mesmas do LinkedIn**. Todos os
      campos aparecem com **asterisco** de obrigatório.
- [ ] O cartão abre na **posição calculada** (não centralizado), mesmo quando o
      gerenciador de janelas ignora a posição do `create`. Arrastar para outro
      canto, fechar e reabrir → abre no mesmo lugar.
- [ ] A **altura acompanha o conteúdo**: com 1 campo, a janela fica baixa; com
      vários, cresce só até o teto de **470 px** (o tamanho antigo) e o corpo
      passa a **rolar**. Não há altura mínima fixa.
- [ ] **Parar** com o cartão aberto (e/ou com a notificação de ajuda na tela):
      o cartão fecha, a notificação some e a varredura para — mesmo que você
      esteja em outra aba do Chrome.
- [ ] O cartão usa o **mesmo visual do pop-up** (cabeçalho com degradê, cards,
      campos e botões) e **segue o tema**: com o pop-up no escuro (lâmpada
      apagada), ele abre escuro; trocar a lâmpada com o cartão aberto muda o
      cartão na hora. Sem escolha salva, segue o tema do sistema.
- [ ] No cartão, o **botão Aplicar** fica em destaque na primeira linha e
      “Vou preencher à mão”/“Pular esta vaga” dividem a segunda linha.
- [ ] **Aplicar com campo vazio**: não envia nem fecha; o campo fica com borda
      vermelha e **“Campo obrigatório.”**, e o aviso **“Preencha os campos
      obrigatórios antes de continuar.”** aparece no topo. Preencher tudo (e
      marcar o checkbox) libera o envio.
- [ ] Pergunta de **lista nativa** (`<select>`): aparece um **select** com as
      opções originais (não um campo de texto).
- [ ] Pergunta de **lista custom** (`role="combobox"`/`aria-haspopup="listbox"`):
      o cartão também traz as opções (a extensão abre o dropdown para ler e fecha
      em seguida).
- [ ] Pergunta de **rádio** nativa ou custom (`role="radiogroup"`/`role="radio"`):
      aparecem **botões de rádio** com as opções, e a escolha marca a opção certa
      no LinkedIn.
- [ ] **Checkbox obrigatório** desmarcado: o cartão mostra a caixa; marcar e
      aplicar faz o formulário avançar.
- [ ] Se as opções não puderem ser lidas, o cartão mostra um campo de texto com
      **“Digite a opção como aparece no LinkedIn”**; digitar o texto exato da
      opção ainda aplica no campo certo.
- [ ] No console da página, a aplicação registra
      `[PegaVaga] cartão: resposta aplicada em <pergunta>`.
- [ ] **Aplicar e continuar**: a resposta entra no campo, o formulário avança e a
      varredura segue sozinha (a notificação de ajuda **não** aparece).
- [ ] A resposta fica **salva**: numa vaga seguinte com a mesma pergunta, a
      extensão responde sozinha (confira em Configurações → respostas).
- [ ] **Vou preencher à mão**: a aba do LinkedIn vem para a frente e o cartão
      fecha; a automação espera você terminar.
- [ ] **Pular esta vaga**: a vaga é descartada e a varredura vai para a próxima.
- [ ] **✕ (fechar)**: fecha sem decidir e a varredura **não fica parada** (volta
      ao caminho de sempre, com a notificação).
- [ ] Arrastar pelo cabeçalho move a janela; fechar e reabrir **lembra a
      posição**.
- [ ] Deixar o cartão **sem responder por ~45 s**: a **notificação** também
      aparece (segunda porta) e some quando você responde.
- [ ] Com a posição salva fora da tela (ex.: arraste para um segundo monitor e
      desconecte), o cartão **volta para o canto** em vez de abrir invisível.
- [ ] No console do **service worker** (`chrome://extensions` ▸ PegaVaga ▸
      “service worker”), a linha **`[PegaVaga] cartão de ajuda aberto na janela
      … em left top`** mostra onde ele nasceu.
- [ ] No console da **página**, a linha do pedido começa com **`[PegaVaga]
      v<versão>`**, igual à versão de `chrome://extensions` (se não começar, a
      aba está com o `content.js` antigo: recarregue a extensão **e a aba**).
- [ ] Badge do ícone: depois de uma candidatura **enviada**, o número do dia
      aparece; sem candidatura, ele fica **vazio** (não é bug).
- [ ] **Parar varredura** com o cartão aberto: o cartão some.
- [ ] Fechar a **aba** do LinkedIn com o cartão aberto: o cartão some.
- [ ] Se a janela não puder abrir, aparece a **notificação** de ajuda e a vaga
      continua esperando — sem descarte silencioso.

## Antes de publicar (teste final)

1. Rode **este roteiro inteiro num perfil limpo** do Chrome (item 5 do checklist).
2. `node tests/pegavaga.test.js` verde e o **CI** verde no commit da versão.
3. Gere o pacote e **instale o zip** para conferir que ele está completo:
   ```bash
   bash tools/empacotar.sh vX.Y.Z      # usa a tag (o zip é o que se publica)
   ```
   Descompacte `dist/pegavaga-X.Y.Z.zip` em uma pasta e use **Carregar sem
   compactação** apontando para ela: a extensão tem de funcionar igual.

## Como reportar um problema

Anote sempre:

1. **Versão** (`chrome://extensions` ou `manifest.json`) e, se for o caso, a **tag**.
2. **O que estava fazendo** e **o que esperava**.
3. **Logs** com `[PegaVaga]` — console da página **e** console do service worker.
4. Se possível, o **termo/campo exato** que aparece na tela do LinkedIn (ex.:
   “Candidatou-se em …”) — ajuda a ajustar os detectores.
