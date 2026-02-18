import { z } from "zod";

// ── Question Types ──────────────────────────────────────────────────────────
export const QuestionTypeEnum = z.enum([
    "MCQ",
    "Short Answer",
    "Long Answer",
    "True/False",
    "Fill in the Blank",
    "Numerical",
]);

export const DifficultyEnum = z.enum(["Easy", "Medium", "Hard"]);

// ── Single Question Schema ──────────────────────────────────────────────────
export const QuestionSchema = z.object({
    topic: z.string().describe("The subject or concept being tested"),
    type: QuestionTypeEnum,
    difficulty: DifficultyEnum,
    question: z.string().describe("The exact question text from the source"),
    options: z
        .array(z.string())
        .nullable()
        .default(null)
        .describe("Answer choices (MCQ only)"),
    answer: z
        .string()
        .nullable()
        .default(null)
        .describe("The answer/solution if found in the source"),
    source_page: z
        .string()
        .describe("Page number(s) where the question appears"),
});

export type Question = z.infer<typeof QuestionSchema>;

// ── Question Bank (collection of questions) ─────────────────────────────────
export const QuestionBankSchema = z.object({
    questions: z.array(QuestionSchema),
});

export type QuestionBank = z.infer<typeof QuestionBankSchema>;

// ── Page content from PDF extraction ────────────────────────────────────────
export interface PageContent {
    pageNumber: number;
    text: string;
}

// ── Chunk of pages sent to LLM ─────────────────────────────────────────────
export interface TextChunk {
    chunkIndex: number;
    startPage: number;
    endPage: number;
    text: string;
    tokenCount: number;
}
