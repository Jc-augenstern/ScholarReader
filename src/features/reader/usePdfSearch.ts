import { useEffect, useState } from "react";
import { extractPageText, type PDFDocumentProxy } from "../../pdf/adapter/pdfJsAdapter";

export type PdfSearchResult = {
  pageNumber: number;
  occurrences: number;
  snippet: string;
};

function createSnippet(text: string, query: string): string {
  const index = text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return text.slice(0, 120);
  const start = Math.max(0, index - 52);
  const end = Math.min(text.length, index + query.length + 72);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

export function usePdfSearch(pdf: PDFDocumentProxy | null, query: string) {
  const [results, setResults] = useState<PdfSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [pagesScanned, setPagesScanned] = useState(0);

  useEffect(() => {
    const needle = query.trim();
    if (!pdf || needle.length < 2) {
      setResults([]);
      setSearching(false);
      setPagesScanned(0);
      return;
    }

    let cancelled = false;
    const timeout = window.setTimeout(() => {
      setResults([]);
      setPagesScanned(0);
      setSearching(true);
      void (async () => {
        const normalizedNeedle = needle.toLocaleLowerCase();
        const matches: PdfSearchResult[] = [];
        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
          if (cancelled) return;
          const text = await extractPageText(pdf, pageNumber);
          const haystack = text.toLocaleLowerCase();
          let occurrences = 0;
          let position = haystack.indexOf(normalizedNeedle);
          while (position >= 0) {
            occurrences += 1;
            position = haystack.indexOf(normalizedNeedle, position + normalizedNeedle.length);
          }
          if (occurrences) {
            matches.push({ pageNumber, occurrences, snippet: createSnippet(text, needle) });
            if (!cancelled) setResults([...matches]);
          }
          if (!cancelled) setPagesScanned(pageNumber);
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
        }
        if (!cancelled) setSearching(false);
      })().catch(() => {
        if (!cancelled) setSearching(false);
      });
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [pdf, query]);

  return { results, searching, pagesScanned };
}
