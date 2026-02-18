#!/bin/bash
set -e

# Load nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

# Install Node 22 if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 22..."
    nvm install 22
fi

echo "Node: $(node --version)"
echo "npm: $(npm --version)"

# Install project dependencies
cd /home/vansh/question_bank
echo "Installing npm dependencies..."
npm install

echo ""
echo "Setup complete!"
