import { GoogleGenAI } from "@google/genai";
import { type Question } from "../question_bank/models.js";
import type { Config } from "../question_bank/config.js";
import type { PageContent } from "../question_bank/models.js";

// ── JSON Schema for Gemini's structured output ─────────────────────────────
// Using responseSchema makes Gemini generate structured output directly,
// which is faster than asking it to produce free-form JSON.
const QUESTION_SCHEMA = {
    type: "OBJECT" as const,
    properties: {
        questions: {
            type: "ARRAY" as const,
            items: {
                type: "OBJECT" as const,
                properties: {
                    topic: { type: "STRING" as const },
                    type: {
                        type: "STRING" as const,
                        enum: ["MCQ", "Short Answer", "Long Answer", "True/False", "Fill in the Blank", "Numerical"],
                    },
                    difficulty: {
                        type: "STRING" as const,
                        enum: ["Easy", "Medium", "Hard"],
                    },
                    question: { type: "STRING" as const },
                    options: {
                        type: "ARRAY" as const,
                        items: { type: "STRING" as const },
                        nullable: true,
                    },
                    answer: { type: "STRING" as const, nullable: true },
                    source_page: { type: "STRING" as const },
                },
                required: ["topic", "type", "difficulty", "question", "source_page"],
            },
        },
    },
    required: ["questions"],
};

// ── Compact prompt (shorter = faster LLM processing) ────────────────────────
const PROMPT = `Extract ALL questions, exercises, and problems with their answers from this text.

For each question return: topic, type (MCQ/Short Answer/Long Answer/True\\/False/Fill in the Blank/Numerical), difficulty (Easy=remember\\/understand, Medium=apply\\/analyze, Hard=evaluate\\/create), question text, options (MCQ only, else null), answer (if found anywhere, else null), source_page.

Preserve math notation in LaTeX. Include question numbers if present. Extract EVERY question — do not skip any.

The text below is from an educational document:

`;

/**
 * Analyze extracted pages by sending all text in a single API call.
 * No chunking needed — goes directly from extracted text to LLM.
 * Uses responseSchema for faster structured output.
 */
export async function analyzeDirect(
    pages: PageContent[],
    config: Config,
    onProgress?: (message: string) => void
): Promise<Question[]> {
    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

    // Filter out empty/near-empty pages (< 20 chars = page numbers, headers, etc.)
    const usefulPages = pages.filter((p) => p.text.length > 20);
    onProgress?.(`Filtered to ${usefulPages.length}/${pages.length} pages with content`);

    // Build a single text block from all pages
    const fullText = usefulPages
        .map((p) => `--- Page ${p.pageNumber} ---\n${p.text}`)
        .join("\n\n");

    const inputChars = fullText.length;
    const estimatedTokens = Math.ceil(inputChars / 4);
    onProgress?.(`Sending ${estimatedTokens.toLocaleString()} estimated tokens to Gemini...`);

    // Single API call with responseSchema
    const maxAttempts = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const response = await client.models.generateContent({
                model: config.geminiModel,
                contents: PROMPT + fullText,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: QUESTION_SCHEMA,
                    temperature: 0.1,
                },
            });

            const text = response.text;
            if (!text) throw new Error("Empty response from Gemini API");

            const parsed = JSON.parse(text);
            const questions: Question[] = parsed.questions ?? [];
            onProgress?.(`Extracted ${questions.length} questions`);
            return questions;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            if (lastError.message.includes("429") || lastError.message.includes("RATE_LIMIT")) {
                const delayMatch = lastError.message.match(/retryDelay.*?(\d+)s/);
                const serverDelay = delayMatch ? parseInt(delayMatch[1], 10) : 35;
                const wait = Math.max(serverDelay, 35) * 1000 + (attempt * 5000);
                onProgress?.(`Rate limited. Waiting ${wait / 1000}s before retry...`);
                await new Promise((resolve) => setTimeout(resolve, wait));
            } else if (attempt < maxAttempts - 1) {
                const wait = 3000 * (attempt + 1);
                onProgress?.(`Error: ${lastError.message}. Retrying in ${wait / 1000}s...`);
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
        }
    }

    throw new Error(`Failed after ${maxAttempts} attempts: ${lastError?.message}`);
}
