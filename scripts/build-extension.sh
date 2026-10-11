#!/bin/sh
# Gera dist/nexo-<versão>.zip só com os arquivos da extensão (pronto para a Chrome Web Store).
set -eu
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./manifest.json').version")
mkdir -p dist && rm -f "dist/nexo-$VERSION.zip"
zip -qr "dist/nexo-$VERSION.zip" manifest.json *.js *.css *.html icons/*.png
echo "dist/nexo-$VERSION.zip"
