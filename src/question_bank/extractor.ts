import { getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api.js";
import type { PageContent } from "./models.js";

/**
 * Extract text from a single page's text content items.
 */
function extractTextFromItems(items: unknown[]): string {
    return items
        .filter((item): item is TextItem => {
            return item !== null && typeof item === "object" && "str" in item;
        })
        .map((item) => item.str + (item.hasEOL ? "\n" : ""))
        .join("");
}

/**
 * Extract text content from every page of a PDF file.
 *
 * Uses Mozilla's pdf.js (pdfjs-dist) which handles:
 * - Digital PDFs with embedded text
 * - Complex layouts, multi-column pages
 * - Large files (streams pages one at a time)
 */
export async function extractPDF(filePath: string): Promise<PageContent[]> {
    const doc: PDFDocumentProxy = await getDocument(filePath).promise;
    const totalPages = doc.numPages;

    // Extract all pages in parallel for speed
    const pagePromises = Array.from({ length: totalPages }, async (_, i) => {
        const pageNum = i + 1;
        const page = await doc.getPage(pageNum);
        const textContent = await page.getTextContent();
        const text = extractTextFromItems(textContent.items);
        return { pageNumber: pageNum, text: text.trim() };
    });

    const pages = await Promise.all(pagePromises);

    await doc.destroy();
    return pages.sort((a, b) => a.pageNumber - b.pageNumber);
}

/**
 * Extract a specific range of pages (1-indexed, inclusive).
 */
export async function extractPageRange(
    filePath: string,
    startPage: number,
    endPage: number
): Promise<PageContent[]> {
    const doc: PDFDocumentProxy = await getDocument(filePath).promise;
    const pages: PageContent[] = [];
    const lastPage = Math.min(endPage, doc.numPages);

    for (let i = startPage; i <= lastPage; i++) {
        const page = await doc.getPage(i);
        const textContent = await page.getTextContent();
        const text = extractTextFromItems(textContent.items);

        pages.push({
            pageNumber: i,
            text: text.trim(),
        });
    }

    await doc.destroy();
    return pages;
}

/**
 * Get the total number of pages in a PDF without extracting content.
 */
export async function getPageCount(filePath: string): Promise<number> {
    const doc = await getDocument(filePath).promise;
    const count = doc.numPages;
    await doc.destroy();
    return count;
}
