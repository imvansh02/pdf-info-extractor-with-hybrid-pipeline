/**
 * Prompt template for extracting questions and answers from PDF text.
 * The LLM is instructed to FIND existing Q&A, not create new ones.
 */
export function buildExtractionPrompt(
    chunkText: string,
    startPage: number,
    endPage: number
): string {
    return `You are an expert at reading educational materials (textbooks, notes, past papers, worksheets).

YOUR TASK: EXTRACT all existing questions, exercises, problems, and their answers from the text below.
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
- "answer": (string | null) The answer or solution if provided ANYWHERE in the source text (it may appear after the question, in an answer key, in footnotes, etc.). If no answer is found, use null.
- "source_page": (string) The page number(s) where the question appears, e.g. "42" or "42-43".

RULES:
1. Extract EVERY question you find — do not skip any.
2. Always look for answers, even if they are on different pages from the question.
3. Preserve all mathematical notation in LaTeX format.
4. If a question number or label is present (e.g., "Q5", "Exercise 3.2"), include it in the question text.
5. For MCQs, extract all options exactly as written.
6. Classify difficulty based on the cognitive level required, not the length of the question.

The text below is from pages ${startPage}–${endPage} of the source document.

--- BEGIN EXTRACTED TEXT ---
${chunkText}
--- END EXTRACTED TEXT ---

Return ONLY a JSON object with a single key "questions" containing an array of question objects.
Do not include any text outside the JSON. Example format:
{"questions": [{"topic": "...", "type": "...", "difficulty": "...", "question": "...", "options": null, "answer": "...", "source_page": "..."}]}

If no questions are found in this text, return: {"questions": []}`;
}
