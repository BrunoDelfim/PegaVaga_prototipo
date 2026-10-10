# PegaVaga — Extensão do Chrome (Manifest V3)

Extensão para automatizar o rastreamento **e as candidaturas** no LinkedIn:
cadastra uma **URL de busca (ou perfil)** e uma lista de **termos**, varre cada
termo automaticamente, captura **título, empresa, link e descrição completa** de
cada vaga, **candidata-se sozinho** pela Candidatura Simplificada respeitando
**cotas por hora, 24 h e dia**, pode **começar e parar nos horários que você
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
└── README.md
```

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

1. Clique no ícone da extensão e abra **⚙ Configuração de busca**.
2. Em **busca**, preencha:
   - **URL de busca ou perfil**: por padrão
     `https://www.linkedin.com/jobs/search/`. Também funciona colando a URL de
     um perfil/empresa (ex.: `https://www.linkedin.com/company/acme/jobs/`).
   - **Localização (opcional)**: vai como parâmetro `location` na busca
     (ex.: `Brasil`, `São Paulo`, `Remoto`).
   - **Termos de vaga (um por linha)**: cada linha é um termo pesquisado e
     varrido **um por vez** (ex.: `desenvolvedor frontend`). Linhas vazias e
     repetidos são descartados (limite de 40 termos).
3. Em **Candidaturas** (opcional), ligue
   **“Candidatar-se sozinho pela Candidatura Simplificada”** e ajuste as cotas:
   - **Por termo** — quantas candidaturas fazer em cada termo. Ao atingir,
     o PegaVaga **passa para o próximo termo** e zera essa cota.
   - **Por hora** — janela móvel de 60 min.
   - **Por 24 h** — janela móvel de 24 h.
   - **Por dia (0 = sem limite)** — dia corrido, zera à meia-noite.
   - **Máx. vagas por termo** — teto de vagas *visitadas* por termo (trava de
     segurança para o script não varrer a lista para sempre).
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
5. Em **Agendador** (opcional), ligue
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
   - Ao terminar um termo (lista no fim, teto de vagas ou cota do termo), ele
     **navega sozinho para o próximo** termo da fila, até acabarem os termos.
7. Acompanhe no pop-up:
   - `N vagas capturadas` e o resumo das candidaturas, ex.:
     `12 candidatada(s) · 8 não candidatada(s) · 3 na fila: 4 travada em campo obrigatório · 2 externa (site da empresa)`;
   - a linha `Termo X de N: "…" · K candidatura(s) neste termo`;
   - a linha de cotas, ex.:
     `Candidaturas — 2/6 na hora · 5/25 em 24 h · 8 hoje · 3/8 neste termo`;
   - a linha do agendador, ex.:
     `Janela: Seg, Ter, Qua, Qui, Sex, 08:00 → 18:00 · próxima: seg. 08:00.`
     (quando a fila está pausada, ela também diz **por quê**: cota, janela,
     proteção do LinkedIn ou “você estava usando o navegador”).
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
- O script abre o formulário, clica em **Avançar / Revisar / Enviar
  candidatura** até o LinkedIn confirmar o envio (ou até 15 etapas / 2 min).
- **Ele não inventa respostas**: se parar em um campo obrigatório que não está
  preenchido no seu perfil (telefone, perguntas de triagem, currículo), o
  formulário é **descartado** e a vaga fica marcada como
  `Travada em campo obrigatório` — e o motivo no relatório diz **qual campo**
  ficou pendente (ex.: “Campos não preenchidos: Telefone”). Resolva esses casos
  na mão.
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
- Se o **Parar Varredura** for clicado no meio de um formulário, ele é
  descartado (`Cancelada`).
- Vagas que a varredura **não chegou a tentar** (cota estourada, teto de vagas,
  janela fechada, você usando a página) ficam com o status
  `Adiada (sem cota ou fora do horário)` e o motivo — a próxima passada tenta de
  novo, sem gastar tentativa.

> **Use por sua conta e risco.** Automação de candidaturas é uma área cinzenta
> do LinkedIn: a extensão age na sua sessão, com os seus dados, e o envio é
> definitivo. Comece com cotas baixas (por exemplo 5/h, 20/dia) e acompanhe as
> primeiras execuções antes de deixar rodando sozinho.

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
`Externa (site da empresa)`, `Botão de candidatura não reconhecido`,
`Sem botão de candidatura`, `Formulário não abriu`,
`Travada em campo obrigatório`, `Formulário incompleto`, `Interrompida (Parar)`,
`Parada por proteção do LinkedIn`, `Erro na automação`,
`Adiada (sem cota ou fora do horário)` e `Não tentada`.

Exemplos de motivo gravado:

| Status                             | Motivo (resumo)                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `Externa (site da empresa)`        | A vaga não usa a Candidatura Simplificada: o botão leva ao site da empresa, então ela é pulada. `Botão "Candidatar-se no site da empresa", que aponta para careers.acme.com.` |
| `Botão de candidatura não reconhecido` | Não identifiquei a Candidatura Simplificada nesta vaga; para não sair do LinkedIn, não cliquei. |
| `Sem botão de candidatura`         | A página da vaga não oferece botão de candidatura.                               |
| `Travada em campo obrigatório`     | …+ `Campos não preenchidos: Telefone, Pergunta: você autoriza…`                  |
| `Formulário incompleto`            | …+ `Parou na etapa 3 de 15.`                                                     |
| `Parada por proteção do LinkedIn`  | O LinkedIn pediu verificação ou limite de uso (a automação descansou 1 h).        |
| `Adiada (sem cota ou fora do…)`    | A cota de candidaturas estourou; esta vaga ficou para a próxima passada.          |
| `Não tentada`                      | Ainda não chegou a vez desta vaga (teto de vagas por varredura).                 |

**CSV das não candidatadas** — nome
`pegavaga_nao_candidatadas_AAAA-MM-DD_HH-MM-SS.csv`, com colunas
`ID`, `Titulo`, `Empresa`, `Link`, `Termo`, `Status`, `Motivo`,
`Ultima tentativa`. Só entram as vagas que **não** foram candidatadas (as
definitivas e as que ficaram na fila).

## Permissões utilizadas

| Permissão        | Motivo                                                        |
| ---------------- | ------------------------------------------------------------- |
| `storage`        | Guardar a configuração, a fila, as vagas e as cotas.           |
| `activeTab`      | Falar com a aba ativa do LinkedIn a partir do pop-up.         |
| `alarms`         | Agendador: acordar o service worker no horário escolhido e quando uma cota libera. |
| `https://www.linkedin.com/*` | Injetar o `content.js`, ler o DOM das vagas e navegar nas abas do LinkedIn. |

Não são necessárias as permissões `tabs` nem `downloads`: a URL da aba do
LinkedIn já é liberada pelo `host_permissions`, a procura por uma aba aberta é
feita com `chrome.tabs.query({ url: 'https://www.linkedin.com/*' })` (coberto
pelo `host_permissions`, com fallback para abrir uma aba nova) e o CSV é baixado
via `Blob` + `<a download>` gerados no próprio pop-up.

## Dados guardados em `chrome.storage.local`

| Chave                  | Conteúdo                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `pegavaga_settings`    | `{ baseUrl, location, terms[], apply{…}, schedule{…} }` — inclui as cotas, o ritmo humano (`minDelayMs`, `maxDelayMs`, `readMinMs`, `readMaxMs`, `respectUserActivity`, `breaksEnabled`, `breakEvery`, `breakMs`) e o agendador. |
| `pegavaga_run`         | Fila atual: `{ running, paused, resumeAt, pauseReason, index, term, terms[], urls[], appliedInTerm, visitedInTerm, appliedTotal, sinceBreak, tabId, source }`. |
| `pegavaga_jobs`        | `{ [jobId]: { id, title, company, link, term, description, applyStatus, applyReason, applyAttempts, applyTriedAt, appliedAt, capturedAt } }`. |
| `pegavaga_meta`        | `{ lastRun, count, pageUrl }`.                                  |
| `pegavaga_apps`        | `[timestamp, …]` das candidaturas enviadas (base das cotas por hora/24 h/dia). |
| `pegavaga_guard`       | `{ blockedUntil, reason, at }` — descanso imposto quando o LinkedIn sinaliza limite de uso/verificação. Enquanto vale, **nada** roda (nem o agendador). |

`pauseReason` da fila diz por que ela está parada: `cota`, `guard`, `usuario`
(vez para você) ou `schedule` (fora da janela do agendador).

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

## Mensagens trocadas (popup ↔ content)

| Mensagem                | Direção        | Efeito                                   |
| ----------------------- | -------------- | ---------------------------------------- |
| `PEGAVAGA_START`        | popup → content| Inicia a varredura (pode trazer a fila).  |
| `PEGAVAGA_STOP`         | popup/worker → content | Interrompe a varredura e encerra a fila. |
| `PEGAVAGA_RESUME`       | worker → content | Sai da pausa por cota e retoma a fila.  |
| `PEGAVAGA_PING`         | popup → content| Consulta se está varrendo.               |
| `PEGAVAGA_CLEAR`        | popup → content| Zera o estado em memória e no storage.   |
| `PEGAVAGA_PROGRESS`     | content → popup| Contador, cotas, pausa (+ motivo), pausa longa e proteção da conta. |

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



