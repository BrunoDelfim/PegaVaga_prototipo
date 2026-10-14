# PegaVaga — Extensão do Chrome (Manifest V3)

![Testes](https://github.com/BrunoDelfim/PegaVaga_prototipo/actions/workflows/testes.yml/badge.svg)

Extensão para automatizar o rastreamento **e as candidaturas** no LinkedIn:
cadastra uma **URL de busca (ou perfil)** e uma lista de **termos**, varre cada
termo automaticamente, captura **título, empresa, link e descrição** de
cada vaga, **candidata-se sozinho** pela Candidatura Simplificada respeitando
**cotas por hora, 24 h e dia** — respondendo as perguntas obrigatórias do
formulário e fechando os popups de avaliação/pesquisa que o LinkedIn abre depois
— pode **começar e parar nos horários que você
escolher** (agendador), **imita o ritmo humano** (e cede a vez para você quando
está usando o navegador) e exporta tudo em **CSV** — incluindo um relatório das
vagas que **não** foi possível candidatar, com o **motivo** de cada uma.

## Estrutura

```
pegavaga_chrome/
├── manifest.json   # Manifest V3: permissões, service worker e content script
├── shared.js       # Constantes e utilitários puros (cotas, janelas, ritmo e motivos)
├── background.js   # Service worker: agendador (chrome.alarms)
├── popup.html      # Interface (configuração, cotas, agendador + contador)
├── popup.js        # Fila de termos, orquestração da aba e geração do CSV
├── content.js      # Scraping do DOM do LinkedIn, candidatura, fila e storage
├── README.md
├── PRE_PUBLICACAO.md  # Checklist do que falta antes de publicar
└── tests/
    ├── pegavaga.test.js  # Teste automático (estático + unitário)
    └── SMOKE_TEST.md     # Roteiro de teste manual no Chrome
```

## Versionamento

A versão vive no `manifest.json` (campo `version`). A regra de avanço é:

1. **Sobe só o último número**, de **1 em 1**: `0.5.0` → `0.5.1` → `0.5.2` … → `0.5.9`.
2. Quando o último número chega a **9**, ele volta a **0** e **avança o número do
   meio**: `0.5.9` → `0.6.0`.
3. Repete: `0.6.0` … `0.6.9` → `0.7.0` (e, no limite, `0.9.9` → `1.0.0`).

Em resumo: o **último número** é o contador do dia a dia (0–9) e o **do meio** só
muda quando ele estoura.

Ao publicar, a versão ganha uma **tag** anotada no git (`v0.7.14`) — é ela que o
script de empacotamento usa. A **`1.0.0` só sai com o checklist de
pré-publicação 100%** (ver [`PRE_PUBLICACAO.md`](PRE_PUBLICACAO.md)); até lá
seguimos abaixo de 1.

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions/`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta
   `pegavaga_chrome`.
4. Fixe o ícone do **PegaVaga** na barra de ferramentas.
5. Se a extensão já estava instalada nesta pasta, clique em **🔄 Atualizar** em
   `chrome://extensions/` e dê **F5** nas abas do LinkedIn já abertas (o
   `shared.js` e o `background.js` são novos).

## Como usar

1. Clique no ícone da extensão: o pop-up abre na aba **Início**, com as abas
   **Início** e **Configurações** no topo (o cabeçalho e as abas ficam fixos,
   só o conteúdo rola). A **lâmpada** no cabeçalho alterna o tema — **acesa =
   claro, apagada = escuro** — e guarda a sua escolha; sem escolha salva, o pop-up
   segue o tema do sistema.
2. Na aba **Configurações**, em **busca**, preencha:
   - **URL de busca ou perfil**: por padrão
     `https://www.linkedin.com/jobs/search/`. Também funciona colando a URL de
     um perfil/empresa (ex.: `https://www.linkedin.com/company/acme/jobs/`).
   - **Localização (opcional)**: vai como parâmetro `location` na busca
     (ex.: `Brasil`, `São Paulo`, `Remoto`).
   - **Termos de vaga (vários)**: cadastre quantos quiser — **um por linha** ou
     **separados por vírgula** (`desenvolvedor frontend, react, node.js`;
     também valem `;`, `|` e tabulação). Cada termo é uma busca própria, varrida
     **um por vez, em loop, na ordem digitada**; abaixo do campo aparece a
     **fila numerada** (passe o mouse para ver a busca de cada termo). Vazios e
     repetidos são descartados (limite de 40 termos).
3. Em **Candidaturas**:
   - **Pesquisar somente vagas com Candidatura Simplificada** — **ligado por
     padrão**: toda busca é aberta com o **filtro nativo de Candidatura
     Simplificada** do LinkedIn ativado (parâmetro `f_AL=true`), então a lista
     traz **só vagas em que dá para se candidatar sem sair do LinkedIn**. Vale
     também para a varredura sem termos (nesse caso a extensão navega para a URL
     filtrada em vez de usar a página já aberta).
   - **“Candidatar-se sozinho pela Candidatura Simplificada”** — **ligado por
     padrão** (desligue para só rastrear vagas, sem candidatar). Com ele ligado,
     ajuste as cotas:
   - **“Modo simulação”** — **desligado por padrão**: ligado, a extensão faz tudo
     igual (busca, abre o formulário e **preenche**), mas **para antes do clique
     de enviar**. A vaga entra no relatório como `Simulada (não enviada)`, o
     formulário é fechado (o rascunho fica salvo no LinkedIn) e **nenhuma cota é
     consumida**. É a forma segura de ver o que a extensão faria antes de deixar
     ela candidatar de verdade.
   - **Por termo** — quantas candidaturas fazer em cada termo. Ao atingir,
     o PegaVaga **passa para o próximo termo** e zera essa cota.
   - **Por hora** — janela móvel de 60 min.
   - **Por 24 h** — janela móvel de 24 h.
   - **Por dia (0 = sem limite)** — dia corrido, zera à meia-noite.
   - **Máx. vagas por termo** — teto de vagas *visitadas* por termo (trava de
     segurança para o script não varrer a lista para sempre).
   - **Formulário (perguntas e popups do LinkedIn)** — o que fazer quando a
     etapa pede uma resposta que o LinkedIn não tem:
     - **Responder sozinho perguntas obrigatórias** — **desligado por padrão**;
       ligue para preencher sozinho Sim/Não, listas e números (perguntas
       personalizadas caem no [pedido de ajuda](#quando-uma-vaga-precisa-de-você));
     - **Em Sim/Não, responder** — `Sim` (padrão) ou `Não`;
     - **Número (anos, quantidade)** — resposta para campos numéricos (0–200);
     - **Texto livre (ex.: cidade)** — resposta para campos de texto; **vazio**
       (padrão) deixa a extensão não responder em vez de inventar.
     Os popups de **avaliação/pesquisa** que o LinkedIn abre depois de
     candidatar são fechados sozinhos, sempre, independentemente destas opções.
   - **Avisar quando a varredura terminar** — **ligado por padrão**: no fim da fila
     aparece uma notificação na área de trabalho com o resumo (**vagas
     capturadas · candidaturas enviadas · antigas descartadas**), e clicar nela
     **traz a aba do LinkedIn para frente**. Se o LinkedIn pedir verificação ou
     avisar de limite de uso, ela avisa que a varredura **parou para proteger a
     sua conta** e fica na tela até você ver. Com a página em foco nada aparece (a
     notificação seria redundante), e no **modo simulação** o texto diz
     “formulários preenchidos sem enviar”.
   - **Pedir a minha ajuda (notificação)** — **ligado por padrão**: quando uma vaga **trava
     num campo que só você preenche** (pergunta personalizada, sem valor salvo no
     LinkedIn). Em vez de descartar a vaga, o PegaVaga manda uma **notificação na
     área de trabalho** (“PegaVaga precisa de ajuda para continuar”), mantém o
     formulário aberto e espera. Veja o passo a passo em
     [Quando uma vaga precisa de você](#quando-uma-vaga-precisa-de-você).
   As cotas são **dinâmicas**: quando uma delas estoura, a execução **pausa** e
   **volta sozinha** no instante em que a próxima vaga “libera” (a candidatura
   mais antiga sair da janela, ou a virada do dia).
4. Em **Furtividade e segurança** (recomendado deixar ligado):
   - **Ceder a vez para mim** — enquanto você mexe na página (mouse, teclado,
     rolagem), a automação **espera**; se você continuar usando, ela descansa
     alguns minutos e volta sozinha depois. Ela nunca rouba o seu clique nem
     empurra a rolagem por cima da sua.
   - **Pausas longas de tempos em tempos** — a cada *N* candidaturas a extensão
     descansa (padrão: 10 vagas → ~90 s), como uma pessoa faria.
   - **Intervalo mínimo/máximo (s)** — espera entre uma candidatura e outra
     (padrão 4–12 s). Todo intervalo recebe uma variação de ±30%, e antes de
     cada candidatura há uma pausa de “leitura” da vaga (1,5–4,5 s, às vezes
     mais).
   - **Vagas entre pausas / Duração da pausa (s)** — o tamanho do descanso.
   - Se o LinkedIn mostrar **checkpoint, verificação de segurança ou aviso de
     limite de uso**, a extensão **para tudo por 1 hora** (nenhuma candidatura,
     nenhuma varredura, nem pelo agendador) e retoma sozinha depois. O aviso
     aparece no topo do pop-up em laranja.
5. Em **Agendador** (**desligado por padrão**), ligue
   **“Iniciar e parar sozinho nos horários abaixo”** e escolha:
   - **Começa às / Para às** — aceita janelas que cruzam a meia-noite
     (ex.: `22:00 → 06:00`);
   - **Dias da semana**;
   - **Começar sozinho quando o horário abrir** — abre a busca e inicia sem
     você clicar em nada;
   - **Trazer a aba para frente** — o Chrome estrangula os timers de abas em
     segundo plano, então trazer a aba para frente deixa a varredura rápida.
   Aqui a extensão **para de verdade** quando a janela fecha (a fila é
   descartada) e **recomeça do primeiro termo** quando a janela abre de novo.
   Vagas já candidatadas são puladas, então recomeçar não repete candidaturas.
6. Clique em **▶ Iniciar Busca e Varredura**:
   - Se a aba ativa **não** for uma página de vagas do LinkedIn, a extensão
     **abre uma nova aba** (ou navega a aba atual do LinkedIn) já na busca do
     primeiro termo;
   - O script seleciona os cards, lê o painel de detalhes de cada vaga (para
     pegar a descrição) e, se a candidatura automática estiver ligada, clica em
     **Candidatura Simplificada**, preenche/avança o formulário e **envia** —
     e as vagas que saem do LinkedIn (site da empresa) são **registradas no
     relatório e puladas, sem clique**;
   - A fila roda **em loop pelos termos cadastrados**: termina a lista do
     termo atual (fim da lista, teto de vagas ou cota do termo), ele **navega
     sozinho para o próximo** termo, até acabarem os termos — a barra de status
     mostra a fila, ex.: `Varredura em andamento: 3 termos em loop (react → node.js → vue).`
7. Acompanhe na aba **Início**:
   - o **donut** no topo: o número no centro são as **vagas capturadas** e os
     anéis/legenda mostram a situação de cada uma (verde nesta sessão, azul já
     candidatadas antes, vermelho não candidatadas, cinza na fila). Passe o mouse
     nos anéis (ou na legenda) para ver o detalhe e destacar a área;
   - a linha `Termo X de N: "…" · K candidatura(s) neste termo`, com uma **barra
     de progresso** da fila de termos;
   - as **barras de cota** (sessão, hora, 24 h, dia) — a que estourou fica
     vermelha; o texto continua disponível no tooltip;
   - o **mini-gráfico de candidaturas por hora** nas últimas 24 h;
   - o card **“Vagas por termo”**: uma barra por termo de busca, com
     **vagas capturadas · candidatadas** ao lado. **Clique num termo** para ver o
     mini-gráfico das últimas 24 h **daquele termo** (barra clara = vagas
     capturadas, escura = candidaturas) — é assim que dá para ver *quando* cada
     termo rendeu. O card fica **sempre visível**: sem vagas capturadas, ele
     mostra um aviso de vazio;
   - a linha do agendador, ex.:
     `Janela: Seg, Ter, Qua, Qui, Sex, 08:00 → 18:00 · próxima: seg. 08:00.`
     (quando a fila está pausada, ela também diz **por quê**: cota, janela,
     proteção do LinkedIn ou “você estava usando o navegador”);
   - o **chip no cabeçalho** (bolinha + texto) — a mesma leitura do ícone da
     extensão: verde capturando, azul pronta, vermelha quando precisa de
     atenção; passe o mouse para ver o motivo;
   - os avisos e os resultados das ações aparecem num **toast** no rodapé, que
     some sozinho depois de alguns segundos.
8. Ao terminar (ou quando quiser), exporte:
   - **⬇ Exportar para Excel (CSV)** — todas as vagas capturadas, com o status e
     o **motivo** das que não foram candidatadas;
   - **⚠ Exportar não candidatadas (CSV)** — um relatório enxuto, só com as vagas
     que **não** foi possível candidatar (e o porquê de cada uma).
9. **■ Parar Varredura** interrompe tudo na hora: encerra a fila atual, cancela
   qualquer retomada agendada e fecha o formulário de candidatura aberto.

> Sem termos cadastrados, o comportamento é o antigo: a extensão varre a lista
> de vagas aberta no momento (útil quando você já filtrou a busca na mão).

### Como funciona a candidatura automática

- Só a **Candidatura Simplificada** (Easy Apply) é automatizada. Vagas cujo botão
  sai do LinkedIn (site da empresa) são **puladas sem clique nenhum** e ficam
  registradas com o status `Externa (site da empresa)` e o motivo (ex.: “Botão
  ‘Candidatar-se no site da empresa’, que aponta para careers.acme.com.”) — assim
  a extensão nunca leva a sua aba para fora do LinkedIn.
  - O tipo do botão é lido por **ícone** (`link-external` × `linkedin-bug`),
    **rótulo/aria-label** (“no site da empresa”, “Candidatura simplificada”,
    “Easy Apply”…) e **link embutido** (inclusive o redirecionador
    `/redir/redirect?url=…` do LinkedIn), além do aviso “Candidatura
    simplificada” na própria vaga.
  - Quando **não dá para saber** (botão sem ícone, sem rótulo e sem link), a
    extensão também **não clica**: a vaga fica como
    `Botão de candidatura não reconhecido` e é tentada de novo mais adiante (as
    duas tentativas), caso o botão estivesse só demorando a renderizar.
  - A vaga externa é **pulada de vez**: não gasta cota, não entra na pausa longa
    e não é mais visitada nas próximas varreduras (mas continua no relatório).
- O script abre o formulário e **espera o sinal da própria página**: um
  `MutationObserver` avisa no instante em que o LinkedIn mexe na tela, então a
  espera acaba quando a etapa **para de mudar** (a tela fica quieta) — e não
  quando um tempo fixo passa. É isso que segura a automação quando a internet
  está lenta (sem clicar duas vezes nem dar a etapa por perdida cedo): clica em
  **Avançar / Revisar / Enviar candidatura** até o LinkedIn confirmar o envio
  (ou até 15 etapas / 2 min).
- **Popups do LinkedIn**: depois de candidatar, o LinkedIn costuma abrir um
  popup de **avaliação/pesquisa** ou avisos (“salvar vaga”, “seguir empresa”,
  “compartilhar”). O PegaVaga identifica esses dialogs (que **não** são o
  formulário) e fecha um a um — Fechar/Agora não/Não, obrigado/Entendi/Pular,
  ou `Esc`. Além da limpeza normal, um **guarda de popup** fica de olho nas
  mutações **durante todo o fluxo**: se um popup entrar na tela no meio de uma
  espera (etapa carregando, envio em andamento), ele é fechado na hora, em
  paralelo — o fluxo não precisa reiniciar, ele **continua de onde estava**.
  Sem isso o popup ficava na frente da lista e a varredura empacava.
- **Perguntas obrigatórias**: **desligado por padrão**. Quando ligado e a etapa
  pede algo que o LinkedIn não respondeu sozinho (Sim/Não, listas e números), a
  extensão responde com o que está em **Formulário (perguntas e popups do
  LinkedIn)** — padrão: **Sim**, número **1** e o texto livre configurado. Perguntas de texto livre ficam **em
  branco** se você não preencher nada (a extensão não inventa respostas). Se
  quiser respostas específicas por pergunta, grave em
  `pegavaga_settings.apply.answers`, ex.:
  `{ "autorização de trabalho": "Não", "pretensão salarial": "5000" }`.
- **Ele não inventa o que não sabe**: se mesmo respondendo o possível o
  formulário parar numa pergunta que não dá para preencher (currículo anexo,
  telefone vazio, pergunta sem opção), ele **pede a sua ajuda** (notificação) em
  vez de descartar a vaga — veja
  [Quando uma vaga precisa de você](#quando-uma-vaga-precisa-de-você). Com essa
  ajuda **desligada**, a vaga é descartada e fica marcada como
  `Travada em campo obrigatório` — o motivo no relatório diz **qual campo**
  ficou pendente e **o que já foi respondido**
  (ex.: “Campos não preenchidos: Telefone. Respondi sozinho: Sim.”).
- **Ritmo humano**: todo intervalo tem variação aleatória, o clique é precedido
  de rolagem + passagem de mouse pelo elemento, há pausas de “leitura” da vaga,
  pausas longas periódicas e a extensão **cede a vez** para você quando está
  usando a página (mouse, teclado, rolagem).
- **Proteção da conta**: se aparecer aviso de limite de uso, verificação de
  segurança ou redirecionamento para `checkpoint`, a automação **para na hora**
  (a fila fica pausada, não é descartada) e só volta depois de ~1 h de descanso.
- Uma vaga **nunca** é candidatada duas vezes: o resultado fica gravado na vaga
  (`Candidatado em`, `Status da candidatura` e `Motivo da não candidatura`, que
  vão para o CSV).
- Vaga em que você **já se candidatou antes**: o LinkedIn troca o botão pelo
  aviso “Candidatou-se” / “Você se candidatou” / “Candidatura enviada”. O PegaVaga
  reconhece isso, **pula a vaga** (sem clique e sem gastar cota) e marca como
  `Já candidatada antes` — assim o resumo **conta quantas já eram suas**, em vez
  de dizer que faltou botão naquela vaga. Essas vagas **não** entram no CSV das
  não candidatadas (elas já estavam candidatadas).
- Se o **Parar Varredura** for clicado no meio de um formulário, ele é
  descartado (`Cancelada`).
- Vagas que a varredura **não chegou a tentar** (cota estourada, teto de vagas,
  janela fechada, você usando a página) ficam com o status
  `Adiada (sem cota ou fora do horário)` e o motivo — a próxima passada tenta de
  novo, sem gastar tentativa.

> **Use por sua conta e risco.** Automação de candidaturas é uma área cinzenta
> do LinkedIn: a extensão age na sua sessão, com os seus dados, e o envio é
> definitivo. Comece com cotas baixas (por exemplo 5/h, 20/dia) e acompanhe as
> primeiras execuções antes de deixar rodando sozinho. **O mesmo aviso aparece
> dentro da extensão**, no card “Como funciona” da aba **Início** — quem instala
> pela loja não lê o README.

### Quando uma vaga precisa de você

Quase toda vaga tem **perguntas personalizadas** que o LinkedIn não sabe
responder sozinho (valor não salvo no seu perfil). Nesse caso o formulário
**trava**: o botão “Avançar” fica desabilitado e nada avança.

Com **“Pedir a minha ajuda”** ligado (padrão), em vez de descartar a vaga o
PegaVaga:

1. **Mantém o formulário aberto** e pausa a vaga (não descarta, não pula);
2. Manda uma **notificação na área de trabalho** — *“PegaVaga precisa de ajuda
   para continuar”* — dizendo o nome da vaga e o campo que ficou pendente;
3. A notificação tem o botão **“Preencher manualmente”**, que **traz a aba do
   LinkedIn para frente** (clicar no corpo da notificação também foca a aba) —
   é só completar o campo na tela;
4. Quando você preenche o obrigatório, o LinkedIn **reabilita o botão** e o
   PegaVaga **retoma sozinho**, seguindo com a candidatura;
5. Não quer preencher? Clique em **“Pular vaga”** (na notificação) ou em
   **“⏭ Pular vaga atual”** (no pop-up): a candidatura atual é cancelada e a
   varredura segue para a próxima.

> Enquanto uma vaga espera por você, o pop-up mostra a faixa
> **“✋ PegaVaga precisa de ajuda”** e a **luz fica vermelha**. Se ninguém
> aparecer em alguns minutos, a vaga é descartada para a varredura não travar (o
> relatório registra o motivo, como antes).

> Desligue **“Pedir a minha ajuda”** para voltar ao comportamento antigo:
> descarta a vaga e segue em frente sozinho.

### Deu problema? Copiar diagnóstico

Na aba **Configurações**, no fim, o botão **“Copiar diagnóstico”** põe na área de
transferência um texto pronto para colar num relato de problema: **versão**,
navegador, **configuração** completa, estado da **fila**, **bloqueio**/**descarte**
e os **últimos 50 erros** que a automação registrou — cada um com a hora e com o
trecho onde aconteceu (ex.: `clicar com mouse humanizado: Cannot read properties
of null`).

Antes eram `catch` mudos: o erro desaparecia sem deixar rastro e não havia como
saber por que uma vaga falhou. Agora todo `catch` do `content.js` registra o que
houve (só dois, de condições normais e previsíveis, ficam de fora de propósito).

> O texto inclui a sua configuração e as respostas do formulário — **confira
> antes de publicar** num lugar público.

### Backup da configuração

Na aba **Configurações → Backup da configuração**:

- **Salvar (JSON)** baixa `pegavaga_config_AAAA-MM-DD_HH-MM-SS.json` com as
  buscas, as cotas, o agendador, o ritmo, o modo simulação e **as respostas do
  formulário** (é o que dói mais perder). As vagas capturadas **não** entram aqui
  — elas saem pela exportação em CSV.
- **Restaurar de arquivo** lê esse JSON, **mostra o que veio** (versão e data de
  quando foi salvo) e **só grava depois que você confirma** — escolher o arquivo
  não mexe em nada. O conteúdo passa pelo `parseSettings`: número fora de faixa
  vira o padrão, termo repetido é limpo e **JSON que não é do PegaVaga é
  recusado** com aviso: importar um arquivo qualquer não pode zerar a sua
  configuração.

> Serve para reinstalar sem reconfigurar tudo: salve o JSON, reinstale a
> extensão, restaure.

### Idioma da interface (português / English)

Na aba **Configurações → Idioma** dá para escolher **Automático (do navegador)**,
**Português** ou **English**. O que muda: pop-up, **tooltip do ícone** e as
**notificações**. O que **não** muda (de propósito): o **CSV** e o **diagnóstico**
continuam em português — são arquivos de dados, e traduzir a planilha mudaria o
formato de quem já usa.

Como funciona por dentro: o `shared.js` tem um **dicionário de pt → en** em que a
**chave é o próprio texto em português** (o idioma de origem). Isso tem duas
consequências boas:

- o pop-up **não precisa de marcação nenhuma** no HTML: o `localizeDom()` traduz a
  tela inteira de uma vez, texto por texto, inclusive **textos com números**
  (`128 vagas capturadas` → `128 jobs captured`), porque o dicionário aceita
  chaves com marcadores;
- texto **ainda sem tradução aparece em português**, nunca como `undefined` — e um
  teste **reprova** se entrar texto novo no pop-up sem tradução (a cobertura é
  conferida a cada `node tests/pegavaga.test.js`);
- a varredura de cobertura **também olha o código** (`popup.js` e `shared.js`), e
  não só o HTML: foi assim que apareceram as frases **compostas** (toasts, faixas
  e rodapés montados por `+` ou template) que tinham ficado em português. Frases
  com valores dentro precisam de uma chave com marcadores (`{ nome }`) — os
  padrões mais específicos ficam **antes** dos genéricos no dicionário.

> **Cuidado ao rodar localmente:** o CI checa a sintaxe no **Node 20**. Versões
> mais novas do Node podem aceitar construções que o 20 recusa — já aconteceu aqui
> com um `const` declarado duas vezes no mesmo bloco (o Node 26 passou, o 20
> reprovou, e quem pegou foi o CI).

O idioma escolhido vale também no service worker (que lê a configuração ao subir e
a cada mudança), para o tooltip e as notificações saírem no idioma certo.

### Arquivos gerados

**CSV completo** — nome `pegavaga_AAAA-MM-DD_HH-MM-SS.csv`:

- Colunas: `ID`, `Titulo`, `Empresa`, `Link`, `Descricao`, `Capturado em`,
  `Termo`, `Status da candidatura`, `Motivo da nao candidatura`, `Tentativas`,
  `Candidatado em`
- Separador: `;` (padrão do Excel pt-BR)
- Codificação: UTF-8 com BOM (acentos corretos no Excel)
- Campos sempre entre aspas, com aspas internas duplicadas e quebras de linha
  preservadas dentro do campo `Descricao`.
- `Motivo da nao candidatura` fica **vazio** quando a candidatura foi enviada.

Valores possíveis de `Status da candidatura`: `Enviada`,
`Simulada (não enviada)`, `Já candidatada antes`, `Externa (site da empresa)`,
`Botão de candidatura não reconhecido`,
`Sem botão de candidatura`, `Formulário não abriu`,
`Travada em campo obrigatório`, `Formulário incompleto`, `Interrompida (Parar)`,
`Parada por proteção do LinkedIn`, `Erro na automação`,
`Adiada (sem cota ou fora do horário)` e `Não tentada`.

Exemplos de motivo gravado:

| Status                             | Motivo (resumo)                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `Externa (site da empresa)`        | A vaga não usa a Candidatura Simplificada: o botão leva ao site da empresa, então ela é pulada. `Botão "Candidatar-se no site da empresa", que aponta para careers.acme.com.` |
| `Já candidatada antes`             | O LinkedIn mostra que você já se candidatou a esta vaga antes; a candidatura não foi enviada de novo. |
| `Simulada (não enviada)`           | O modo simulação estava ligado: o formulário foi todo preenchido, mas a candidatura NÃO foi enviada de propósito. |
| `Botão de candidatura não reconhecido` | Não identifiquei a Candidatura Simplificada nesta vaga; para não sair do LinkedIn, não cliquei. |
| `Sem botão de candidatura`         | A página da vaga não oferece botão de candidatura.                               |
| `Travada em campo obrigatório`     | …+ `Campos não preenchidos: Telefone. Respondi sozinho: Sim.`                    |
| `Formulário incompleto`            | …+ `Parou na etapa 3 de 15.`                                                     |
| `Parada por proteção do LinkedIn`  | O LinkedIn pediu verificação ou limite de uso (a automação descansou 1 h).        |
| `Adiada (sem cota ou fora do…)`    | A cota de candidaturas estourou; esta vaga ficou para a próxima passada.          |
| `Não tentada`                      | Ainda não chegou a vez desta vaga (teto de vagas por varredura).                 |

**CSV das não candidatadas** — nome
`pegavaga_nao_candidatadas_AAAA-MM-DD_HH-MM-SS.csv`, com colunas
`ID`, `Titulo`, `Empresa`, `Link`, `Termo`, `Status`, `Motivo`,
`Ultima tentativa`. Só entram as vagas que **não** foram candidatadas (as
definitivas e as que ficaram na fila); as `Já candidatada antes` ficam de fora.

## Testes

**Automático** (sem precisar do Chrome) — valida `manifest`, permissões, exports
do `shared.js`, mensageria entre os contextos, IDs do popup, códigos de status,
configuração, cotas, horários, relatório, luz de status e as detecções (ex.:
“Candidatou-se”). Roda na raiz do projeto:

```bash
node tests/pegavaga.test.js
```

Sai com código `0` quando tudo passa e `1` quando há falha (imprime a lista de
falhas no fim).

**Manual** (o que depende do navegador + LinkedIn): siga o roteiro em
[`tests/SMOKE_TEST.md`](tests/SMOKE_TEST.md) depois de mudanças relevantes —
instale pelo `chrome://extensions`, dê **F5** nas abas do LinkedIn e confira cada
item.

## Empacotar para a loja

```bash
bash tools/empacotar.sh          # empacota o commit atual (HEAD)
bash tools/empacotar.sh v0.7.14   # empacota uma tag — é o que se publica
```

O script roda os testes antes (não gera zip com teste vermelho), monta
`dist/pegavaga-<versão>.zip` e confere que o `manifest.json` ficou **na raiz** do
zip: a Chrome Web Store exige isso, o arquivo **não pode estar dentro de uma
pasta**. Ele também avisa quando a versão do `HEAD` difere da tag escolhida e
quando a descrição do manifest passa dos **132 caracteres** que a loja pede.

Como o pacote vem de `git archive`, entram só arquivos versionados e da lista
explícita (`manifest.json`, os quatro scripts, o `popup.html` e `icons/`):
`tests/`, `.github/`, os `.md` e o `.git` ficam de fora, e **não precisa de `zip`
instalado** — o próprio git monta o zip. O `dist/` é ignorado pelo git.

## Antes de publicar

O que falta para sair da beta está em **[`PRE_PUBLICACAO.md`](PRE_PUBLICACAO.md)**:
checklist com os dois bloqueadores que faltam (**material da loja** e o **smoke
test em perfil limpo**). Cada item tem **por quê**, **como fazer** e uma caixinha
que vai sendo marcada — as concluídas apontam a versão e o commit.

## Privacidade

A política está em [`PRIVACY.md`](PRIVACY.md) — em resumo: **nada sai do seu
navegador**. Tudo vive no `chrome.storage.local`, sem servidor, sem conta, sem
analytics e sem `storage.sync`; o único destino de rede é o próprio `linkedin.com`,
quando o navegador abre as vagas por sua causa.

O material operacional da publicação (URL da política, propósito único, respostas
do formulário de dados e justificativa de cada permissão) fica em
[`LOJA.md`](LOJA.md).

## Permissões utilizadas

| Permissão        | Motivo                                                        |
| ---------------- | ------------------------------------------------------------- |
| `storage`        | Guardar a configuração, a fila, as vagas e as cotas.           |
| `clipboardWrite` | **Copiar diagnóstico**: o botão põe o relato na área de transferência quando você clica (sem aviso ao usuário, é a permissão de escrita, não de leitura). |
| `unlimitedStorage` | Banco local de vagas: o histórico de descrições passa do teto de ~10 MB do `storage.local`. |
| `activeTab`      | Falar com a aba ativa do LinkedIn a partir do pop-up.         |
| `alarms`         | Agendador: acordar o service worker no horário escolhido e quando uma cota libera. |
| `notifications`  | Avisar na área de trabalho quando uma vaga precisa da sua ajuda. |
| `https://www.linkedin.com/*` | Injetar o `content.js`, ler o DOM das vagas e navegar nas abas do LinkedIn. |

Não são necessárias as permissões `tabs` nem `downloads`: a URL da aba do
LinkedIn já é liberada pelo `host_permissions`, a procura por uma aba aberta é
feita com `chrome.tabs.query({ url: 'https://www.linkedin.com/*' })` (coberto
pelo `host_permissions`, com fallback para abrir uma aba nova) e o CSV é baixado
via `Blob` + `<a download>` gerados no próprio pop-up.

## Dados guardados em `chrome.storage.local`

| Chave                  | Conteúdo                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `pegavaga_settings`    | `{ baseUrl, location, terms[], apply{…}, schedule{…} }` — inclui as cotas, o ritmo humano (`minDelayMs`, `maxDelayMs`, `readMinMs`, `readMaxMs`, `respectUserActivity`, `breaksEnabled`, `breakEvery`, `breakMs`), as respostas do formulário (`fillRequired`, `answerYes`, `answerNumber`, `answerText`, `answers`) e o agendador. |
| `pegavaga_run`         | Fila atual: `{ running, paused, resumeAt, pauseReason, index, term, terms[], urls[], appliedInTerm, visitedInTerm, appliedTotal, sinceBreak, tabId, source }`. |
| `pegavaga_jobs`        | `{ [jobId]: { id, title, company, link, term, description, applyStatus, applyReason, applyAttempts, applyTriedAt, appliedAt, capturedAt } }`. |
| `pegavaga_meta`        | `{ lastRun, count, pageUrl, dropped }` — `dropped` é quantas vagas antigas já saíram pelo teto. |
| `pegavaga_apps`        | `[timestamp, …]` das candidaturas enviadas (base das cotas por hora/24 h/dia). |
| `pegavaga_guard`       | `{ blockedUntil, reason, at }` — descanso imposto quando o LinkedIn sinaliza limite de uso/verificação. Enquanto vale, **nada** roda (nem o agendador). |

`pauseReason` da fila diz por que ela está parada: `cota`, `guard`, `usuario`
(vez para você) ou `schedule` (fora da janela do agendador).

### Tetos de armazenamento

`pegavaga_jobs` guarda no máximo **5.000 vagas** (`MAX_JOBS`): passando disso, as
capturadas há mais tempo saem — e o pop-up avisa isso no card **Início** (o
`dropped` do `pegavaga_meta`). A descrição de cada vaga é cortada em **6.000
caracteres** (`DESC_MAX_CHARS`); o texto inteiro continua na própria vaga do
LinkedIn, que está sempre no `Link`.

Os dois tetos ficam em `SHARED.trimJobs` (função pura, coberta pelos testes) e
são aplicados **antes de cada gravação**, no `persist()` do `content.js`. A
permissão `unlimitedStorage` tira o teto de ~10 MB do `chrome.storage.local`,
mas os limites continuam valendo para a extensão não ficar lenta: a cada
gravação o mapa inteiro é serializado.

## Agendador (background.js)

- O service worker mantém **um alarme de 1 minuto** só quando faz sentido: com o
  agendador ligado, com alguma execução pausada ou com a proteção da conta ativa.
  Fora disso, ele fica dormindo.
- A cada tick ele decide:
  0. **proteção da conta ativa** → não inicia nada, não retoma nada e pausa
     qualquer execução em andamento até o fim do descanso (`pauseReason: guard`);
  1. **janela fechada + execução rodando** → encerra a execução (remove a fila e
     manda `PEGAVAGA_STOP` para a aba);
  2. **janela aberta + nenhuma execução** (e “começar sozinho” ligado) → monta a
     fila e abre/reaproveita a aba do LinkedIn no primeiro termo;
  3. **execução pausada com cota liberada** → manda `PEGAVAGA_RESUME` para a aba
     (se a aba não responder, recarrega a página, e o `content.js` retoma pelo
     `load`).
- O `content.js` também tem um timer local para retomar, então a execução
  continua mesmo se o alarme atrasar. Fechar o Chrome adia tudo para o próximo
  horário da janela.

## Luz de status no ícone

O ícone da extensão — e a bolinha ao lado do nome no pop-up — mostra o estado num
relance (a mesma cor nos dois lugares):

| Cor         | Quando aparece                                                                                                                                                  | Leitura         |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 🟢 Verde     | A fila está ativa: o `content.js` está varrendo e candidatando agora (ou seja, há `PEGAVAGA_PROGRESS` com varredura em andamento).                                | **Capturando**  |
| 🟡 Amarela   | Parada esperando algo normal: nenhuma varredura, pausa por **cota**, janela do **agendador** fechada, **descanso longo** do ritmo humano ou “você estava usando o navegador”. | **Pronta** (volta sozinha) |
| 🔴 Vermelha  | **Proteção da conta** ligada (o LinkedIn sinalizou limite de uso) ou varredura que parou com **problema** (ex.: página sem a lista de vagas).                   | **Precisa de atenção** |

- A luz é desenhada **no próprio logo** (um ponto no canto inferior direito, com
  anel branco para não se perder no azul), pelo service worker, em 16 e 32 px. Se
  o navegador não tiver `OffscreenCanvas`/`createImageBitmap`, ele cai num **selo
  colorido** no canto do ícone — o recado é o mesmo.
- O estado também vira **tooltip**, ex.:
  `PegaVaga — Capturando vagas — termo 2 de 3: "react".` ou
  `PegaVaga — Pausada por cota de candidaturas até 14:30.`
- Quem decide a cor é o `statusLight()` do `shared.js` (função pura e testada), a
  partir do estado gravado no storage e dos `PEGAVAGA_PROGRESS` que o content
  script envia — funciona com o pop-up fechado.
- O **badge** (o quadradinho no canto do ícone) mostra o **total de candidaturas de
  hoje**: some quando o dia ainda não tem nenhuma e vira `99+` se passar disso. Sai
  de `SHARED.countAppsToday()` (dia local, com carimbo no futuro ignorado) e
  `SHARED.badgeText()`, as duas puras e testadas. Como a luz vai desenhada **no
  logo**, o badge fica livre para o número — e no plano B **sem canvas** o badge
  carrega os dois: a **cor** continua dizendo o status e o número entra por cima.
  Um alarme remarcado a cada disparo zera o contador na **virada do dia**, para o
  ícone não amanhecer com o número de ontem. O modo simulação não conta (nada foi
  enviado).
- A luz só redesenha o ícone quando a **cor muda**; os PNGs do logo ficam em
  cache na memória do worker.

## Mensagens trocadas (popup ↔ content)

| Mensagem                | Direção        | Efeito                                   |
| ----------------------- | -------------- | ---------------------------------------- |
| `PEGAVAGA_START`        | popup → content| Inicia a varredura (pode trazer a fila).  |
| `PEGAVAGA_STOP`         | popup/worker → content | Interrompe a varredura e encerra a fila. |
| `PEGAVAGA_RESUME`       | worker → content | Sai da pausa por cota e retoma a fila.  |
| `PEGAVAGA_PING`         | popup → content| Consulta se está varrendo.               |
| `PEGAVAGA_CLEAR`        | popup → content| Zera o estado em memória e no storage.   |
| `PEGAVAGA_PROGRESS`     | content → popup/worker | Contador, cotas, pausa (+ motivo), pausa longa, proteção da conta e problema da varredura (é o que acende a **luz do ícone** em tempo real). |

## Observações importantes

- O DOM do LinkedIn muda com frequência. Todos os seletores estão agrupados nos
  objetos `SEL` (vagas) e `APPLY_SEL` (candidatura), no topo do `content.js`,
  com vários fallbacks — se algo parar de funcionar, ajuste apenas esses dois
  objetos.
- A descrição só existe no painel de detalhes, por isso o script **seleciona
  cada card** durante a varredura. Isso é intencional.
- A fila vive no `chrome.storage.local`, então sobrevive ao recarregamento da
  página a cada troca de termo. Fechar a aba ou usar **Parar Varredura** encerra
  a fila; uma pausa por cota sobrevive e volta no horário marcado.
- Se cair em uma tela de login/checkpoint do LinkedIn, a fila é encerrada
  automaticamente (e, se o checkpoint for por excesso de uso, também entra em
  descanso de 1 h antes de qualquer nova tentativa).
- **Abas em segundo plano**: o Chrome estrangula timers de abas escondidas
  (depois de ~5 min, para 1 execução por minuto). O PegaVaga continua
  funcionando, mas devagar; por isso o agendador tem a opção **“Trazer a aba
  para frente”**, e o alarme de 1 min do service worker serve de rede de
  segurança para retomar sozinho.
- **Limpar vagas capturadas** apaga o histórico de vagas, mas **não** apaga as
  cotas (`pegavaga_apps`) nem o descanso de proteção (`pegavaga_guard`): eles
  existem para proteger a sua conta.
- Se a extensão foi instalada com uma aba do LinkedIn já aberta, recarregue a
  página (F5) para o `content.js` ser injetado.
- Comece com cotas baixas (por exemplo 6/h, 25/dia) e com as opções de
  furtividade ligadas. Use de forma responsável, respeitando os Termos de Uso do
  LinkedIn.



