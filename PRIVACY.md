# Política de Privacidade — PegaVaga

**Última atualização:** 13 de outubro de 2026

O PegaVaga é uma extensão de navegador que ajuda a **encontrar vagas no LinkedIn,
candidatar-se pela Candidatura Simplificada dentro das cotas que você escolher e
guardar o resultado numa planilha**. Esta página explica, sem rodeio, **quais
dados a extensão toca e o que ela faz com eles**.

## Resumo em uma linha

**Nada sai do seu navegador** — com **uma** exceção: se você clicar em **“Enviar
diagnóstico”** (na notificação de erro ou em Configurações → Diagnóstico), o
relato de erro é enviado para o endereço configurado por quem publicou a
extensão. Fora desse clique, a extensão não tem servidor, não tem conta, não usa
analytics e não transmite nada.

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

## Relatos de erro (opcional, só no seu clique)

Quando a automação encontra um problema (uma rajada de erros ou a página sem a
lista de vagas), a extensão **monta um relato e o guarda no seu navegador**. Ela
te avisa por notificação, com dois caminhos:

- **Enviar diagnóstico** → envia o relato para o e-mail configurado por quem
  publicou a extensão: é o **único** momento em que algo sai do navegador;
- **Manter local** → o relato fica só no seu computador, na lista em
  **Configurações → Diagnóstico**, onde você pode **copiar** ou **baixar em JSON**
  quando (e se) quiser.

**O que vai no relato:** a versão da extensão, o navegador, o resumo da varredura
(situação, contagens, última execução), a sua **configuração** (buscas, cotas,
ritmo, agendador e as respostas de formulário que você cadastrou) e os **últimos
erros** com hora e trecho — é esse conjunto que permite diagnosticar. **Você vê o
texto antes**: o mesmo conteúdo está no botão *Copiar diagnóstico*, que não envia
nada.

**Não é enviado:** as vagas capturadas, os links das vagas, o CSV, seus dados de
login (a extensão não tem login) nem qualquer outra coisa.

## O que a extensão nunca faz

- ❌ **Não envia dados por conta própria**: o único envio que existe é o **relato de
  erro**, e ele só sai quando **você** clica em *Enviar diagnóstico*.
- ❌ **Não envia as vagas, os links nem o CSV** para lugar nenhum.
- ❌ **Não baixa nem executa código de fora**: não há script remoto, e a única
  requisição de rede além do relato é a leitura de um **ícone da própria
  extensão**.
- ❌ **Não sincroniza** nada para a sua conta Google (`storage.sync` não é usado).
- ❌ **Não vende, aluga nem compartilha** dados de usuário com ninguém.
- ❌ **Não usa** os dados para publicidade, perfilamento, análise de crédito ou
  qualquer finalidade diferente de “rastrear vagas e candidatar-se”.
- ❌ **Não pede** conta, e-mail, senha, cartão ou qualquer dado pessoal.

Fora o relato, o único destino de rede é o **próprio `linkedin.com`**, quando o
navegador abre ou navega nas páginas de vagas por sua causa — exatamente como se
você clicasse nelas.

## Como apagar tudo

- **Limpar vagas capturadas** (aba **Início** do pop-up) apaga as vagas e os dados
  da última varredura.
- **Desinstalar a extensão apaga tudo**: o Chrome remove o `chrome.storage.local`
  da extensão junto com ela.
- As candidaturas **já enviadas** vivem na **sua conta do LinkedIn**, não na
  extensão — para removê-las, use a própria interface do LinkedIn.
- Os **relatos de erro** ficam no `chrome.storage.local` (a extensão guarda os
  últimos 10): dá para **descartar** cada um em Configurações → Diagnóstico, e o
  botão **Limpar vagas capturadas** não mexe neles (são o histórico de problemas).
  Desinstalar apaga tudo, incluindo os relatos.

## Terceiros

A extensão não integra nenhum serviço de terceiros. Ela interage com o
**LinkedIn**, que tem política de privacidade e termos de uso próprios — e
automatizar candidaturas é uma **área cinzenta** desses termos: use por sua conta
e risco (esse aviso também aparece dentro da extensão, no card “Como funciona”).

Quando **você** envia um relato de erro, ele passa pelo serviço de e-mail que o
publicador configurou (e chega na caixa de entrada dele); fora desse clique, nada
sai do seu navegador.

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
LinkedIn. Everything is stored in `chrome.storage.local` (no server, no account,
no analytics, no `storage.sync`, no third-party code). It only reads the LinkedIn
job pages you have open — using your own session — plus the form answers you
typed, to fill those forms. Uninstalling the extension deletes all stored data.

The only time anything leaves the browser is when **you click “Send diagnostics”**
on an error report: the report (extension version, browser, your configuration
and the latest errors) is sent to the address configured by the publisher. You can
instead keep it local — copy it or download it as JSON. Job data, links and the
CSV are never transmitted. The only other network destination is linkedin.com
itself, exactly as if you had clicked the pages.
