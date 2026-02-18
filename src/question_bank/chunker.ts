import type { PageContent, TextChunk } from "./models.js";

/**
 * Fast token count estimation using character-based heuristic.
 * ~4 characters per token for English text — accurate within ~10%,
 * which is fine since we leave 200K headroom (800K of 1M context).
 *
 * This replaces the slow tiktoken encoder that was created per call.
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

/**
 * Split extracted pages into chunks that fit within the LLM context window.
 *
 * Strategy:
 * - Greedily groups consecutive pages until the token limit is reached
 * - Always splits at page boundaries (never mid-page)
 * - Preserves page metadata for source citations
 */
export function chunkPages(
    pages: PageContent[],
    maxTokens: number = 800_000
): TextChunk[] {
    const chunks: TextChunk[] = [];

    let currentText = "";
    let currentTokens = 0;
    let chunkStartPage = pages[0]?.pageNumber ?? 1;
    let chunkIndex = 0;

    for (const page of pages) {
        const pageText = `\n--- Page ${page.pageNumber} ---\n${page.text}\n`;
        const pageTokens = estimateTokens(pageText);

        // If a single page exceeds the limit, it goes in its own chunk
        if (pageTokens > maxTokens) {
            // Flush any accumulated text first
            if (currentText.length > 0) {
                chunks.push({
                    chunkIndex: chunkIndex++,
                    startPage: chunkStartPage,
                    endPage: page.pageNumber - 1,
                    text: currentText,
                    tokenCount: currentTokens,
                });
                currentText = "";
                currentTokens = 0;
            }
            // Push the oversized page as its own chunk
            chunks.push({
                chunkIndex: chunkIndex++,
                startPage: page.pageNumber,
                endPage: page.pageNumber,
                text: pageText,
                tokenCount: pageTokens,
            });
            chunkStartPage = page.pageNumber + 1;
            continue;
        }

        // Would adding this page exceed the limit?
        if (currentTokens + pageTokens > maxTokens) {
            // Flush the current chunk
            chunks.push({
                chunkIndex: chunkIndex++,
                startPage: chunkStartPage,
                endPage: page.pageNumber - 1,
                text: currentText,
                tokenCount: currentTokens,
            });
            currentText = pageText;
            currentTokens = pageTokens;
            chunkStartPage = page.pageNumber;
        } else {
            currentText += pageText;
            currentTokens += pageTokens;
        }
    }

    // Flush remaining text
    if (currentText.length > 0) {
        const lastPage = pages[pages.length - 1]?.pageNumber ?? chunkStartPage;
        chunks.push({
            chunkIndex: chunkIndex++,
            startPage: chunkStartPage,
            endPage: lastPage,
            text: currentText,
            tokenCount: currentTokens,
        });
    }

    return chunks;
}
