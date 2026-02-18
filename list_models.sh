#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

cd /home/vansh/question_bank
source .env

echo "Listing available Gemini models..."
echo ""

node -e "
const { GoogleGenAI } = require('@google/genai');
const client = new GoogleGenAI({ apiKey: '$GEMINI_API_KEY' });

async function main() {
  const pager = await client.models.list({ config: { pageSize: 50 } });
  for (const model of pager) {
    if (model.name.includes('flash') || model.name.includes('gemini')) {
      const methods = model.supportedActions || model.supportedGenerationMethods || [];
      console.log(model.name, '  →', methods.join(', '));
    }
  }
}
main().catch(e => console.error('Error:', e.message));
"
