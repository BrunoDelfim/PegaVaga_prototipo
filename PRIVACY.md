# Política de Privacidade — PegaVaga

**Última atualização:** 13 de outubro de 2026 · **Versão da extensão:** 0.7.4

O PegaVaga é uma extensão de navegador que ajuda a **encontrar vagas no LinkedIn,
candidatar-se pela Candidatura Simplificada dentro das cotas que você escolher e
guardar o resultado numa planilha**. Esta página explica, sem rodeio, **quais
dados a extensão toca e o que ela faz com eles**.

## Resumo em uma linha

**Nada sai do seu navegador:** a extensão não tem servidor, não tem conta, não usa
analytics e não envia seus dados para lugar nenhum.

## O que a extensão guarda

Tudo é gravado em **`chrome.storage.local`** — a área de armazenamento da extensão
**dentro do seu próprio perfil do Chrome**. A extensão **não usa `storage.sync`**,
então esses dados **não são enviados para a sua conta Google**:

| O que                              | Exemplo                                              | Para quê                          |
| ---------------------------------- | ---------------------------------------------------- | --------------------------------- |
| Configuração da busca              | URL de busca, localização, termos                     | Montar as buscas uma por termo    |
| Preferências de candidatura        | cotas por hora/24 h/dia, agendador, ritmo, respostas  | Decidir **quando** e **como** candidatar |
| Vagas capturadas                   | título, empresa, link, descrição, termo, status       | Montar o relatório e a planilha   |
| Histórico de candidaturas          | data e hora de cada envio                             | Calcular as cotas móveis          |
| Descanso por bloqueio              | motivo e hora do fim                                  | Proteger a sua conta              |
| Tema do pop-up                     | claro ou escuro                                       | Lembrar a sua escolha             |

## O que a extensão lê

- A **página de vagas do LinkedIn que você abriu**, para ler título, empresa, link
  e descrição das vagas e para preencher e enviar a Candidatura Simplificada **na
  sua própria sessão** — a extensão **não tem login próprio** e não vê a sua senha.
- As **respostas de formulário que você mesma(o) cadastrou** (por exemplo:
  “Você tem autorização de trabalho? Não”), usadas **apenas** para preencher esses
  formulários de candidatura.

## O que a extensão nunca faz

- ❌ **Não envia dados** para nenhum servidor nosso ou de terceiros.
- ❌ **Não baixa nem executa código de fora**: não há script remoto, e a única
  requisição de rede no código é a leitura de um **ícone da própria extensão**.
- ❌ **Não sincroniza** nada para a sua conta Google (`storage.sync` não é usado).
- ❌ **Não vende, aluga nem compartilha** dados de usuário com ninguém.
- ❌ **Não usa** os dados para publicidade, perfilamento, análise de crédito ou
  qualquer finalidade diferente de “rastrear vagas e candidatar-se”.
- ❌ **Não pede** conta, e-mail, senha, cartão ou qualquer dado pessoal.

O único destino de rede é o **próprio `linkedin.com`**, quando o navegador abre ou
navega nas páginas de vagas por sua causa — exatamente como se você clicasse nelas.

## Como apagar tudo

- **Limpar vagas capturadas** (aba **Início** do pop-up) apaga as vagas e os dados
  da última varredura.
- **Desinstalar a extensão apaga tudo**: o Chrome remove o `chrome.storage.local`
  da extensão junto com ela.
- As candidaturas **já enviadas** vivem na **sua conta do LinkedIn**, não na
  extensão — para removê-las, use a própria interface do LinkedIn.

## Terceiros

A extensão não integra nenhum serviço de terceiros. Ela interage com o
**LinkedIn**, que tem política de privacidade e termos de uso próprios — e
automatizar candidaturas é uma **área cinzenta** desses termos: use por sua conta
e risco (esse aviso também aparece dentro da extensão, no card “Como funciona”).

## Crianças

A extensão não é destinada a menores de 16 anos e não coleta dados de ninguém.

## Mudanças nesta política

Se esta política mudar, a data no topo muda junto. Alterações que afetem **o que é
guardado** são descritas no histórico do repositório
([commits](https://github.com/BrunoDelfim/PegaVaga_prototipo/commits/development)).

## Contato

Dúvidas ou pedidos de remoção: abra uma *issue* em
[github.com/BrunoDelfim/PegaVaga_prototipo/issues](https://github.com/BrunoDelfim/PegaVaga_prototipo/issues).

---

## English summary

PegaVaga is a Chrome extension that automates job tracking and applications on
LinkedIn. **No data leaves your browser**: everything is stored in
`chrome.storage.local` (the extension has no server, no account, no analytics, no
`storage.sync` and no third-party code). It only reads the LinkedIn job pages you
have open — using your own session — plus the form answers you typed, to fill
those forms. Uninstalling the extension deletes all stored data. The only network
destination is linkedin.com itself, exactly as if you had clicked the pages.
