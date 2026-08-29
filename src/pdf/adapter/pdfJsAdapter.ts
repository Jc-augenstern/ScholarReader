import {
  GlobalWorkerOptions,
  getDocument,
  TextLayer,
  version,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import pdfWorkerUrl from "./pdfWorker.ts?worker&url";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export const pdfJsVersion = version;

export function loadPdfDocument(source: string | Uint8Array): PDFDocumentLoadingTask {
  return getDocument(typeof source === "string" ? { url: source } : { data: source });
}

export function renderPdfPage(input: {
  page: PDFPageProxy;
  canvas: HTMLCanvasElement;
  textLayer: HTMLDivElement;
  scale: number;
  rotation: number;
}): { promise: Promise<string>; cancel: () => void } {
  const { page, canvas, textLayer, scale, rotation } = input;
  const viewport = page.getViewport({ scale, rotation });
  const outputScale = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  textLayer.replaceChildren();
  textLayer.style.width = `${Math.floor(viewport.width)}px`;
  textLayer.style.height = `${Math.floor(viewport.height)}px`;
  textLayer.style.setProperty("--total-scale-factor", String(scale));

  const renderTask = page.render({
    canvas,
    viewport,
    transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
  });
  let layer: TextLayer | null = null;
  let cancelled = false;
  const textPromise = page.getTextContent().then(async (textContent) => {
    const text = textContent.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (cancelled) return text;
    layer = new TextLayer({ container: textLayer, textContentSource: textContent, viewport });
    await layer.render();
    return text;
  });

  return {
    promise: Promise.all([renderTask.promise, textPromise]).then(([, text]) => text),
    cancel: () => {
      cancelled = true;
      renderTask.cancel();
      layer?.cancel();
    },
  };
}

export async function extractPageText(pdf: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  return content.items
    .map((item) => ("str" in item ? item.str : ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export type { PDFDocumentProxy, PDFPageProxy };
