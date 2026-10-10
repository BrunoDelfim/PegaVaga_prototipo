# PegaVaga — Extensão do Chrome (Manifest V3)

Extensão para automatizar a extração e o rastreamento de vagas no LinkedIn:
captura **título, empresa, link e descrição completa** de cada vaga e exporta
tudo em um arquivo **CSV** (abre direto no Excel).

## Estrutura

```
pegavaga_chrome/
├── manifest.json   # Manifest V3: permissões e content script
├── popup.html      # Interface (botões + contador)
├── popup.js        # Lógica do pop-up e geração do CSV
├── content.js      # Scraping do DOM do LinkedIn + armazenamento
└── README.md
```

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions/`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e selecione a pasta
   `pegavaga_chrome`.
4. Fixe o ícone do **PegaVaga** na barra de ferramentas.

## Como usar

1. Acesse a lista de vagas: `https://www.linkedin.com/jobs/search/...`
2. Clique no ícone da extensão e depois em **▶ Iniciar Varredura/Extração**.
3. O script começa a selecionar os cards automaticamente, lê o painel de
   detalhes de cada vaga (para pegar a descrição), rola a lista para carregar
   mais resultados e salva tudo em `chrome.storage.local`.
4. Acompanhe o contador de **vagas capturadas** no pop-up.
5. Ao terminar (ou quando quiser), clique em **⬇ Exportar para Excel (CSV)**.

### Arquivo gerado

- Nome: `pegavaga_AAAA-MM-DD_HH-MM-SS.csv`
- Colunas: `ID`, `Titulo`, `Empresa`, `Link`, `Descricao`, `Capturado em`
- Separador: `;` (padrão do Excel pt-BR)
- Codificação: UTF-8 com BOM (acentos corretos no Excel)
- Campos sempre entre aspas, com aspas internas duplicadas e quebras de linha
  preservadas dentro do campo `Descricao`.

## Permissões utilizadas

| Permissão        | Motivo                                                        |
| ---------------- | ------------------------------------------------------------- |
| `storage`        | Guardar as vagas capturadas em `chrome.storage.local`.        |
| `activeTab`      | Falar com a aba ativa do LinkedIn a partir do pop-up.         |
| `https://www.linkedin.com/*` | Injetar o `content.js` e ler o DOM das vagas. |

Nenhuma permissão de download é necessária: o CSV é baixado via `Blob` +
`<a download>` gerados no próprio pop-up.

## Mensagens trocadas (popup ↔ content)

| Mensagem                | Direção        | Efeito                                   |
| ----------------------- | -------------- | ---------------------------------------- |
| `PEGAVAGA_START`        | popup → content| Inicia a varredura.                      |
| `PEGAVAGA_STOP`         | popup → content| Interrompe a varredura.                  |
| `PEGAVAGA_PING`         | popup → content| Consulta se está varrendo.               |
| `PEGAVAGA_CLEAR`        | popup → content| Zera o estado em memória e no storage.   |
| `PEGAVAGA_PROGRESS`     | content → popup| Atualiza contador e status em tempo real.|

## Observações importantes

- O DOM do LinkedIn muda com frequência. Todos os seletores estão agrupados no
  objeto `SEL` (topo do `content.js`) com vários fallbacks — se algo parar de
  funcionar, ajuste apenas esse objeto.
- A descrição só existe no painel de detalhes, por isso o script **seleciona
  cada card** durante a varredura. Isso é intencional (automação), mas não
  clica em "Candidatar-se" nem envia formulários.
- Se a extensão foi instalada com uma aba do LinkedIn já aberta, recarregue a
  página (F5) para o `content.js` ser injetado.
- Use de forma responsável, respeitando os Termos de Uso do LinkedIn.
