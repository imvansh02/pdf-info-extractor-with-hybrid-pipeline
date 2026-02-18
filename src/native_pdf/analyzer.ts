import { readFileSync, statSync } from "fs";
import { GoogleGenAI } from "@google/genai";
import { QuestionBankSchema, type Question } from "../question_bank/models.js";
import type { Config } from "../question_bank/config.js";

// ── Constants ───────────────────────────────────────────────────────────────
const INLINE_SIZE_LIMIT = 20 * 1024 * 1024; // 20 MB for inline base64

// ── Prompt ──────────────────────────────────────────────────────────────────
function buildNativePrompt(): string {
    return `You are an expert at reading educational materials (textbooks, notes, past papers, worksheets).

YOUR TASK: EXTRACT all existing questions, exercises, problems, and their answers from the PDF document provided.
Do NOT invent or create new questions — only extract what is already present in the source material.

For each question found, return a JSON object with these fields:
- "topic": (string) The specific subject or concept being tested
- "type": (string) One of: "MCQ", "Short Answer", "Long Answer", "True/False", "Fill in the Blank", "Numerical"
- "difficulty": (string) One of: "Easy", "Medium", "Hard"
    - Easy = Remember / Understand (Bloom's Taxonomy levels 1-2)
    - Medium = Apply / Analyze (Bloom's Taxonomy levels 3-4)
    - Hard = Evaluate / Create (Bloom's Taxonomy levels 5-6)
- "question": (string) The exact question text. Preserve any mathematical notation using LaTeX syntax (e.g., $x^2$, \\frac{a}{b}).
- "options": (string[] | null) If MCQ, list all answer choices. Otherwise null.
- "answer": (string | null) The answer or solution if provided ANYWHERE in the document (answer keys, footnotes, etc.). If no answer is found, use null.
- "source_page": (string) The page number(s) where the question appears, e.g. "42" or "42-43".

RULES:
1. Extract EVERY question you find — do not skip any.
2. Always look for answers, even if they are on different pages from the question.
3. Preserve all mathematical notation in LaTeX format.
4. If a question number or label is present (e.g., "Q5", "Exercise 3.2"), include it in the question text.
5. For MCQs, extract all options exactly as written.
6. Classify difficulty based on the cognitive level required, not the length of the question.

Return ONLY a JSON object with a single key "questions" containing an array of question objects.
Do not include any text outside the JSON. Example format:
{"questions": [{"topic": "...", "type": "...", "difficulty": "...", "question": "...", "options": null, "answer": "...", "source_page": "..."}]}

If no questions are found in this PDF, return: {"questions": []}`;
}

// ── Core Analysis Function ──────────────────────────────────────────────────

/**
 * Analyze a PDF by sending it directly to Gemini (no text extraction needed).
 *
 * For files ≤20 MB: uses inline base64 (zero latency upload)
 * For files >20 MB: uses the File API (server-side upload, then reference)
 */
export async function analyzeNativePDF(
    pdfPath: string,
    config: Config,
    onProgress?: (message: string) => void
): Promise<Question[]> {
    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const prompt = buildNativePrompt();

    const fileSize = statSync(pdfPath).size;
    const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(1);

    let contentParts: Parameters<typeof client.models.generateContent>[0]["contents"];

    if (fileSize <= INLINE_SIZE_LIMIT) {
        // ── Small file: inline base64 (faster, no upload step) ─────────
        onProgress?.(`Sending PDF (${fileSizeMB} MB) inline to Gemini...`);

        const pdfBuffer = readFileSync(pdfPath);
        const base64Data = pdfBuffer.toString("base64");

        contentParts = [
            { inlineData: { mimeType: "application/pdf", data: base64Data } },
            prompt,
        ];
    } else {
        // ── Large file: File API upload ────────────────────────────────
        onProgress?.(`Uploading PDF (${fileSizeMB} MB) via File API...`);

        const uploadedFile = await client.files.upload({
            file: pdfPath,
            config: { mimeType: "application/pdf" },
        });

        if (!uploadedFile.uri) {
            throw new Error("File upload succeeded but no URI was returned.");
        }

        onProgress?.("Upload complete. Analyzing PDF...");

        contentParts = [
            { fileData: { fileUri: uploadedFile.uri, mimeType: "application/pdf" } },
            prompt,
        ];
    }

    // ── Send to Gemini ─────────────────────────────────────────────────
    onProgress?.("Waiting for Gemini response...");

    // Retry up to 3 times with exponential backoff
    let lastError: Error | null = null;
    const maxAttempts = 2; // Keep low to preserve daily quota (20 RPD)
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const response = await client.models.generateContent({
                model: config.geminiModel,
                contents: contentParts,
                config: {
                    responseMimeType: "application/json",
                    temperature: 0.1,
                },
            });

            const text = response.text;
            if (!text) {
                throw new Error("Empty response from Gemini API");
            }

            // Parse and validate through Zod
            const parsed = JSON.parse(text);
            const validated = QuestionBankSchema.parse(parsed);

            onProgress?.(`Extracted ${validated.questions.length} questions.`);
            return validated.questions;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            if (lastError.message.includes("429") || lastError.message.includes("RATE_LIMIT")) {
                // Parse retryDelay from the error if present, otherwise use 35s+
                const delayMatch = lastError.message.match(/retryDelay.*?(\d+)s/);
                const serverDelay = delayMatch ? parseInt(delayMatch[1], 10) : 35;
                const wait = Math.max(serverDelay, 35) * 1000 + (attempt * 5000);
                onProgress?.(`Rate limited. Waiting ${wait / 1000}s before retry ${attempt + 2}/3...`);
                await new Promise((resolve) => setTimeout(resolve, wait));
            } else if (attempt < 2) {
                const wait = 3000 * (attempt + 1);
                onProgress?.(`Error: ${lastError.message}. Retrying in ${wait / 1000}s...`);
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
        }
    }

    throw new Error(`Failed to analyze PDF after ${maxAttempts} attempts: ${lastError?.message}`);
}
