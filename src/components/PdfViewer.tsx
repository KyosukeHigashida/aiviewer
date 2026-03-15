import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import workerSrc from 'react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { AnnotationThread, SelectionDraft } from '../types/annotation';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type PdfViewerProps = {
  activeThreadId: string | null;
  file: string;
  onSelectionChange: (selection: SelectionDraft | null) => void;
  onThreadActivate: (threadId: string) => void;
  threads: AnnotationThread[];
};

function normalizeSelectionText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function buildContext(fullText: string, selectedText: string) {
  const normalizedFullText = normalizeSelectionText(fullText);
  const normalizedSelectedText = normalizeSelectionText(selectedText);
  const matchIndex = normalizedFullText.indexOf(normalizedSelectedText);

  if (matchIndex === -1) {
    return {
      contextBefore: '',
      contextAfter: '',
    };
  }

  return {
    contextBefore: normalizedFullText.slice(Math.max(0, matchIndex - 48), matchIndex).trim(),
    contextAfter: normalizedFullText
      .slice(matchIndex + normalizedSelectedText.length, matchIndex + normalizedSelectedText.length + 48)
      .trim(),
  };
}

function hasAnchor(thread: AnnotationThread) {
  return typeof thread.pageNumber === 'number';
}

export function PdfViewer({
  activeThreadId,
  file,
  onSelectionChange,
  onThreadActivate,
  threads,
}: PdfViewerProps) {
  const [pageCount, setPageCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const activeThread = threads.find((thread) => thread.id === activeThreadId) ?? null;

  const pages = useMemo(
    () => Array.from({ length: pageCount }, (_, index) => index + 1),
    [pageCount],
  );

  const threadsByPage = useMemo(() => {
    return threads.reduce<Record<number, AnnotationThread[]>>((accumulator, thread) => {
      if (!hasAnchor(thread) || typeof thread.pageNumber !== 'number') {
        return accumulator;
      }

      if (!accumulator[thread.pageNumber]) {
        accumulator[thread.pageNumber] = [];
      }

      accumulator[thread.pageNumber].push(thread);
      return accumulator;
    }, {});
  }, [threads]);

  useEffect(() => {
    if (!activeThread || typeof activeThread.pageNumber !== 'number') {
      return;
    }

    const pageElement = pageRefs.current[activeThread.pageNumber];
    pageElement?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
  }, [activeThread]);

  const handleMouseUp = () => {
    window.setTimeout(() => {
      const selection = window.getSelection();
      const text = normalizeSelectionText(selection?.toString() ?? '');

      if (!selection || !text) {
        onSelectionChange(null);
        return;
      }

      const anchorElement = selection.anchorNode?.parentElement;
      const pageContainer = anchorElement?.closest<HTMLElement>('[data-page-number]');
      const pageNumberValue = pageContainer?.dataset.pageNumber;
      const pageNumber = pageNumberValue ? Number(pageNumberValue) : Number.NaN;
      const textLayer = pageContainer?.querySelector('.react-pdf__Page__textContent');
      const pageText = normalizeSelectionText(textLayer?.textContent ?? '');

      if (!pageContainer || Number.isNaN(pageNumber) || !pageText) {
        onSelectionChange(null);
        return;
      }

      const context = buildContext(pageText, text);
      onSelectionChange({
        selectedText: text,
        pageNumber,
        contextBefore: context.contextBefore,
        contextAfter: context.contextAfter,
      });
    }, 0);
  };

  return (
    <div className="pdf-viewer" onMouseUp={handleMouseUp}>
      <div className="viewer-toolbar">
        <span className="viewer-label">固定サンプル PDF</span>
        {pageCount > 0 ? <span className="viewer-meta">{pageCount} ページ</span> : null}
      </div>

      <div className="document-frame">
        <Document
          file={file}
          loading={<p className="viewer-status">PDF を読み込んでいます。</p>}
          onLoadSuccess={({ numPages }) => {
            setPageCount(numPages);
            setLoadError(null);
          }}
          onLoadError={(error) => {
            setLoadError(error.message);
            setPageCount(0);
          }}
          error={
            <div className="viewer-status viewer-status-error">
              <p>PDF の読み込みに失敗しました。</p>
              {loadError ? <p className="viewer-error-detail">{loadError}</p> : null}
            </div>
          }
        >
          {loadError ? (
            <div className="viewer-status viewer-status-error">
              <p>PDF の読み込みに失敗しました。</p>
              <p className="viewer-error-detail">{loadError}</p>
            </div>
          ) : (
            <div className="page-stack">
              {pages.map((pageNumber) => (
                <div
                  className="page-card"
                  data-page-number={pageNumber}
                  key={pageNumber}
                  ref={(element) => {
                    pageRefs.current[pageNumber] = element;
                  }}
                >
                  <div className="page-marker-rail">
                    {(threadsByPage[pageNumber] ?? []).map((thread, index) => {
                      const isActive = thread.id === activeThreadId;
                      return (
                        <button
                          className={`page-marker${isActive ? ' is-active' : ''}`}
                          key={thread.id}
                          onClick={() => onThreadActivate(thread.id)}
                          style={{ top: `${16 + index * 36}px` }}
                          title={thread.quotePreview}
                          type="button"
                        >
                          <span className="page-marker-dot" />
                        </button>
                      );
                    })}
                  </div>
                  <Page
                    pageNumber={pageNumber}
                    renderAnnotationLayer={false}
                    width={900}
                  />
                </div>
              ))}
            </div>
          )}
        </Document>
      </div>
    </div>
  );
}
