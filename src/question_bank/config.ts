import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const ConfigSchema = z.object({
    geminiApiKey: z.string().min(1, "GEMINI_API_KEY is required. Get one free at https://aistudio.google.com/apikey"),
    geminiModel: z.string().default("gemini-2.5-flash"),
    // Free tier limits: 15 RPM, 1500 RPD, 1M TPM
    maxRequestsPerMinute: z.number().default(14),    // Stay under 15 RPM
    maxConcurrentRequests: z.number().default(3),     // Conservative concurrency
    maxTokensPerChunk: z.number().default(800_000),   // Stay under 1M context
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
    return ConfigSchema.parse({
        geminiApiKey: process.env.GEMINI_API_KEY,
        geminiModel: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
        maxRequestsPerMinute: Number(process.env.MAX_RPM ?? 14),
        maxConcurrentRequests: Number(process.env.MAX_CONCURRENT ?? 3),
        maxTokensPerChunk: Number(process.env.MAX_TOKENS_PER_CHUNK ?? 800_000),
    });
}
