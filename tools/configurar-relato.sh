#!/usr/bin/env bash
#
# PegaVaga — configura o entregador dos relatos de erro (env.js)
# =============================================================================
# Escreve o env.js em uma linha de comando, sem editar JavaScript à mão.
# O env.js está no .gitignore e o empacotador o inclui no zip.
#
#   bash tools/configurar-relato.sh --email voce@gmail.com \
#     --endpoint 'https://script.google.com/macros/s/AKfy.../exec' --token senha123
#
#   bash tools/configurar-relato.sh --testar    # manda um relato de teste agora
#   bash tools/configurar-relato.sh --mostrar   # o que está configurado hoje
#   bash tools/configurar-relato.sh --limpar    # desliga o envio (relatos ficam locais)
#
# O passo a passo completo está em tools/RELATO.md.
set -euo pipefail
cd "$(dirname "$0")/.."

ARQUIVO="env.js"
ACAO="salvar"
QUIET=0

EMAIL=""
ENDPOINT=""
TOKEN=""
TROCAR_EMAIL=0
TROCAR_ENDPOINT=0
TROCAR_TOKEN=0

uso() {
  cat <<'TXT'
PegaVaga — configurar o entregador dos relatos de erro

  --email EMAIL       e-mail que recebe os relatos
  --endpoint URL      endereço que entrega (ex.: a URL /exec do Apps Script)
  --token SENHA       senha combinada com o entregador (o TOKEN do script)
  --mostrar           mostra o que está configurado agora (token mascarado)
  --testar            manda um relato de teste e mostra a resposta
  --limpar            zera tudo (o envio volta a ser só local)
  --arquivo CAMINHO   outro arquivo de destino (padrão: env.js)
  -q, --quiet         fala menos
  -h, --help          esta ajuda

Passo a passo com o Google: tools/RELATO.md
TXT
}

avisar() { [ "$QUIET" = "1" ] || echo "$@"; }
erro() { echo "erro: $*" >&2; exit 1; }

# Só mexe no que foi pedido: o resto vem do arquivo atual.
ler_atual() {
  [ -f "$ARQUIVO" ] || return 0
  node -e '
    const fs = require("fs");
    try { eval(fs.readFileSync(process.argv[1], "utf8")); } catch (e) { process.exit(0); }
    const env = globalThis.PegaVagaEnv || {};
    console.log([env.reportEmail, env.reportEndpoint, env.reportToken]
      .map((v) => String(v == null ? "" : v)).join("\t"));
  ' "$ARQUIVO"
}

escapar() { printf "%s" "$1" | sed "s/'/'\\\\''/g"; }

escrever() {
  cat > "$ARQUIVO" <<TXT
/* PegaVaga — configuração de ambiente (local, fora do Git).
 *
 * Gerado por tools/configurar-relato.sh em $(date '+%d/%m/%Y'). Editar à mão é
 * permitido: o script relê estes valores em --mostrar e --testar.
 * Este arquivo NÃO é versionado; o empacotador o inclui no zip. */
globalThis.PegaVagaEnv = {
  reportEmail: '$(escapar "$EMAIL")',
  reportEndpoint: '$(escapar "$ENDPOINT")',
  reportToken: '$(escapar "$TOKEN")',
};
TXT
}

mascarar() {
  local valor="$1"
  if [ -z "$valor" ]; then echo "(vazio)"; return 0; fi
  if [ "${#valor}" -le 6 ]; then echo "***"; return 0; fi
  echo "${valor:0:4}...${valor: -2} (${#valor} caracteres)"
}

mostrar() {
  if [ ! -f "$ARQUIVO" ]; then
    echo "não existe $ARQUIVO — rode sem argumentos para configurar"
    return 0
  fi

  local lidos email endpoint token
  lidos="$(ler_atual)" || true
  email="$(printf '%s' "$lidos" | cut -f1)"
  endpoint="$(printf '%s' "$lidos" | cut -f2)"
  token="$(printf '%s' "$lidos" | cut -f3)"

  echo "Arquivo:   $ARQUIVO"
  echo "Destino:   ${email:-(vazio)}"
  echo "Endpoint:  ${endpoint:-(vazio)}"
  echo "Token:     $(mascarar "$token")"
  echo

  if [ -n "$endpoint" ]; then
    echo "Envio:     LIGADO — o botão \"Enviar diagnóstico\" manda em um clique."
  else
    echo "Envio:     DESLIGADO — o relato fica local (Copiar / Baixar JSON)."
  fi
}

testar() {
  local lidos email endpoint token
  lidos="$(ler_atual)" || true
  email="$(printf '%s' "$lidos" | cut -f1)"
  endpoint="$(printf '%s' "$lidos" | cut -f2)"
  token="$(printf '%s' "$lidos" | cut -f3)"

  [ -n "$endpoint" ] || erro "sem reportEndpoint configurado — nada para testar (use --endpoint)"

  echo "Testando $endpoint ..."

  local payload saida codigo corpo corpo_limpo titulo
  local quando maquina
  quando="$(date '+%d/%m/%Y %H:%M')"
  maquina="$(uname -sr 2>/dev/null || echo 'sistema não identificado') · Node $(node -v 2>/dev/null || echo '?')"

  # O texto abaixo vai no campo `diagnostico` do e-mail. Ele é **de propósito**
  # diferente do relato de verdade: aqui não há navegador, fila nem configuração
  # para enviar (o teste roda fora da extensão), então ele diz o que é e onde
  # esses dados aparecem no relato real — para ninguém achar que a extensão
  # esqueceu de mandar.
  local diagnostico
  diagnostico="PegaVaga — diagnóstico (TESTE MANUAL)
Versão (teste manual) · $maquina
Gerado em $quando

Este é um teste do entregador, feito por tools/configurar-relato.sh — não é um
relato da extensão, e por isso ele NÃO traz navegador, fila nem configuração.

No relato de verdade, este trecho começa com a versão e o navegador/sistema
operacional do usuário (navigator.userAgent) e segue com o estado da fila, a
configuração completa (termos, cotas, horários, filtros, respostas do
formulário) e os últimos erros registrados.

Se este e-mail chegou, o caminho extensão → entregador → e-mail está funcionando."

  payload="$(DIAGNOSTICO="$diagnostico" QUANDO="$quando" node -e '
    const dados = {
      id: "teste-manual",
      motivo: "teste do entregador",
      quando: process.env.QUANDO,
      erros: [
        {
          at: "agora",
          where: "tools/configurar-relato.sh",
          message: "relato de teste, pode ignorar",
        },
      ],
      diagnostico: process.env.DIAGNOSTICO,
    };
    process.stdout.write(JSON.stringify(dados));
  ')"

  # Sem `-X POST`: o `-d` já faz o POST, e no redirecionamento (302) o curl volta
  # para GET — que é como o Web App do Apps Script devolve a resposta. Forçar
  # `-X POST` faz o curl reenviar POST ao endereço de retorno e entrar em laço.
  if ! saida="$(curl -sS -L --max-time 25 "$endpoint" \
      --data-urlencode "token=$token" \
      --data-urlencode "para=$email" \
      --data-urlencode "payload=$payload" \
      -w $'\n__HTTP__%{http_code}' 2>&1)"; then
    echo "FALHOU: não consegui falar com o endereço."
    echo "  $(printf '%s' "$saida" | head -3)"
    echo "  Confira se a URL copiada termina em /exec e se há internet."
    return 1
  fi

  codigo="${saida##*__HTTP__}"
  corpo="${saida%$'\n'__HTTP__*}"
  # O Apps Script responde exatamente "ok" — comparar o corpo inteiro evita
  # confundir uma página de erro do Google (que tem "ok" no meio do HTML) com sucesso.
  corpo_limpo="$(printf '%s' "$corpo" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

  case "$corpo_limpo" in
    ok)
      if [ "$codigo" = "200" ]; then
        echo "OK — o entregador rodou e mandou o e-mail."
        echo "  Veja a caixa de entrada de ${email:-(o e-mail do script)}, inclusive o Spam."
      else
        echo "Resposta 'ok' com HTTP $codigo — confira a caixa de entrada de todos os jeitos."
      fi
      ;;
    'token invalido')
      echo "O endereço respondeu (HTTP $codigo), mas recusou o token."
      echo "  O --token do env.js precisa ser igual ao TOKEN do Apps Script."
      return 1
      ;;
    erro:*)
      echo "O script rodou e falhou (HTTP $codigo):"
      printf '  %s\n' "$(printf '%s' "$corpo_limpo" | head -3)"
      echo "  Abra o Apps Script ▸ Execuções para ver o detalhe."
      return 1
      ;;
    *accounts.google.com*|*'Sign in'*|*'Fazer login'*)
      echo "O Google pediu login (HTTP $codigo) — a implantação não está pública."
      echo "  Apps Script ▸ Implantar ▸ Gerenciar implantações ▸ editar:"
      echo "  \"Quem tem acesso\" precisa ser 'qualquer pessoa'."
      return 1
      ;;
    *)
      echo "Resposta inesperada (HTTP $codigo):"
      if [ "${corpo_limpo#<}" != "$corpo_limpo" ]; then
        # Página HTML: mostrar 60 linhas de <!DOCTYPE> não ajuda ninguém.
        titulo="$(printf '%s' "$corpo_limpo" | grep -o '<title>[^<]*' | head -1 | cut -c8-)"
        echo "  veio uma página HTML (do Google), não a resposta do entregador."
        [ -n "$titulo" ] && echo "  título da página: $titulo"
        echo "  o mais comum aqui é URL copiada errada (precisa terminar em /exec)."
      else
        printf '%s\n' "$(printf '%s' "$corpo" | head -5)"
        echo
        echo "  404/401 costuma ser URL errada (precisa terminar em /exec) ou"
        echo "  implantação removida. Se veio um aviso do Google, confira também o"
        echo "  acesso da implantação."
      fi
      return 1
      ;;
  esac
}

# ------------------------------------------------------------------ argumentos
while [ $# -gt 0 ]; do
  case "$1" in
    --email) EMAIL="${2:-}"; TROCAR_EMAIL=1; shift 2 ;;
    --email=*) EMAIL="${1#*=}"; TROCAR_EMAIL=1; shift ;;
    --endpoint) ENDPOINT="${2:-}"; TROCAR_ENDPOINT=1; shift 2 ;;
    --endpoint=*) ENDPOINT="${1#*=}"; TROCAR_ENDPOINT=1; shift ;;
    --token) TOKEN="${2:-}"; TROCAR_TOKEN=1; shift 2 ;;
    --token=*) TOKEN="${1#*=}"; TROCAR_TOKEN=1; shift ;;
    --arquivo) ARQUIVO="${2:-}"; shift 2 ;;
    --arquivo=*) ARQUIVO="${1#*=}"; shift ;;
    --mostrar) ACAO="mostrar"; shift ;;
    --testar) ACAO="testar"; shift ;;
    --limpar) ACAO="limpar"; shift ;;
    -q|--quiet) QUIET=1; shift ;;
    -h|--help) uso; exit 0 ;;
    *) uso >&2; erro "opção desconhecida: $1" ;;
  esac
done

case "$ACAO" in
  mostrar) mostrar; exit 0 ;;
  testar) testar; exit 0 ;;
esac

# --------------------------------------------------------- valores que ficam
lidos="$(ler_atual)" || true
[ "$TROCAR_EMAIL" = "1" ] || EMAIL="$(printf '%s' "$lidos" | cut -f1)"
[ "$TROCAR_ENDPOINT" = "1" ] || ENDPOINT="$(printf '%s' "$lidos" | cut -f2)"
[ "$TROCAR_TOKEN" = "1" ] || TOKEN="$(printf '%s' "$lidos" | cut -f3)"

if [ "$ACAO" = "limpar" ]; then
  EMAIL=""
  ENDPOINT=""
  TOKEN=""
fi

# ------------------------------------------------------------- validação
if [ -n "$EMAIL" ] && [ "${EMAIL#*@}" = "$EMAIL" ]; then
  erro "--email precisa de um @ (recebi: $EMAIL)"
fi

if [ -n "$ENDPOINT" ]; then
  case "$ENDPOINT" in
    https://*) ;;
    http://*) avisar "AVISO: endpoint em http:// — prefira https://" ;;
    *) erro "--endpoint precisa começar com https:// (recebi: $ENDPOINT)" ;;
  esac
fi

if [ -n "$ENDPOINT" ] && [ -z "$TOKEN" ]; then
  avisar "AVISO: entregador sem --token — quem descobrir a URL pode postar nela."
fi

if [ -n "$ENDPOINT" ] && [ -z "$EMAIL" ]; then
  avisar "AVISO: sem --email — o e-mail vai para o endereço fixado no script do Google."
fi

escrever

avisar "Pronto: $ARQUIVO"
avisar "  Destino:  ${EMAIL:-(o do script)}"
avisar "  Endpoint: ${ENDPOINT:-(nenhum — relatos ficam locais)}"
avisar "  Token:    $(mascarar "$TOKEN")"

if [ -z "$ENDPOINT" ]; then
  avisar
  avisar "O envio está DESLIGADO: os relatos ficam em Configurações ▸ Diagnóstico,"
  avisar "com Copiar e Baixar JSON. Nada sai do navegador."
else
  avisar
  avisar "Teste antes de empacotar:  bash tools/configurar-relato.sh --testar"
fi

avisar "Depois:  bash tools/empacotar.sh <versão>   (o env.js entra no zip)"

