# 📚 Question Bank Extractor

Extract existing questions and answers from PDF files (textbooks, notes, past papers) and output a structured, compilable **LaTeX question bank** — categorised by topic, question type, and difficulty.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up your API key (free)
cp .env.example .env
# Edit .env and paste your Gemini API key
# Get one at: https://aistudio.google.com/apikey

# 3. Run extraction
npx tsx src/index.ts extract your-pdf-file.pdf -o output/questions.tex

# 4. Compile the LaTeX
pdflatex output/questions.tex
```

## CLI Options

```
npx tsx src/index.ts extract <pdf-file> [options]

Options:
  -o, --output <path>       Output .tex file (default: output/questions.tex)
  -m, --model <model>       Gemini model (default: gemini-2.0-flash)
  -t, --types <types>       Filter question types (comma-separated)
  -d, --difficulty <levels> Filter difficulty (Easy, Medium, Hard)
  --max-questions <n>       Limit total questions
  --include-answers         Include answer key (default: true)
  --no-include-answers      Exclude answer key
  --json                    Also output raw JSON
```

## How It Works

1. **PDF Extraction** — Uses `pdfjs-dist` to extract text from every page
2. **Chunking** — Splits large documents into LLM-context-sized chunks
3. **AI Analysis** — Sends chunks to Gemini 2.0 Flash to identify and extract Q&A
4. **LaTeX Output** — Generates a compilable `.tex` file grouped by topic and difficulty

## Free Tier Limits

Uses the Gemini free tier (no cost):
- 15 requests/minute, 1,500 requests/day
- Built-in rate limiting keeps you within bounds automatically
