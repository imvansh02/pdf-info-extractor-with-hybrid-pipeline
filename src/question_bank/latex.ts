import type { Question } from "./models.js";

/**
 * Escape special LaTeX characters in user-provided text.
 * Preserves $ ... $ math mode delimiters and common LaTeX commands.
 */
function escapeLatex(text: string): string {
    // Don't escape content inside $...$ or $$...$$ (math mode)
    const parts: string[] = [];
    let inMath = false;
    let i = 0;

    while (i < text.length) {
        if (text[i] === "$") {
            inMath = !inMath;
            parts.push("$");
            i++;
        } else if (text[i] === "\\" && text[i + 1] && /[a-zA-Z]/.test(text[i + 1])) {
            // LaTeX command like \frac, \sqrt — don't escape
            let cmd = "\\";
            i++;
            while (i < text.length && /[a-zA-Z]/.test(text[i])) {
                cmd += text[i];
                i++;
            }
            parts.push(cmd);
        } else if (!inMath) {
            // Escape special chars outside math mode
            const ch = text[i]!;
            if ("#%&_{}".includes(ch)) {
                parts.push("\\" + ch);
            } else if (ch === "~") {
                parts.push("\\textasciitilde{}");
            } else if (ch === "^") {
                parts.push("\\textasciicircum{}");
            } else {
                parts.push(ch);
            }
            i++;
        } else {
            parts.push(text[i]!);
            i++;
        }
    }

    return parts.join("");
}

/**
 * Build the LaTeX document preamble.
 */
function buildPreamble(title: string): string {
    return `\\documentclass[12pt, a4paper]{article}

% ── Packages ─────────────────────────────────────────────────────────────────
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath, amssymb}
\\usepackage[margin=1in]{geometry}
\\usepackage{enumitem}
\\usepackage{xcolor}
\\usepackage{hyperref}
\\usepackage{fancyhdr}
\\usepackage{titlesec}

% ── Colors ───────────────────────────────────────────────────────────────────
\\definecolor{topiccolor}{HTML}{1a5276}
\\definecolor{easycolor}{HTML}{27ae60}
\\definecolor{mediumcolor}{HTML}{f39c12}
\\definecolor{hardcolor}{HTML}{e74c3c}
\\definecolor{answercolor}{HTML}{2c3e50}

% ── Header / Footer ─────────────────────────────────────────────────────────
\\pagestyle{fancy}
\\fancyhf{}
\\fancyhead[L]{\\textit{Question Bank}}
\\fancyhead[R]{\\thepage}
\\renewcommand{\\headrulewidth}{0.4pt}

% ── Section Formatting ───────────────────────────────────────────────────────
\\titleformat{\\section}{\\Large\\bfseries\\color{topiccolor}}{\\thesection}{1em}{}
\\titleformat{\\subsection}{\\large\\bfseries}{\\thesubsection}{1em}{}

% ── Custom Commands ──────────────────────────────────────────────────────────
\\newcommand{\\difficulty}[1]{%
  \\ifx#1E\\textcolor{easycolor}{\\textbf{[Easy]}}%
  \\else\\ifx#1M\\textcolor{mediumcolor}{\\textbf{[Medium]}}%
  \\else\\textcolor{hardcolor}{\\textbf{[Hard]}}%
  \\fi\\fi%
}
\\newcommand{\\qtype}[1]{\\textsc{#1}}
\\newcommand{\\sourcepage}[1]{\\hfill{\\footnotesize\\textit{(p.~#1)}}}

\\title{\\Huge\\textbf{Question Bank}\\\\[0.3em]\\Large\\textit{${escapeLatex(title)}}}
\\date{\\today}

\\begin{document}
\\maketitle
\\tableofcontents
\\newpage
`;
}

/**
 * Render a single question as LaTeX.
 */
function renderQuestion(q: Question, index: number): string {
    const diffChar = q.difficulty === "Easy" ? "E" : q.difficulty === "Medium" ? "M" : "H";
    const lines: string[] = [];

    lines.push(`\\item \\difficulty{${diffChar}} \\qtype{${escapeLatex(q.type)}} \\sourcepage{${escapeLatex(q.source_page)}}`);
    lines.push(`  `);
    lines.push(`  ${escapeLatex(q.question)}`);

    // MCQ options
    if (q.type === "MCQ" && q.options && q.options.length > 0) {
        lines.push(`  \\begin{enumerate}[label=(\\alph*), leftmargin=2em]`);
        for (const opt of q.options) {
            lines.push(`    \\item ${escapeLatex(opt)}`);
        }
        lines.push(`  \\end{enumerate}`);
    }

    lines.push(``);
    return lines.join("\n");
}

/**
 * Group questions by topic, then by difficulty within each topic.
 */
function groupQuestions(
    questions: Question[]
): Map<string, Map<string, Question[]>> {
    const grouped = new Map<string, Map<string, Question[]>>();

    for (const q of questions) {
        if (!grouped.has(q.topic)) {
            grouped.set(q.topic, new Map());
        }
        const topicMap = grouped.get(q.topic)!;
        if (!topicMap.has(q.difficulty)) {
            topicMap.set(q.difficulty, []);
        }
        topicMap.get(q.difficulty)!.push(q);
    }

    return grouped;
}

/**
 * Generate a complete, compilable LaTeX document from a list of questions.
 */
export function generateLatex(
    questions: Question[],
    options: {
        title?: string;
        includeAnswers?: boolean;
    } = {}
): string {
    const { title = "Extracted Questions", includeAnswers = true } = options;
    const grouped = groupQuestions(questions);
    const difficultyOrder = ["Easy", "Medium", "Hard"];

    let doc = buildPreamble(title);

    // ── Questions Section ───────────────────────────────────────────────────
    let globalIndex = 0;

    for (const [topic, difficulties] of grouped) {
        doc += `\\section{${escapeLatex(topic)}}\n\n`;

        for (const difficulty of difficultyOrder) {
            const qs = difficulties.get(difficulty);
            if (!qs || qs.length === 0) continue;

            doc += `\\subsection{${difficulty}}\n`;
            doc += `\\begin{enumerate}[label=Q\\arabic*., start=${globalIndex + 1}]\n`;

            for (const q of qs) {
                doc += renderQuestion(q, ++globalIndex);
            }

            doc += `\\end{enumerate}\n\n`;
        }
    }

    // ── Answer Key Section ────────────────────────────────────────────────
    if (includeAnswers) {
        const answeredQuestions = questions.filter((q) => q.answer !== null);
        if (answeredQuestions.length > 0) {
            doc += `\\newpage\n`;
            doc += `\\section*{Answer Key}\n`;
            doc += `\\addcontentsline{toc}{section}{Answer Key}\n`;
            doc += `{\\color{answercolor}\n`;
            doc += `\\begin{enumerate}[label=Q\\arabic*.]\n`;

            let ansIndex = 0;
            for (const q of questions) {
                ansIndex++;
                if (q.answer) {
                    doc += `  \\item ${escapeLatex(q.answer)}\n`;
                } else {
                    doc += `  \\item \\textit{No answer provided}\n`;
                }
            }

            doc += `\\end{enumerate}\n`;
            doc += `}\n`;
        }
    }

    doc += `\n\\end{document}\n`;
    return doc;
}

/**
 * Generate a summary statistics string for console output.
 */
export function generateSummary(questions: Question[]): string {
    const byType = new Map<string, number>();
    const byDifficulty = new Map<string, number>();
    const byTopic = new Map<string, number>();

    for (const q of questions) {
        byType.set(q.type, (byType.get(q.type) ?? 0) + 1);
        byDifficulty.set(q.difficulty, (byDifficulty.get(q.difficulty) ?? 0) + 1);
        byTopic.set(q.topic, (byTopic.get(q.topic) ?? 0) + 1);
    }

    const answeredCount = questions.filter((q) => q.answer !== null).length;

    let summary = `\n📊 Extraction Summary\n`;
    summary += `${"─".repeat(40)}\n`;
    summary += `Total questions: ${questions.length}\n`;
    summary += `With answers:    ${answeredCount}\n\n`;

    summary += `By Type:\n`;
    for (const [type, count] of byType) {
        summary += `  ${type}: ${count}\n`;
    }

    summary += `\nBy Difficulty:\n`;
    for (const [diff, count] of byDifficulty) {
        summary += `  ${diff}: ${count}\n`;
    }

    summary += `\nBy Topic:\n`;
    for (const [topic, count] of [...byTopic.entries()].sort((a, b) => b[1] - a[1])) {
        summary += `  ${topic}: ${count}\n`;
    }

    return summary;
}
