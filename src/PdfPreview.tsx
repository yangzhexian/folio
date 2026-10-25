import { useEffect, useRef, useState } from 'react';
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, PDFWorker, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

type PdfLibrary = typeof import('pdfjs-dist');

export interface PdfPreviewProps {
  data: Uint8Array;
  page: number;
  zoom: number;
  viewport: { width: number; height: number };
  onPageCount: (count: number) => void;
  onBusy: (busy: boolean) => void;
  onError: (code: string) => void;
}

function errorCode(error: unknown): string {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return 'PREVIEW_PASSWORD';
  if (name === 'InvalidPDFException' || name === 'FormatError' || name === 'UnknownErrorException') return 'PREVIEW_INVALID';
  return 'PREVIEW_UNAVAILABLE';
}

const MAX_CANVAS_PIXELS = 16_000_000;
const MAX_CANVAS_DIMENSION = 8192;

export default function PdfPreview({ data, page, zoom, viewport, onPageCount, onBusy, onError }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const callbacks = useRef({ onPageCount, onBusy, onError });
  callbacks.current = { onPageCount, onBusy, onError };
  const renderTask = useRef<RenderTask | null>(null);
  const renderQueue = useRef<Promise<void>>(Promise.resolve());
  const renderedPage = useRef<PDFPageProxy | null>(null);
  const [loaded, setLoaded] = useState<{ data: Uint8Array; document: PDFDocumentProxy; library: PdfLibrary } | null>(null);

  useEffect(() => {
    let active = true;
    let worker: PDFWorker | undefined;
    let loadingTask: PDFDocumentLoadingTask | undefined;
    setLoaded(null);
    callbacks.current.onBusy(true);
    callbacks.current.onPageCount(0);

    void (async () => {
      try {
        const library = await import('pdfjs-dist');
        if (!active) return;
        library.GlobalWorkerOptions.workerSrc = workerUrl;
        worker = new library.PDFWorker();
        const assets = new URL(`${import.meta.env.BASE_URL}pdfjs-assets/`, window.location.href).href;
        loadingTask = library.getDocument({
          // PDF.js transfers ownership to its worker. Keep the parent's bytes intact for remounts.
          data: data.slice(),
          worker,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`,
          useWorkerFetch: true,
          enableXfa: false,
          isOffscreenCanvasSupported: false,
          isImageDecoderSupported: false,
          maxImageSize: 32_000_000,
          canvasMaxAreaInBytes: MAX_CANVAS_PIXELS * 4,
          stopAtErrors: true,
          verbosity: library.VerbosityLevel.ERRORS,
        });
        const document = await loadingTask.promise;
        if (!active) return;
        callbacks.current.onPageCount(document.numPages);
        setLoaded({ data, document, library });
      } catch (error) {
        if (!active) return;
        callbacks.current.onBusy(false);
        callbacks.current.onError(errorCode(error));
      }
    })();

    return () => {
      active = false;
      renderTask.current?.cancel();
      renderedPage.current = null;
      // A supplied PDFWorker belongs to this component, not to the loading task.
      if (loadingTask) void loadingTask.destroy().catch(() => {}).finally(() => worker?.destroy());
      else worker?.destroy();
    };
  }, [data]);

  useEffect(() => {
    if (!loaded || loaded.data !== data || viewport.width <= 0 || viewport.height <= 0) return;
    let active = true;
    renderTask.current?.cancel();
    callbacks.current.onBusy(true);
    const canvas = canvasRef.current;

    // Cancellation is asynchronous. Serialize canvas reuse so rapid page/zoom changes cannot overlap.
    renderQueue.current = renderQueue.current.catch(() => {}).then(async () => {
      if (!active || !canvas) return;
      let currentTask: RenderTask | undefined;
      try {
        const pdfPage = await loaded.document.getPage(page);
        if (!active) return;
        if (renderedPage.current && renderedPage.current !== pdfPage) renderedPage.current.cleanup();
        renderedPage.current = pdfPage;
        const unscaled = pdfPage.getViewport({ scale: 1 });
        if (![unscaled.width, unscaled.height, zoom].every(Number.isFinite) || unscaled.width <= 0 || unscaled.height <= 0 || zoom <= 0) {
          throw new Error('Invalid page dimensions');
        }
        const fit = Math.min(viewport.width / unscaled.width, viewport.height / unscaled.height);
        const display = pdfPage.getViewport({ scale: fit * zoom });
        const density = Math.min(
          window.devicePixelRatio || 1,
          MAX_CANVAS_DIMENSION / display.width,
          MAX_CANVAS_DIMENSION / display.height,
          Math.sqrt(MAX_CANVAS_PIXELS / (display.width * display.height)),
        );
        canvas.width = Math.max(1, Math.floor(display.width * density));
        canvas.height = Math.max(1, Math.floor(display.height * density));
        canvas.style.width = `${display.width}px`;
        canvas.style.height = `${display.height}px`;
        delete canvas.dataset.renderedPage;
        currentTask = pdfPage.render({
          canvas,
          viewport: display,
          transform: [density, 0, 0, density, 0, 0],
          // Static annotation appearances only: no links, forms, scripts, or embedded files.
          annotationMode: loaded.library.AnnotationMode.ENABLE,
          background: '#ffffff',
        });
        renderTask.current = currentTask;
        await currentTask.promise;
        if (active) canvas.dataset.renderedPage = String(page);
      } catch (error) {
        if (active) callbacks.current.onError(errorCode(error));
      } finally {
        if (renderTask.current === currentTask) renderTask.current = null;
        if (active) callbacks.current.onBusy(false);
      }
    });
    return () => {
      active = false;
      renderTask.current?.cancel();
    };
  }, [loaded, data, page, zoom, viewport.width, viewport.height]);

  return <div className="preview-document"><canvas ref={canvasRef} className="preview-pdf-canvas" /></div>;
}
