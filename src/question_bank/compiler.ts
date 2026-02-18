import { execSync } from "child_process";
import { platform } from "os";
import { existsSync } from "fs";
import { resolve, dirname, basename } from "path";

/**
 * Check if a LaTeX compiler is available on the system.
 */
export function findLatexCompiler(): string | null {
    const compilers = ["pdflatex", "xelatex", "lualatex"];
    const isWin = platform() === "win32";
    const cmd = isWin ? "where" : "which";

    for (const compiler of compilers) {
        try {
            execSync(`${cmd} ${compiler}`, { stdio: "ignore" });
            return compiler;
        } catch {
            // not found, try next
        }
    }
    return null;
}

/**
 * Compile a .tex file to PDF using the system's LaTeX compiler.
 * Returns the path to the generated PDF, or throws on failure.
 */
export function compileLatex(
    texPath: string,
    options: { compiler?: string; quiet?: boolean } = {}
): string {
    const absPath = resolve(texPath);
    if (!existsSync(absPath)) {
        throw new Error(`LaTeX file not found: ${absPath}`);
    }

    const compiler = options.compiler ?? findLatexCompiler();
    if (!compiler) {
        throw new Error(
            "No LaTeX compiler found. Install TeX Live:\n" +
            "  Ubuntu/WSL: sudo apt-get install texlive-latex-extra texlive-fonts-recommended\n" +
            "  macOS:      brew install --cask mactex\n" +
            "  Windows:    https://miktex.org/download"
        );
    }

    const dir = dirname(absPath);
    const file = basename(absPath);
    const quietFlag = options.quiet ? "-interaction=batchmode" : "-interaction=nonstopmode";

    // Run twice for TOC / cross-references to resolve
    for (let pass = 1; pass <= 2; pass++) {
        try {
            execSync(`${compiler} ${quietFlag} -output-directory="${dir}" "${file}"`, {
                cwd: dir,
                stdio: options.quiet ? "ignore" : "pipe",
                timeout: 60_000, // 60s timeout per pass
            });
        } catch (err) {
            if (pass === 1) {
                // First pass may have warnings; continue to second pass
                continue;
            }
            const msg = err instanceof Error ? err.message : String(err);
            throw new Error(`LaTeX compilation failed on pass ${pass}: ${msg}`);
        }
    }

    const pdfPath = absPath.replace(/\.tex$/, ".pdf");
    if (!existsSync(pdfPath)) {
        throw new Error(
            `PDF was not generated. Check the log file: ${absPath.replace(/\.tex$/, ".log")}`
        );
    }

    return pdfPath;
}

/**
 * Clean up auxiliary files generated during LaTeX compilation.
 */
export function cleanAuxFiles(texPath: string): void {
    const absPath = resolve(texPath);
    const base = absPath.replace(/\.tex$/, "");
    const auxExts = [".aux", ".log", ".toc", ".out", ".fls", ".fdb_latexmk", ".synctex.gz"];

    for (const ext of auxExts) {
        const auxFile = base + ext;
        if (existsSync(auxFile)) {
            try {
                const { unlinkSync } = require("fs");
                unlinkSync(auxFile);
            } catch {
                // ignore cleanup failures
            }
        }
    }
}
