#!/bin/zsh
set -e
cd "$(dirname "$0")"
VERSION=$(python3 -c "import json; print(json.load(open('manifest.json'))['version'])")
OUT="laftel-plus-v${VERSION}.zip"
rm -f "$OUT"
zip -r "$OUT" manifest.json content.js inject.js popup.html popup.css popup.js icons \
  -x "*.DS_Store"
echo "생성 완료: $OUT"
