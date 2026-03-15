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

type SpanSegment = {
  end: number;
  rect: DOMRect;
  span: HTMLSpanElement;
  start: number;
  text: string;
};

type HighlightRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

function buildSpanSegments(container: HTMLElement) {
  const spans = Array.from(
    container.querySelectorAll<HTMLSpanElement>('.react-pdf__Page__textContent span[role="presentation"]'),
  );
  const segments: SpanSegment[] = [];
  let cursor = 0;

  spans.forEach((span) => {
    const text = normalizeSelectionText(span.textContent ?? '');

    if (!text) {
      return;
    }

    if (segments.length > 0) {
      cursor += 1;
    }

    const start = cursor;
    const end = start + text.length;
    segments.push({
      start,
      end,
      rect: span.getBoundingClientRect(),
      span,
      text,
    });
    cursor = end;
  });

  return {
    pageText: segments.map((segment) => segment.text).join(' '),
    segments,
  };
}

function getCandidateScore(pageText: string, matchStart: number, matchEnd: number, thread: AnnotationThread) {
  const before = pageText.slice(Math.max(0, matchStart - 96), matchStart);
  const after = pageText.slice(matchEnd, Math.min(pageText.length, matchEnd + 96));
  let score = 0;

  if (thread.contextBefore) {
    if (before.endsWith(thread.contextBefore)) {
      score += thread.contextBefore.length + 100;
    } else if (before.includes(thread.contextBefore)) {
      score += thread.contextBefore.length;
    }
  }

  if (thread.contextAfter) {
    if (after.startsWith(thread.contextAfter)) {
      score += thread.contextAfter.length + 100;
    } else if (after.includes(thread.contextAfter)) {
      score += thread.contextAfter.length;
    }
  }

  return score;
}

function highlightThreadInPage(container: HTMLElement, thread: AnnotationThread): HighlightRect[] | null {
  if (typeof thread.pageNumber !== 'number') {
    return null;
  }

  const selectedText = normalizeSelectionText(thread.selectedText);

  if (!selectedText) {
    return null;
  }

  const { pageText, segments } = buildSpanSegments(container);

  if (!pageText || segments.length === 0) {
    return null;
  }

  let searchStart = 0;
  let bestMatch: { end: number; score: number; start: number } | null = null;

  while (searchStart < pageText.length) {
    const matchStart = pageText.indexOf(selectedText, searchStart);

    if (matchStart === -1) {
      break;
    }

    const matchEnd = matchStart + selectedText.length;
    const score = getCandidateScore(pageText, matchStart, matchEnd, thread);

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        start: matchStart,
        end: matchEnd,
        score,
      };
    }

    searchStart = matchStart + 1;
  }

  if (!bestMatch) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const highlightRects = segments
    .map((segment) => {
    const intersects = segment.end > bestMatch.start && segment.start < bestMatch.end;
    if (!intersects) {
      return null;
    }

    return {
      top: segment.rect.top - containerRect.top,
      left: segment.rect.left - containerRect.left,
      width: segment.rect.width,
      height: segment.rect.height,
    };
    })
    .filter((value): value is HighlightRect => value !== null);

  return highlightRects.length > 0 ? highlightRects : null;
}

function mergeHighlightRects(rects: HighlightRect[]) {
  return rects.reduce<HighlightRect[]>((merged, currentRect) => {
    const previousRect = merged[merged.length - 1];

    if (
      previousRect &&
      Math.abs(previousRect.top - currentRect.top) < 2 &&
      Math.abs(previousRect.height - currentRect.height) < 2 &&
      currentRect.left <= previousRect.left + previousRect.width + 6
    ) {
      previousRect.width = Math.max(previousRect.left + previousRect.width, currentRect.left + currentRect.width) - previousRect.left;
      previousRect.height = Math.max(previousRect.height, currentRect.height);
      return merged;
    }

    merged.push({ ...currentRect });
    return merged;
  }, []);
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
  const [highlightRectsByPage, setHighlightRectsByPage] = useState<Record<number, HighlightRect[]>>({});
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const highlightFrameRef = useRef<number | null>(null);
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
    if (highlightFrameRef.current !== null) {
      window.cancelAnimationFrame(highlightFrameRef.current);
      highlightFrameRef.current = null;
    }

    if (!activeThread || typeof activeThread.pageNumber !== 'number') {
      setHighlightRectsByPage({});
      return;
    }

    let frameAttempts = 0;

    const updateHighlight = () => {
      const pageElement = pageRefs.current[activeThread.pageNumber!];
      const textLayer = pageElement?.querySelector('.react-pdf__Page__textContent');

      if (!pageElement || !textLayer) {
        frameAttempts += 1;

        if (frameAttempts < 12) {
          highlightFrameRef.current = window.requestAnimationFrame(updateHighlight);
        } else {
          setHighlightRectsByPage({});
        }

        return;
      }

      const rawRects = highlightThreadInPage(pageElement, activeThread);
      const nextRects = rawRects ? mergeHighlightRects(rawRects) : [];
      setHighlightRectsByPage(
        nextRects.length > 0 ? { [activeThread.pageNumber!]: nextRects } : {},
      );
      highlightFrameRef.current = null;
    };

    updateHighlight();

    return () => {
      if (highlightFrameRef.current !== null) {
        window.cancelAnimationFrame(highlightFrameRef.current);
        highlightFrameRef.current = null;
      }
    };
  }, [activeThread]);

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
                  <div className="page-highlight-overlay" aria-hidden="true">
                    {(highlightRectsByPage[pageNumber] ?? []).map((rect, index) => (
                      <span
                        className="page-highlight-rect"
                        key={`${pageNumber}-${index}`}
                        style={{
                          top: `${rect.top}px`,
                          left: `${rect.left}px`,
                          width: `${rect.width}px`,
                          height: `${rect.height}px`,
                        }}
                      />
                    ))}
                  </div>
                  <Page
                    className={pageNumber === activeThread?.pageNumber ? 'is-active-page' : undefined}
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
