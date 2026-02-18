import { GoogleGenAI } from "@google/genai";
import pLimit from "p-limit";
import { QuestionBankSchema, type Question, type TextChunk } from "./models.js";
import { buildExtractionPrompt } from "./prompts/extract.js";
import type { Config } from "./config.js";

/**
 * Rate limiter that enforces requests-per-minute.
 * Sleeps between bursts to stay within the free tier (15 RPM).
 */
class RateLimiter {
    private timestamps: number[] = [];

    constructor(private maxPerMinute: number) { }

    async wait(): Promise<void> {
        const now = Date.now();
        // Remove timestamps older than 1 minute
        this.timestamps = this.timestamps.filter((t) => now - t < 60_000);

        if (this.timestamps.length >= this.maxPerMinute) {
            const oldestInWindow = this.timestamps[0]!;
            const waitMs = 60_000 - (now - oldestInWindow) + 100; // +100ms buffer
            await new Promise((resolve) => setTimeout(resolve, waitMs));
        }

        this.timestamps.push(Date.now());
    }
}

/**
 * Analyze a single chunk by sending it to the Gemini API and parsing
 * the structured JSON response into validated Question objects.
 */
async function analyzeChunk(
    client: GoogleGenAI,
    model: string,
    chunk: TextChunk,
    rateLimiter: RateLimiter
): Promise<Question[]> {
    const prompt = buildExtractionPrompt(chunk.text, chunk.startPage, chunk.endPage);

    // Wait for rate limit clearance
    await rateLimiter.wait();

    // Retry up to 3 times with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const response = await client.models.generateContent({
                model,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    temperature: 0.1, // Low temperature for faithful extraction
                },
            });

            const text = response.text;
            if (!text) {
                throw new Error("Empty response from Gemini API");
            }

            // Parse and validate through Zod
            const parsed = JSON.parse(text);
            const validated = QuestionBankSchema.parse(parsed);
            return validated.questions;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            // If rate limited (429), wait longer
            if (lastError.message.includes("429") || lastError.message.includes("RATE_LIMIT")) {
                const wait = Math.pow(2, attempt + 2) * 1000; // 4s, 8s, 16s
                await new Promise((resolve) => setTimeout(resolve, wait));
            } else if (attempt < 2) {
                // Brief pause before retry for other errors
                await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
            }
        }
    }

    console.error(
        `  ⚠ Failed to analyze chunk ${chunk.chunkIndex} (pp. ${chunk.startPage}–${chunk.endPage}): ${lastError?.message}`
    );
    return []; // Graceful degradation — skip this chunk rather than crash
}

/**
 * Analyze all chunks in parallel (with concurrency limit) and merge results.
 */
export async function analyzeAllChunks(
    chunks: TextChunk[],
    config: Config,
    onChunkComplete?: (chunkIndex: number, questionsFound: number) => void
): Promise<Question[]> {
    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });
    const rateLimiter = new RateLimiter(config.maxRequestsPerMinute);
    const limit = pLimit(config.maxConcurrentRequests);

    const allQuestions: Question[] = [];

    const tasks = chunks.map((chunk) =>
        limit(async () => {
            const questions = await analyzeChunk(client, config.geminiModel, chunk, rateLimiter);
            allQuestions.push(...questions);
            onChunkComplete?.(chunk.chunkIndex, questions.length);
            return questions;
        })
    );

    await Promise.all(tasks);

    return allQuestions;
}
