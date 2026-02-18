import type { PageContent } from "./models.js";

export interface ClassificationResult {
    type: "structured" | "unstructured";
    confidence: number;        // 0–1
    questionPatterns: number;  // how many question-like patterns found
    mcqPatterns: number;       // how many MCQ option blocks found
    avgCharsPerPage: number;   // text density
}

/**
 * Classify whether a PDF's extracted text is structured (exam-style)
 * or unstructured (scanned, irregular, freeform).
 *
 * Structured = consistent question numbering, MCQ options, answer keys.
 * Unstructured = little text, no patterns (scanned images, textbook prose).
 */
export function classifyPDF(pages: PageContent[]): ClassificationResult {
    const fullText = pages.map((p) => p.text).join("\n");
    const totalChars = fullText.length;
    const avgCharsPerPage = pages.length > 0 ? totalChars / pages.length : 0;

    // Signal 1: Question numbering patterns
    const questionPatterns = countQuestionPatterns(fullText);

    // Signal 2: MCQ option blocks
    const mcqPatterns = countMCQPatterns(fullText);

    // Signal 3: Text density (scanned PDFs have very little extractable text)
    const hasText = avgCharsPerPage > 100;

    // Score: 0–1
    let score = 0;
    if (hasText) score += 0.2;
    if (questionPatterns >= 3) score += 0.3;
    if (questionPatterns >= 10) score += 0.1;
    if (mcqPatterns >= 2) score += 0.2;
    if (mcqPatterns >= 5) score += 0.1;
    // Bonus: answer key detected
    if (/\b(ANSWERS?|Answer\s*Key|ANSWER\s*KEY|Solution)/i.test(fullText)) score += 0.1;

    return {
        type: score >= 0.5 ? "structured" : "unstructured",
        confidence: Math.min(score, 1),
        questionPatterns,
        mcqPatterns,
        avgCharsPerPage: Math.round(avgCharsPerPage),
    };
}

/** Count question-like patterns: Q1., 1., Question 1, (1), etc. */
function countQuestionPatterns(text: string): number {
    const patterns = [
        /(?:^|\n)\s*(?:Q\.?\s*)?(\d{1,3})\s*[.)]\s/gm,          // 1. or Q1. or Q.1)
        /(?:^|\n)\s*(?:Question|Ques\.?)\s*\d{1,3}/gim,          // Question 1
        /(?:^|\n)\s*\(\d{1,3}\)\s/gm,                             // (1)
        /(?:^|\n)\s*(?:Exercise|Problem)\s*\d/gim,                // Exercise 3
        /CASE\s*STUDY\s*\d/gim,                                   // CASE STUDY 1
    ];
    let total = 0;
    for (const pat of patterns) {
        const matches = text.match(pat);
        total += matches?.length ?? 0;
    }
    return total;
}

/** Count MCQ option blocks: (a), a), A., etc. */
function countMCQPatterns(text: string): number {
    // Look for consecutive option sequences like a) ... b) ... c) ... d)
    const optionBlock = /(?:^|\n)\s*[(\s]*[aA][).\s]\s*.+(?:\n\s*[(\s]*[bB][).\s]\s*.+)/gm;
    const matches = text.match(optionBlock);
    return matches?.length ?? 0;
}
