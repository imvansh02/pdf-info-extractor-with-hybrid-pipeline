import type { PageContent, Question } from "./models.js";

interface RawQuestion {
    questionNum: string;
    text: string;
    options: string[] | null;
    answer: string | null;
    sourcePage: number;
    sectionTopic: string;
}

/**
 * Extract questions from structured exam-style PDFs using regex patterns.
 * Returns questions with topic/difficulty as placeholders (to be classified by LLM).
 */
export function regexExtract(pages: PageContent[]): Question[] {
    // Build a single text stream with page markers
    const pageTexts = pages.map((p) => ({
        pageNum: p.pageNumber,
        text: p.text,
    }));

    const allQuestions: RawQuestion[] = [];

    // First pass: detect topic sections (e.g., "REAL NUMBERS- CASE STUDY")
    let currentTopic = "General";
    const topicPattern = /^([A-Z][A-Z\s&]+(?:[-–]\s*CASE\s*STUDY)?)/;

    for (const { pageNum, text } of pageTexts) {
        const lines = text.split("\n");

        // Check for topic header at start of page or in text
        for (const line of lines) {
            const topicMatch = line.trim().match(topicPattern);
            if (topicMatch && topicMatch[1].length > 5 && topicMatch[1].length < 80) {
                // Clean up the topic name
                currentTopic = cleanTopic(topicMatch[1]);
            }
        }

        // Extract questions from this page
        const pageQuestions = extractQuestionsFromText(text, pageNum, currentTopic);
        allQuestions.push(...pageQuestions);
    }

    // Second pass: try to match answers
    const answersMap = extractAnswerKeys(pages);
    for (const q of allQuestions) {
        if (!q.answer && answersMap.has(q.questionNum)) {
            q.answer = answersMap.get(q.questionNum)!;
        }
    }

    // Convert to Question format
    return allQuestions.map((q) => ({
        topic: q.sectionTopic,
        type: q.options ? "MCQ" : "Short Answer",
        difficulty: "Medium" as const,  // placeholder — LLM will classify
        question: q.text.trim(),
        options: q.options,
        answer: q.answer,
        source_page: String(q.sourcePage),
    }));
}

function extractQuestionsFromText(
    text: string,
    pageNum: number,
    currentTopic: string
): RawQuestion[] {
    const questions: RawQuestion[] = [];

    // Split into question blocks using numbered patterns
    // Matches: "1.", "2.", "Q1.", "Q.1)", "(1)", etc. at line start
    const questionSplitPattern = /(?:^|\n)\s*(?:(?:Q\.?\s*)?(\d{1,3})\s*[.):]|(?:Question|Ques\.?)\s*(\d{1,3})\s*[.):]*|\((\d{1,3})\))/gi;

    const matches: { index: number; num: string }[] = [];
    let m: RegExpExecArray | null;

    while ((m = questionSplitPattern.exec(text)) !== null) {
        const num = m[1] || m[2] || m[3] || "0";
        matches.push({ index: m.index, num });
    }

    for (let i = 0; i < matches.length; i++) {
        const start = matches[i].index;
        const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
        let block = text.substring(start, end).trim();

        // Check if this looks like an answer line (e.g., "1. b) 12")
        if (isAnswerLine(block)) continue;

        // Check if we've hit an "ANSWERS" section
        if (/^ANSWERS?\s*$/im.test(block)) break;

        // Extract MCQ options from the block
        const { questionText, options } = extractOptions(block);

        // Extract inline answer if present
        const answer = extractInlineAnswer(block);

        questions.push({
            questionNum: matches[i].num,
            text: questionText,
            options: options.length >= 2 ? options : null,
            answer,
            sourcePage: pageNum,
            sectionTopic: currentTopic,
        });
    }

    return questions;
}

function extractOptions(block: string): { questionText: string; options: string[] } {
    const options: string[] = [];

    // Match option patterns: a), b), c), d) or (a), (b), etc.
    const optionPattern = /(?:^|\n)\s*[(\s]*([a-dA-D])[).\s]\s*(.+)/gm;
    let firstOptionIndex = -1;
    let m: RegExpExecArray | null;

    while ((m = optionPattern.exec(block)) !== null) {
        if (firstOptionIndex === -1) firstOptionIndex = m.index;
        const optionText = m[2].trim();
        if (optionText.length > 0) {
            options.push(`${m[1].toLowerCase()}) ${optionText}`);
        }
    }

    // Question text is everything before the first option
    const questionText = firstOptionIndex > 0
        ? block.substring(0, firstOptionIndex).trim()
        : block.trim();

    return { questionText, options };
}

function extractInlineAnswer(block: string): string | null {
    // Look for "Answer: X", "Ans: X", "Ans. X" patterns
    const answerMatch = block.match(/(?:Answer|Ans\.?|Solution)\s*[:=]\s*(.+)/i);
    if (answerMatch) return answerMatch[1].trim();
    return null;
}

function isAnswerLine(block: string): boolean {
    // Short line that looks like "1. b) 12" or "1. c) 288" — likely an answer key entry
    const firstLine = block.split("\n")[0].trim();
    if (firstLine.length < 40 && /^\d{1,3}[.)]\s*[a-dA-D][.)]\s*.*/i.test(firstLine)) {
        return true;
    }
    return false;
}

function extractAnswerKeys(pages: PageContent[]): Map<string, string> {
    const answers = new Map<string, string>();
    const fullText = pages.map((p) => p.text).join("\n");

    // Find "ANSWERS" sections
    const answerSectionPattern = /(?:ANSWERS?|Answer\s*Key)\s*\n([\s\S]*?)(?=\n[A-Z]{3,}|\nCASE\s*STUDY|$)/gi;
    let m: RegExpExecArray | null;

    while ((m = answerSectionPattern.exec(fullText)) !== null) {
        const section = m[1];
        // Parse "1. b) 12" or "1. c)" style answer entries
        const entryPattern = /(\d{1,3})[.)]\s*([a-dA-D])[.)]\s*(.*)/g;
        let entry: RegExpExecArray | null;

        while ((entry = entryPattern.exec(section)) !== null) {
            const num = entry[1];
            const letter = entry[2].toLowerCase();
            const detail = entry[3]?.trim();
            answers.set(num, detail ? `${letter}) ${detail}` : `${letter})`);
        }
    }

    // Also catch inline answer patterns after question blocks
    // e.g., lines that look like "1. b) 288\n2. b) 4\n"
    const inlinePattern = /(?:^|\n)\s*(\d{1,3})[.)]\s*([a-dA-D])[.)]\s*(.*?)(?=\n|$)/gm;
    while ((m = inlinePattern.exec(fullText)) !== null) {
        const num = m[1];
        if (!answers.has(num)) {
            const letter = m[2].toLowerCase();
            const detail = m[3]?.trim();
            answers.set(num, detail ? `${letter}) ${detail}` : `${letter})`);
        }
    }

    return answers;
}

function cleanTopic(raw: string): string {
    return raw
        .replace(/[-–]\s*CASE\s*STUDY\s*/i, "")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
}
