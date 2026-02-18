#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { resolve, basename } from "path";
import { writeFileSync, existsSync } from "fs";
import { loadConfig } from "./question_bank/config.js";
import { extractPDF, getPageCount } from "./question_bank/extractor.js";
import { chunkPages } from "./question_bank/chunker.js";
import { analyzeAllChunks } from "./question_bank/analyzer.js";
import { generateLatex, generateSummary } from "./question_bank/latex.js";
import { compileLatex, cleanAuxFiles, findLatexCompiler } from "./question_bank/compiler.js";
import type { Question } from "./question_bank/models.js";
import { analyzeNativePDF } from "./native_pdf/analyzer.js";
import { analyzeDirect } from "./native_pdf/direct_analyzer.js";
import { classifyPDF } from "./question_bank/classifier.js";
import { regexExtract } from "./question_bank/regex_extractor.js";
import { classifyQuestions } from "./native_pdf/classify_questions.js";

const program = new Command();

program
    .name("question-bank")
    .description("Extract questions & answers from PDF files → LaTeX question bank")
    .version("1.0.0");

program
    .command("extract")
    .description("Extract questions from a PDF file and output as LaTeX")
    .argument("<pdf>", "Path to the PDF file")
    .option("-o, --output <path>", "Output .tex file path", "output/questions.tex")
    .option("-m, --model <model>", "Gemini model to use", "gemini-2.5-flash")
    .option(
        "-t, --types <types>",
        "Comma-separated question types to include (e.g., MCQ,\"Short Answer\")"
    )
    .option(
        "-d, --difficulty <levels>",
        "Comma-separated difficulty levels (e.g., Easy,Medium)"
    )
    .option("--max-questions <n>", "Maximum number of questions to extract", parseInt)
    .option("--include-answers", "Include answer key section in output", true)
    .option("--no-include-answers", "Exclude answer key from output")
    .option("--json", "Also output raw JSON alongside LaTeX", false)
    .option("--compile", "Compile the LaTeX to PDF after generation", false)
    .action(async (pdfPath: string, opts) => {
        console.log(
            chalk.bold.cyan("\n📚 Question Bank Extractor\n")
        );

        // ── Validate input ────────────────────────────────────────────────────
        const absolutePath = resolve(pdfPath);
        if (!existsSync(absolutePath)) {
            console.error(chalk.red(`✖ File not found: ${absolutePath}`));
            process.exit(1);
        }

        // ── Load config ───────────────────────────────────────────────────────
        let config;
        try {
            config = loadConfig();
            if (opts.model) {
                config = { ...config, geminiModel: opts.model };
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`✖ Configuration error: ${msg}`));
            console.error(
                chalk.yellow(
                    "  → Copy .env.example to .env and add your Gemini API key.\n" +
                    "  → Get a free key at: https://aistudio.google.com/apikey"
                )
            );
            process.exit(1);
        }

        // ── Step 1: Extract PDF ───────────────────────────────────────────────
        const spinner = ora("Reading PDF...").start();
        try {
            const pageCount = await getPageCount(absolutePath);
            spinner.text = `Extracting text from ${pageCount} pages...`;
            const pages = await extractPDF(absolutePath);
            const nonEmptyPages = pages.filter((p) => p.text.length > 0);
            spinner.succeed(
                `Extracted text from ${chalk.bold(nonEmptyPages.length)}/${pageCount} pages`
            );

            // ── Step 2: Chunk ─────────────────────────────────────────────────
            spinner.start("Splitting into chunks...");
            const chunks = chunkPages(nonEmptyPages, config.maxTokensPerChunk);
            spinner.succeed(`Split into ${chalk.bold(chunks.length)} chunk(s)`);

            for (const chunk of chunks) {
                console.log(
                    chalk.gray(
                        `  Chunk ${chunk.chunkIndex + 1}: pp. ${chunk.startPage}–${chunk.endPage} (${chunk.tokenCount.toLocaleString()} tokens)`
                    )
                );
            }

            // ── Step 3: Analyze with LLM ─────────────────────────────────────
            console.log(chalk.cyan("\n🤖 Sending to Gemini for extraction...\n"));
            const analysisSpinner = ora("Analyzing chunk 1...").start();

            let questions = await analyzeAllChunks(chunks, config, (chunkIdx, found) => {
                analysisSpinner.text = `Analyzed chunk ${chunkIdx + 1}/${chunks.length} — found ${found} question(s)`;
            });

            analysisSpinner.succeed(
                `Analysis complete — extracted ${chalk.bold(questions.length)} questions total`
            );

            // ── Step 4: Filter ────────────────────────────────────────────────
            if (opts.types) {
                const allowedTypes = (opts.types as string).split(",").map((t: string) => t.trim());
                questions = questions.filter((q) => allowedTypes.includes(q.type));
            }
            if (opts.difficulty) {
                const allowedDiff = (opts.difficulty as string).split(",").map((d: string) => d.trim());
                questions = questions.filter((q) => allowedDiff.includes(q.difficulty));
            }
            if (opts.maxQuestions && questions.length > opts.maxQuestions) {
                questions = questions.slice(0, opts.maxQuestions);
            }

            if (questions.length === 0) {
                console.log(chalk.yellow("\n⚠ No questions found in this PDF."));
                process.exit(0);
            }

            // ── Step 5: Generate LaTeX ────────────────────────────────────────
            spinner.start("Generating LaTeX...");
            const title = basename(absolutePath, ".pdf");
            const latex = generateLatex(questions, {
                title,
                includeAnswers: opts.includeAnswers,
            });

            const outputPath = resolve(opts.output);
            writeFileSync(outputPath, latex, "utf-8");
            spinner.succeed(`LaTeX written to ${chalk.bold(outputPath)}`);

            // ── Optional: JSON output ─────────────────────────────────────────
            if (opts.json) {
                const jsonPath = outputPath.replace(/\.tex$/, ".json");
                writeFileSync(jsonPath, JSON.stringify(questions, null, 2), "utf-8");
                console.log(chalk.green(`  JSON written to ${jsonPath}`));
            }

            // ── Step 6: Compile to PDF ──────────────────────────────────────
            if (opts.compile) {
                const compileSpinner = ora("Compiling LaTeX to PDF...").start();
                try {
                    const pdfPath = compileLatex(outputPath, { quiet: true });
                    cleanAuxFiles(outputPath);
                    compileSpinner.succeed(`PDF generated: ${chalk.bold(pdfPath)}`);
                } catch (compileErr: unknown) {
                    const compileMsg = compileErr instanceof Error ? compileErr.message : String(compileErr);
                    compileSpinner.fail(`PDF compilation failed: ${compileMsg}`);
                }
            }

            // ── Summary ───────────────────────────────────────────────────────
            console.log(generateSummary(questions));

            if (opts.compile) {
                console.log(chalk.green.bold("✔ Done!") + "\n");
            } else {
                console.log(
                    chalk.green.bold("✔ Done!") +
                    chalk.gray(` Compile with: pdflatex ${opts.output}\n`)
                );
            }
        } catch (err: unknown) {
            spinner.fail("Extraction failed");
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\n✖ Error: ${msg}`));
            process.exit(1);
        }
    });

program
    .command("fast-extract")
    .description("Extract questions using native PDF upload (faster, fewer API calls)")
    .argument("<pdf>", "Path to the PDF file")
    .option("-o, --output <path>", "Output .tex file path", "output/questions.tex")
    .option("-m, --model <model>", "Gemini model to use", "gemini-2.5-flash")
    .option(
        "-t, --types <types>",
        'Comma-separated question types to include (e.g., MCQ,"Short Answer")'
    )
    .option(
        "-d, --difficulty <levels>",
        "Comma-separated difficulty levels (e.g., Easy,Medium)"
    )
    .option("--max-questions <n>", "Maximum number of questions to extract", parseInt)
    .option("--include-answers", "Include answer key section in output", true)
    .option("--no-include-answers", "Exclude answer key from output")
    .option("--json", "Also output raw JSON alongside LaTeX", false)
    .option("--compile", "Compile the LaTeX to PDF after generation", false)
    .action(async (pdfPath: string, opts) => {
        console.log(
            chalk.bold.magenta("\n⚡ Question Bank Extractor (Native PDF Mode)\n")
        );

        // ── Validate input ────────────────────────────────────────────────────
        const absolutePath = resolve(pdfPath);
        if (!existsSync(absolutePath)) {
            console.error(chalk.red(`✖ File not found: ${absolutePath}`));
            process.exit(1);
        }

        // ── Load config ───────────────────────────────────────────────────────
        let config;
        try {
            config = loadConfig();
            if (opts.model) {
                config = { ...config, geminiModel: opts.model };
            }
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`✖ Configuration error: ${msg}`));
            console.error(
                chalk.yellow(
                    "  → Copy .env.example to .env and add your Gemini API key.\n" +
                    "  → Get a free key at: https://aistudio.google.com/apikey"
                )
            );
            process.exit(1);
        }

        // ── Analyze with native PDF upload ────────────────────────────────────
        const spinner = ora("Preparing PDF...").start();
        try {
            let questions = await analyzeNativePDF(absolutePath, config, (msg) => {
                spinner.text = msg;
            });

            spinner.succeed(
                `Extracted ${chalk.bold(questions.length)} questions via native PDF upload`
            );

            // ── Filter ────────────────────────────────────────────────────────
            if (opts.types) {
                const allowedTypes = (opts.types as string).split(",").map((t: string) => t.trim());
                questions = questions.filter((q) => allowedTypes.includes(q.type));
            }
            if (opts.difficulty) {
                const allowedDiff = (opts.difficulty as string).split(",").map((d: string) => d.trim());
                questions = questions.filter((q) => allowedDiff.includes(q.difficulty));
            }
            if (opts.maxQuestions && questions.length > opts.maxQuestions) {
                questions = questions.slice(0, opts.maxQuestions);
            }

            if (questions.length === 0) {
                console.log(chalk.yellow("\n⚠ No questions found in this PDF."));
                process.exit(0);
            }

            // ── Generate LaTeX ────────────────────────────────────────────────
            spinner.start("Generating LaTeX...");
            const title = basename(absolutePath, ".pdf");
            const latex = generateLatex(questions, {
                title,
                includeAnswers: opts.includeAnswers,
            });

            const outputPath = resolve(opts.output);
            writeFileSync(outputPath, latex, "utf-8");
            spinner.succeed(`LaTeX written to ${chalk.bold(outputPath)}`);

            // ── Optional: JSON output ─────────────────────────────────────────
            if (opts.json) {
                const jsonPath = outputPath.replace(/\.tex$/, ".json");
                writeFileSync(jsonPath, JSON.stringify(questions, null, 2), "utf-8");
                console.log(chalk.green(`  JSON written to ${jsonPath}`));
            }

            // ── Compile to PDF ────────────────────────────────────────────────
            if (opts.compile) {
                const compileSpinner = ora("Compiling LaTeX to PDF...").start();
                try {
                    const compiledPath = compileLatex(outputPath, { quiet: true });
                    cleanAuxFiles(outputPath);
                    compileSpinner.succeed(`PDF generated: ${chalk.bold(compiledPath)}`);
                } catch (compileErr: unknown) {
                    const compileMsg = compileErr instanceof Error ? compileErr.message : String(compileErr);
                    compileSpinner.fail(`PDF compilation failed: ${compileMsg}`);
                }
            }

            // ── Summary ───────────────────────────────────────────────────────
            console.log(generateSummary(questions));

            if (opts.compile) {
                console.log(chalk.green.bold("✔ Done!") + "\n");
            } else {
                console.log(
                    chalk.green.bold("✔ Done!") +
                    chalk.gray(` Compile with: pdflatex ${opts.output}\n`)
                );
            }
        } catch (err: unknown) {
            spinner.fail("Extraction failed");
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\n✖ Error: ${msg}`));
            process.exit(1);
        }
    });

program
    .command("smart-extract")
    .description("Fastest: text extraction + single API call with structured output (no chunking)")
    .argument("<pdf>", "Path to the PDF file")
    .option("-o, --output <path>", "Output .tex file path", "output/questions.tex")
    .option("-m, --model <model>", "Gemini model to use", "gemini-2.5-flash")
    .option("-t, --types <types>", 'Filter question types (e.g., MCQ,"Short Answer")')
    .option("-d, --difficulty <levels>", "Filter difficulty (e.g., Easy,Medium)")
    .option("--max-questions <n>", "Maximum questions to extract", parseInt)
    .option("--include-answers", "Include answer key", true)
    .option("--no-include-answers", "Exclude answer key")
    .option("--json", "Also output raw JSON", false)
    .option("--compile", "Compile LaTeX to PDF", false)
    .action(async (pdfPath: string, opts) => {
        console.log(
            chalk.bold.green("\n\u26a1 Smart Extract (Text + Direct API)\n")
        );

        const absolutePath = resolve(pdfPath);
        if (!existsSync(absolutePath)) {
            console.error(chalk.red(`\u2716 File not found: ${absolutePath}`));
            process.exit(1);
        }

        let config;
        try {
            config = loadConfig();
            if (opts.model) config = { ...config, geminiModel: opts.model };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\u2716 Configuration error: ${msg}`));
            process.exit(1);
        }

        const spinner = ora("Extracting text from PDF...").start();
        try {
            // Step 1: Extract text (parallel)
            const pages = await extractPDF(absolutePath);
            spinner.succeed(`Extracted text from ${chalk.bold(pages.length)} pages`);

            // Step 2: Direct to LLM — no chunking
            spinner.start("Sending to Gemini...");
            let questions = await analyzeDirect(pages, config, (msg) => {
                spinner.text = msg;
            });

            spinner.succeed(
                `Extracted ${chalk.bold(questions.length)} questions`
            );

            // Filter
            if (opts.types) {
                const allowed = (opts.types as string).split(",").map((t: string) => t.trim());
                questions = questions.filter((q) => allowed.includes(q.type));
            }
            if (opts.difficulty) {
                const allowed = (opts.difficulty as string).split(",").map((d: string) => d.trim());
                questions = questions.filter((q) => allowed.includes(q.difficulty));
            }
            if (opts.maxQuestions && questions.length > opts.maxQuestions) {
                questions = questions.slice(0, opts.maxQuestions);
            }

            if (questions.length === 0) {
                console.log(chalk.yellow("\n\u26a0 No questions found."));
                process.exit(0);
            }

            // Generate LaTeX
            spinner.start("Generating LaTeX...");
            const title = basename(absolutePath, ".pdf");
            const latex = generateLatex(questions, { title, includeAnswers: opts.includeAnswers });
            const outputPath = resolve(opts.output);
            writeFileSync(outputPath, latex, "utf-8");
            spinner.succeed(`LaTeX written to ${chalk.bold(outputPath)}`);

            if (opts.json) {
                const jsonPath = outputPath.replace(/\.tex$/, ".json");
                writeFileSync(jsonPath, JSON.stringify(questions, null, 2), "utf-8");
                console.log(chalk.green(`  JSON written to ${jsonPath}`));
            }

            if (opts.compile) {
                const compileSpinner = ora("Compiling LaTeX to PDF...").start();
                try {
                    const compiledPath = compileLatex(outputPath, { quiet: true });
                    cleanAuxFiles(outputPath);
                    compileSpinner.succeed(`PDF generated: ${chalk.bold(compiledPath)}`);
                } catch (compileErr: unknown) {
                    const msg = compileErr instanceof Error ? compileErr.message : String(compileErr);
                    compileSpinner.fail(`PDF compilation failed: ${msg}`);
                }
            }

            console.log(generateSummary(questions));
            console.log(
                opts.compile
                    ? chalk.green.bold("\u2714 Done!") + "\n"
                    : chalk.green.bold("\u2714 Done!") + chalk.gray(` Compile with: pdflatex ${opts.output}\n`)
            );
        } catch (err: unknown) {
            spinner.fail("Extraction failed");
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\n\u2716 Error: ${msg}`));
            process.exit(1);
        }
    });

program
    .command("auto-extract")
    .description("Hybrid: regex for structured PDFs, LLM fallback for unstructured (fastest overall)")
    .argument("<pdf>", "Path to the PDF file")
    .option("-o, --output <path>", "Output .tex file path", "output/questions.tex")
    .option("-m, --model <model>", "Gemini model to use", "gemini-2.5-flash")
    .option("-t, --types <types>", 'Filter question types (e.g., MCQ,"Short Answer")')
    .option("-d, --difficulty <levels>", "Filter difficulty (e.g., Easy,Medium)")
    .option("--max-questions <n>", "Maximum questions to extract", parseInt)
    .option("--include-answers", "Include answer key", true)
    .option("--no-include-answers", "Exclude answer key")
    .option("--json", "Also output raw JSON", false)
    .option("--compile", "Compile LaTeX to PDF", false)
    .action(async (pdfPath: string, opts) => {
        console.log(
            chalk.bold.yellow("\n\u{1f9e0} Auto Extract (Hybrid Pipeline)\n")
        );

        const absolutePath = resolve(pdfPath);
        if (!existsSync(absolutePath)) {
            console.error(chalk.red(`\u2716 File not found: ${absolutePath}`));
            process.exit(1);
        }

        let config;
        try {
            config = loadConfig();
            if (opts.model) config = { ...config, geminiModel: opts.model };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\u2716 Configuration error: ${msg}`));
            process.exit(1);
        }

        const spinner = ora("Extracting text from PDF...").start();
        try {
            // Step 1: Extract text
            const pages = await extractPDF(absolutePath);
            spinner.succeed(`Extracted text from ${chalk.bold(pages.length)} pages`);

            // Step 2: Classify PDF
            spinner.start("Classifying PDF structure...");
            const classification = classifyPDF(pages);
            const isStructured = classification.type === "structured";

            spinner.succeed(
                isStructured
                    ? chalk.green(`Structured PDF detected`) +
                    chalk.gray(` (confidence: ${(classification.confidence * 100).toFixed(0)}%, ${classification.questionPatterns} question patterns, ${classification.mcqPatterns} MCQ blocks)`)
                    : chalk.yellow(`Unstructured PDF detected`) +
                    chalk.gray(` — falling back to full LLM extraction`)
            );

            let questions: Question[];

            if (isStructured) {
                // Step 3a: Regex extraction (instant)
                spinner.start("Extracting questions with regex...");
                questions = regexExtract(pages);
                spinner.succeed(`Regex extracted ${chalk.bold(questions.length)} questions`);

                if (questions.length < 5) {
                    // Too few — fall back to LLM
                    console.log(chalk.yellow(`  Only ${questions.length} found — falling back to LLM`));
                    spinner.start("Sending to Gemini for full extraction...");
                    questions = await analyzeDirect(pages, config, (msg) => {
                        spinner.text = msg;
                    });
                    spinner.succeed(`LLM extracted ${chalk.bold(questions.length)} questions`);
                } else {
                    // Step 3b: Classify via lightweight LLM call
                    spinner.start("Classifying topics & difficulty via Gemini...");
                    questions = await classifyQuestions(questions, config, (msg) => {
                        spinner.text = msg;
                    });
                    spinner.succeed(`Classified ${chalk.bold(questions.length)} questions`);
                }
            } else {
                // Step 3: Full LLM extraction for unstructured PDFs
                spinner.start("Sending to Gemini for full extraction...");
                questions = await analyzeDirect(pages, config, (msg) => {
                    spinner.text = msg;
                });
                spinner.succeed(`LLM extracted ${chalk.bold(questions.length)} questions`);
            }

            // Filter
            if (opts.types) {
                const allowed = (opts.types as string).split(",").map((t: string) => t.trim());
                questions = questions.filter((q) => allowed.includes(q.type));
            }
            if (opts.difficulty) {
                const allowed = (opts.difficulty as string).split(",").map((d: string) => d.trim());
                questions = questions.filter((q) => allowed.includes(q.difficulty));
            }
            if (opts.maxQuestions && questions.length > opts.maxQuestions) {
                questions = questions.slice(0, opts.maxQuestions);
            }

            if (questions.length === 0) {
                console.log(chalk.yellow("\n\u26a0 No questions found."));
                process.exit(0);
            }

            // Generate LaTeX
            spinner.start("Generating LaTeX...");
            const title = basename(absolutePath, ".pdf");
            const latex = generateLatex(questions, { title, includeAnswers: opts.includeAnswers });
            const outputPath = resolve(opts.output);
            writeFileSync(outputPath, latex, "utf-8");
            spinner.succeed(`LaTeX written to ${chalk.bold(outputPath)}`);

            if (opts.json) {
                const jsonPath = outputPath.replace(/\.tex$/, ".json");
                writeFileSync(jsonPath, JSON.stringify(questions, null, 2), "utf-8");
                console.log(chalk.green(`  JSON written to ${jsonPath}`));
            }

            if (opts.compile) {
                const compileSpinner = ora("Compiling LaTeX to PDF...").start();
                try {
                    const compiledPath = compileLatex(outputPath, { quiet: true });
                    cleanAuxFiles(outputPath);
                    compileSpinner.succeed(`PDF generated: ${chalk.bold(compiledPath)}`);
                } catch (compileErr: unknown) {
                    const msg = compileErr instanceof Error ? compileErr.message : String(compileErr);
                    compileSpinner.fail(`PDF compilation failed: ${msg}`);
                }
            }

            console.log(generateSummary(questions));
            console.log(
                opts.compile
                    ? chalk.green.bold("\u2714 Done!") + "\n"
                    : chalk.green.bold("\u2714 Done!") + chalk.gray(` Compile with: pdflatex ${opts.output}\n`)
            );
        } catch (err: unknown) {
            spinner.fail("Extraction failed");
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\n\u2716 Error: ${msg}`));
            process.exit(1);
        }
    });

program
    .command("compile")
    .description("Compile a .tex file to PDF")
    .argument("<tex>", "Path to the .tex file")
    .option("--clean", "Remove auxiliary files after compilation", true)
    .option("--no-clean", "Keep auxiliary files")
    .action((texPath: string, opts) => {
        console.log(chalk.bold.cyan("\n📄 LaTeX Compiler\n"));

        const absPath = resolve(texPath);
        if (!existsSync(absPath)) {
            console.error(chalk.red(`✖ File not found: ${absPath}`));
            process.exit(1);
        }

        const compiler = findLatexCompiler();
        if (!compiler) {
            console.error(chalk.red("✖ No LaTeX compiler found."));
            console.error(chalk.yellow(
                "  Install TeX Live:\n" +
                "    Ubuntu/WSL: sudo apt-get install texlive-latex-extra texlive-fonts-recommended\n" +
                "    macOS:      brew install --cask mactex"
            ));
            process.exit(1);
        }

        const spinner = ora(`Compiling with ${compiler}...`).start();
        try {
            const pdfPath = compileLatex(absPath, { compiler, quiet: true });
            if (opts.clean) {
                cleanAuxFiles(absPath);
            }
            spinner.succeed(`PDF generated: ${chalk.bold(pdfPath)}`);
            console.log(chalk.green.bold("\n✔ Done!") + "\n");
        } catch (err: unknown) {
            spinner.fail("Compilation failed");
            const msg = err instanceof Error ? err.message : String(err);
            console.error(chalk.red(`\n✖ Error: ${msg}`));
            process.exit(1);
        }
    });

program.parse();
