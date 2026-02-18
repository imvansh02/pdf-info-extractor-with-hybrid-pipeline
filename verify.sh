#!/bin/bash
set -e

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd /home/vansh/question_bank

echo "=== TypeScript Check ==="
npx tsc --noEmit 2>&1
echo "TypeScript: OK"

echo ""
echo "=== CLI Help ==="
npx tsx src/index.ts --help 2>&1

echo ""
echo "=== Extract Command Help ==="
npx tsx src/index.ts extract --help 2>&1

echo ""
echo "=== ALL CHECKS PASSED ==="
