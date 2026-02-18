import { GoogleGenAI } from "@google/genai";
import { loadConfig } from "./question_bank/config.js";

async function listModels() {
    const config = loadConfig();
    const client = new GoogleGenAI({ apiKey: config.geminiApiKey });

    console.log("Listing available Gemini models...\n");

    const pager = await client.models.list({ config: { pageSize: 100 } });

    for await (const model of pager) {
        if (model.name) {
            console.log(`  ${model.name}`);
        }
    }
}

listModels().catch((e) => console.error("Error:", e.message));
