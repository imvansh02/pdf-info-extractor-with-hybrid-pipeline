import { GoogleGenAI } from "@google/genai";
import type { Question } from "../question_bank/models.js";
import type { Config } from "../question_bank/config.js";

// ── Schema for classification-only response ─────────────────────────────────
// Much smaller than full extraction — only topic + difficulty per question.
const CLASSIFICATION_SCHEMA = {
    type: "OBJECT" as const,
    properties: {
        classifications: {
            type: "ARRAY" as const,
            items: {
                type: "OBJECT" as const,
                properties: {
                    index: { type: "INTEGER" as const },
                    topic: { type: "STRING" as const },
                    difficulty: {
                        type: "STRING" as const,
                        enum: ["Easy", "Medium", "Hard"],
                    },
                },
                required: ["index", "topic", "difficulty"],
            },
        },
    },
    required: ["classifications"],
};

const CLASSIFY_PROMPT = `Classify each question below by topic and difficulty.
- topic: specific subject concept (e.g., "Real Numbers", "Quadratic Equations", "Probability")
- difficulty: Easy (remember/understand), Medium (apply/analyze), Hard (evaluate/create)

Return a classification for each question using its index number.

Questions:
`;

/**
 * Classify regex-extracted questions using a lightweight LLM call.
 * Only sends question text (not full PDF), asking for topic + difficulty.
 * ~10x less input than full extraction = much faster.
 */
export async function classifyQuestions(
    questions: Question[],
    config: Config,
    onProgress?: (message: string) => void
): Promise<Question[]> {
    if (questions.length === 0) return questions;

    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

    // Build compact question list — just index + question text
    const questionList = questions
        .map((q, i) => `[${i}] ${q.question}${q.options ? " Options: " + q.options.join(", ") : ""}`)
        .join("\n");

    const inputChars = questionList.length;
    onProgress?.(`Classifying ${questions.length} questions (~${Math.ceil(inputChars / 4).toLocaleString()} tokens)...`);

    const maxAttempts = 2;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            const response = await client.models.generateContent({
                model: config.geminiModel,
                contents: CLASSIFY_PROMPT + questionList,
                config: {
                    responseMimeType: "application/json",
                    responseSchema: CLASSIFICATION_SCHEMA,
                    temperature: 0.1,
                },
            });

            const text = response.text;
            if (!text) throw new Error("Empty response from Gemini API");

            const parsed = JSON.parse(text);
            const classifications: { index: number; topic: string; difficulty: string }[] =
                parsed.classifications ?? [];

            // Merge classifications back into questions
            const result = questions.map((q, i) => {
                const cls = classifications.find((c) => c.index === i);
                return {
                    ...q,
                    topic: cls?.topic ?? q.topic,
                    difficulty: (cls?.difficulty ?? q.difficulty) as Question["difficulty"],
                };
            });

            onProgress?.(`Classified ${classifications.length}/${questions.length} questions`);
            return result;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));

            if (lastError.message.includes("429") || lastError.message.includes("RATE_LIMIT")) {
                const delayMatch = lastError.message.match(/retryDelay.*?(\d+)s/);
                const serverDelay = delayMatch ? parseInt(delayMatch[1], 10) : 35;
                const wait = Math.max(serverDelay, 35) * 1000 + (attempt * 5000);
                onProgress?.(`Rate limited. Waiting ${wait / 1000}s...`);
                await new Promise((resolve) => setTimeout(resolve, wait));
            } else if (attempt < maxAttempts - 1) {
                const wait = 3000 * (attempt + 1);
                onProgress?.(`Error: ${lastError.message}. Retrying in ${wait / 1000}s...`);
                await new Promise((resolve) => setTimeout(resolve, wait));
            }
        }
    }

    // On failure, return questions with original (placeholder) classifications
    onProgress?.(`Classification failed: ${lastError?.message}. Using defaults.`);
    return questions;
}
