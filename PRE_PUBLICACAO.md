# PegaVaga — Checklist pré-publicação

Plano de trabalho para sair da beta e publicar na **Chrome Web Store**.
Cada item diz **por quê** e **como fazer**; ao concluir, troque `[ ]` por `[x]` e
preencha a linha **Feito em** com a versão e o commit.

**Progresso:** 2 de 14 itens · **Versão:** a que está no `manifest.json`

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

- [ ] **2. Política de privacidade + declaração de uso de dados**
  A Chrome Web Store exige a política **e** o preenchimento do formulário de
  “Data usage”. O texto é simples: tudo fica em `chrome.storage.local` do
  próprio navegador; nada é enviado para servidor nenhum.
  *Como:* criar `PRIVACY.md` e linkar no item da loja.
  *Feito em:* —

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
  *Feito em:* —

- [ ] **5. Teste em perfil limpo (smoke test completo)**
  Abrir um perfil novo do Chrome, instalar a extensão e percorrer o
  `tests/SMOKE_TEST.md` inteiro (nada de dados antigos escondendo problema).
  *Feito em:* —

## 🟠 Fortes (antes ou logo depois de publicar)

- [ ] **6. CI no GitHub Actions**
  Rodar `node tests/pegavaga.test.js` a cada push (o teste já sai com código 1
  quando falha). Protege de regressão sem ninguém precisar lembrar.
  *Como:* `.github/workflows/testes.yml` com `node-version: 20`.
  *Feito em:* —

- [ ] **7. Botão “copiar diagnóstico”**
  Sem isso, reportar bug é chato. Hoje há **24 `catch` silenciosos** no
  `content.js`, então o erro desaparece sem deixar rastro.
  *Como:* guardar os erros num buffer (últimos ~50), somar versão + configuração
  e copiar para a área de transferência.
  *Feito em:* —

- [ ] **8. Modo simulação (dry-run)**
  Varre e preenche o formulário, mas **não clica em enviar**. Deixa a primeira
  experiência segura (e é um bom argumento na descrição da loja).
  *Como:* opção em Candidaturas; no `runApplyFlow`, parar antes do envio.
  *Feito em:* —

- [ ] **9. Backup/restauração da configuração**
  Hoje, limpar ou reinstalar perde tudo. Exportar/importar um JSON resolve.
  *Feito em:* —

- [ ] **10. Empacotamento (zip + tag/release)**
  Script para gerar o `.zip` de publicação (fora `tests/`, `.git`, `.md`) e uma
  **tag** no git (ex.: `v0.7.0`).
  *Feito em:* —

## 🟢 Polimento (depois que a base estiver no ar)

- [ ] **11. Badge no ícone com as candidaturas do dia**
  O ícone já tem a luzinha de status; o badge mostraria o total do dia.
  *Feito em:* —

- [ ] **12. Notificação ao terminar a varredura**
  Hoje só existe a notificação de “preciso de ajuda”. Avisar quando a fila
  termina é útil para quem deixa rodando em segundo plano.
  *Feito em:* —

- [ ] **13. Atualizar o `tests/SMOKE_TEST.md`**
  Incluir o que mudou: abas (Início/Configurações), lâmpada (tema), card “Vagas
  por termo”, tooltips/destaques dos gráficos e o toast.
  *Feito em:* —

- [ ] **14. i18n (pt/en)**
  O código já reconhece rótulos em português e inglês; falta a interface.
  *Feito em:* —

---

## Ordem sugerida

**Pacote mínimo para publicar:** `1 → 3 → 6 → 10 → 13` (risco de storage, aviso
no app, CI, empacotamento/tag e checklist atualizado).

**Se der, incluir o `8` (dry-run)** — é o que mais reduz surpresa no primeiro uso.

**Depois:** `2` e `4` (material da loja) ficam mais fáceis quando os recursos
estiverem congelados, e `11`, `12`, `14` são tranquilamente pós-publicação.

---

## Registro

| Data | Item | Versão | Commit |
| --- | --- | --- | --- |
| 13/10/2026 | Checklist criado | `0.6.9` | — |
| 13/10/2026 | 1. Teto de armazenamento | `0.7.2`–`0.7.3` | `ced7d36` |
| 13/10/2026 | 3. Aviso de risco no app | `0.7.4` | `6ea0976` |

