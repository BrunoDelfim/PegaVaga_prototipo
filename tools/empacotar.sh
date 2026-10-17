#!/usr/bin/env bash
# =============================================================================
# PegaVaga - empacotar.sh
# Gera o .zip que vai para a Chrome Web Store.
#
#   bash tools/empacotar.sh            # empacota o commit atual (HEAD)
#   bash tools/empacotar.sh v0.7.4     # empacota uma tag (é o certo para publicar:
#                                      # o zip tem de ser o que a tag marca)
#
# Dois detalhes que a loja cobra:
#   1. "manifest.json na raiz do zip, não dentro de uma pasta" (docs da Chrome
#      Web Store) — por isso não usamos --prefix no git archive;
#   2. descrição do manifest com no máximo 132 caracteres (o script avisa).
#
# Como o pacote sai de `git archive`, entram só arquivos **versionados** e da
# lista explícita abaixo: ficam de fora `tests/`, `.github/`, os `.md` e o `.git`.
# Não precisa de `zip` instalado — o próprio git monta o zip.
# =============================================================================

set -euo pipefail

cd "$(dirname "$0")/.."

REF="${1:-HEAD}"
OUT_DIR="dist"

# Tudo o que a extensão precisa para rodar (a loja não quer o resto).
FILES=(
  manifest.json
  shared.js
  background.js
  content.js
  popup.html
  popup.js
  ajuda.html
  ajuda.js
  icons
)

if ! git rev-parse --verify --quiet "${REF}^{commit}" >/dev/null; then
  echo "ERRO: ref não encontrado: $REF" >&2
  echo "      Use uma tag (ex.: v0.7.4) ou deixe vazio para empacotar o HEAD." >&2
  exit 1
fi

VERSION="$(node -p "require('./manifest.json').version")"
REF_VERSION="$(git show "$REF:manifest.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).version")"
DESC_LEN="$(git show "$REF:manifest.json" | node -p "JSON.parse(require('fs').readFileSync(0, 'utf8')).description.length")"
OUT="$OUT_DIR/pegavaga-$VERSION.zip"

# Empacotar a tag errada é fácil: avisa quando o HEAD e o ref discordam.
if [ "$REF_VERSION" != "$VERSION" ]; then
  echo "AVISO: o manifest.json do commit atual diz $VERSION, mas $REF diz $REF_VERSION." >&2
  echo "       O zip sai com $REF_VERSION (o conteúdo do ref escolhido)." >&2
fi

if [ "$DESC_LEN" -gt 132 ]; then
  echo "AVISO: a descrição do manifest tem $DESC_LEN caracteres; a loja pede até 132." >&2
fi

# O teste é a rede de segurança: não empacota o que não passa.
echo "Rodando os testes antes de empacotar..."
if ! TEST_OUT="$(node tests/pegavaga.test.js)"; then
  echo "$TEST_OUT"
  echo "ERRO: os testes falharam; nenhum zip foi gerado." >&2
  exit 1
fi
echo "$TEST_OUT" | tail -n 3

mkdir -p "$OUT_DIR"
rm -f "$OUT"
git archive --format=zip -o "$OUT" "$REF" -- "${FILES[@]}"

if command -v unzip >/dev/null 2>&1; then
  # A lista vai para uma variável e o grep lê por herestring: com `unzip | grep -q`
  # o grep fecha o cano assim que encontra a linha, o unzip morre com SIGPIPE e o
  # `pipefail` reprovava a verificação **mesmo com o zip certo**.
  conteudo="$(unzip -Z1 "$OUT")"

  if grep -qx 'manifest.json' <<< "$conteudo"; then
    echo "ok: manifest.json está na raiz do zip"
  else
    echo "ERRO: manifest.json não está na raiz do zip." >&2
    exit 1
  fi

  # Ícones fora do git (arquivo novo não versionado) deixariam a extensão sem
  # ícone na loja — é barato conferir e caro descobrir depois.
  if grep -q '^icons/.*\.png$' <<< "$conteudo"; then
    echo "ok: os ícones entraram no pacote"
  else
    echo "ERRO: o zip saiu sem os ícones (confira se estão versionados)." >&2
    exit 1
  fi

  # O env.js guarda o destinatário dos relatos e fica **fora do git**: o git
  # archive só empacota o que é versionado, então ele entra aqui, depois. Sem ele
  # a extensão funciona (relatos ficam locais), mas o aviso é explícito.
  if [ -f env.js ]; then
    if command -v python3 >/dev/null 2>&1; then
      python3 - "$OUT" <<'PY'
import sys
import zipfile

with zipfile.ZipFile(sys.argv[1], 'a') as pacote:
    pacote.write('env.js', 'env.js')
PY
      echo "ok: env.js incluído no pacote (destinatário dos relatos)"
    else
      echo "AVISO: env.js existe, mas sem python3 ele não entrou no zip." >&2
    fi

    if grep -qE "reportEndpoint:[[:space:]]*''" env.js; then
      echo "AVISO: env.js está sem entregador (reportEndpoint vazio): os relatos ficam locais." >&2
    fi
  else
    echo "AVISO: sem env.js — o pacote sai sem destinatário (os relatos ficam locais)." >&2
  fi

  conteudo="$(unzip -Z1 "$OUT")"
  echo "Conteúdo de $(basename "$OUT"):"
  sed 's/^/  /' <<< "$conteudo"
else
  echo "(sem unzip para listar o conteúdo; o zip foi gerado assim mesmo)"
fi

echo "Pronto: $OUT ($(du -h "$OUT" | cut -f1))"
