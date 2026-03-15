import { useEffect, useMemo, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import workerSrc from 'react-pdf/node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { AnnotationThread, HighlightRect, SelectionDraft } from '../types/annotation';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

type PdfViewerProps = {
  activeThreadId: string | null;
  documentName: string | null;
  file: string | null;
  isInitializing: boolean;
  onSelectionChange: (selection: SelectionDraft | null) => void;
  onThreadActivate: (threadId: string) => void;
  threads: AnnotationThread[];
};

function normalizeSelectionText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
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

type MatchRange = {
  end: number;
  start: number;
};

type SelectionAnchor = MatchRange & {
  anchorEndSpanIndex: number;
  anchorStartSpanIndex: number;
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

function findBestMatchRange(
  pageText: string,
  selectedText: string,
  options?: {
    approximateStart?: number;
    contextAfter?: string;
    contextBefore?: string;
  },
) {
  let searchStart = 0;
  let bestMatch: { end: number; score: number; start: number } | null = null;

  while (searchStart < pageText.length) {
    const matchStart = pageText.indexOf(selectedText, searchStart);

    if (matchStart === -1) {
      break;
    }

    const matchEnd = matchStart + selectedText.length;
    let score = 0;

    if (options?.contextBefore) {
      const before = pageText.slice(Math.max(0, matchStart - 96), matchStart);
      if (before.endsWith(options.contextBefore)) {
        score += options.contextBefore.length + 100;
      } else if (before.includes(options.contextBefore)) {
        score += options.contextBefore.length;
      }
    }

    if (options?.contextAfter) {
      const after = pageText.slice(matchEnd, Math.min(pageText.length, matchEnd + 96));
      if (after.startsWith(options.contextAfter)) {
        score += options.contextAfter.length + 100;
      } else if (after.includes(options.contextAfter)) {
        score += options.contextAfter.length;
      }
    }

    if (typeof options?.approximateStart === 'number') {
      score += Math.max(0, 160 - Math.abs(matchStart - options.approximateStart));
    }

    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        start: matchStart,
        end: matchEnd,
        score,
      };
    }

    searchStart = matchStart + 1;
  }

  return bestMatch;
}

function buildContextFromRange(pageText: string, range: MatchRange | null) {
  if (!range) {
    return {
      contextBefore: '',
      contextAfter: '',
    };
  }

  return {
    contextBefore: pageText.slice(Math.max(0, range.start - 48), range.start).trim(),
    contextAfter: pageText.slice(range.end, range.end + 48).trim(),
  };
}

function getSelectionAnchor(
  selection: Selection,
  container: HTMLElement,
  selectedText: string,
): SelectionAnchor | null {
  const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
  const { pageText, segments } = buildSpanSegments(container);

  if (!range || !pageText || segments.length === 0) {
    return null;
  }

  const intersectingSegments = segments.flatMap((segment, index) => {
    try {
      return range.intersectsNode(segment.span) ? [{ index, segment }] : [];
    } catch {
      return [];
    }
  });

  const approximateStart = intersectingSegments[0]?.segment.start;
  const normalizedSelectedText = normalizeSelectionText(selectedText);

  if (!normalizedSelectedText || intersectingSegments.length === 0) {
    return null;
  }

  const bestMatch = findBestMatchRange(pageText, normalizedSelectedText, {
    approximateStart,
  });

  return bestMatch
    ? {
        start: bestMatch.start,
        end: bestMatch.end,
        anchorStartSpanIndex: intersectingSegments[0].index,
        anchorEndSpanIndex: intersectingSegments[intersectingSegments.length - 1].index,
      }
    : null;
}

function getHighlightRange(thread: AnnotationThread, pageText: string) {
  if (
    typeof thread.selectionStart === 'number' &&
    typeof thread.selectionEnd === 'number' &&
    thread.selectionEnd > thread.selectionStart
  ) {
    return {
      start: thread.selectionStart,
      end: thread.selectionEnd,
    } satisfies MatchRange;
  }

  const selectedText = normalizeSelectionText(thread.selectedText);

  if (!selectedText) {
    return null;
  }

  const bestMatch = findBestMatchRange(pageText, selectedText, {
    contextBefore: thread.contextBefore,
    contextAfter: thread.contextAfter,
  });

  return bestMatch
    ? {
        start: bestMatch.start,
        end: bestMatch.end,
      }
    : null;
}

function getRectsFromSpanAnchor(segments: SpanSegment[], thread: AnnotationThread) {
  if (
    typeof thread.anchorStartSpanIndex !== 'number' ||
    typeof thread.anchorEndSpanIndex !== 'number' ||
    thread.anchorStartSpanIndex < 0 ||
    thread.anchorEndSpanIndex < 0
  ) {
    return null;
  }

  const startIndex = Math.max(0, Math.min(thread.anchorStartSpanIndex, thread.anchorEndSpanIndex));
  const endIndex = Math.min(
    segments.length - 1,
    Math.max(thread.anchorStartSpanIndex, thread.anchorEndSpanIndex),
  );

  if (!segments[startIndex] || !segments[endIndex]) {
    return null;
  }

  return segments.slice(startIndex, endIndex + 1);
}

function getSelectionHighlightRects(range: Range, container: HTMLElement) {
  const containerRect = container.getBoundingClientRect();
  const rects = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 1 && rect.height > 1)
    .map((rect) => {
      return {
        top: rect.top - containerRect.top,
        left: rect.left - containerRect.left,
        width: rect.width,
        height: rect.height,
      } satisfies HighlightRect;
    });

  return rects.length > 0 ? mergeHighlightRects(rects) : null;
}

function highlightThreadInPage(container: HTMLElement, thread: AnnotationThread): HighlightRect[] | null {
  if (typeof thread.pageNumber !== 'number') {
    return null;
  }

  if (thread.highlightRects && thread.highlightRects.length > 0) {
    return thread.highlightRects;
  }

  const { pageText, segments } = buildSpanSegments(container);

  if (!pageText || segments.length === 0) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const anchoredSegments = getRectsFromSpanAnchor(segments, thread);
  const matchedSegments =
    anchoredSegments ??
    (() => {
      const highlightRange = getHighlightRange(thread, pageText);

      if (!highlightRange) {
        return null;
      }

      return segments.filter((segment) => {
        return segment.end > highlightRange.start && segment.start < highlightRange.end;
      });
    })();

  if (!matchedSegments || matchedSegments.length === 0) {
    return null;
  }

  const highlightRects = matchedSegments.map((segment) => {
    return {
      top: segment.rect.top - containerRect.top,
      left: segment.rect.left - containerRect.left,
      width: segment.rect.width,
      height: segment.rect.height,
    };
  });

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
  documentName,
  file,
  isInitializing,
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
    setHighlightRectsByPage({});
    onSelectionChange(null);
  }, [file, onSelectionChange]);

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
      const selectionRange = selection?.rangeCount ? selection.getRangeAt(0) : null;
      const text = normalizeSelectionText(selection?.toString() ?? '');

      if (!selection || !selectionRange || !text) {
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

      const selectionAnchor = getSelectionAnchor(selection, pageContainer, text);
      const highlightRects = getSelectionHighlightRects(selectionRange, pageContainer) ?? [];
      const context = buildContextFromRange(pageText, selectionAnchor);
      onSelectionChange({
        selectedText: text,
        pageNumber,
        contextBefore: context.contextBefore,
        contextAfter: context.contextAfter,
        selectionStart: selectionAnchor?.start ?? 0,
        selectionEnd: selectionAnchor?.end ?? 0,
        anchorStartSpanIndex: selectionAnchor?.anchorStartSpanIndex ?? -1,
        anchorEndSpanIndex: selectionAnchor?.anchorEndSpanIndex ?? -1,
        highlightRects,
      });
    }, 0);
  };

  return (
    <div className="pdf-viewer" onMouseUp={handleMouseUp}>
      <div className="viewer-toolbar">
        <span className="viewer-label">{documentName ?? 'PDF 未選択'}</span>
        {pageCount > 0 ? <span className="viewer-meta">{pageCount} ページ</span> : null}
      </div>

      <div className="document-frame">
        {!file ? (
          <div className="viewer-empty-state">
            <p className="viewer-empty-title">
              {isInitializing ? '保存済みの PDF を復元しています。' : 'PDF をまだ開いていません。'}
            </p>
            <p className="viewer-empty-copy">
              {isInitializing
                ? '前回の文書が保存されていれば、このエリアに自動で表示されます。'
                : '上の「PDF を選択」からローカルの PDF ファイルを選ぶと、ここに表示されます。'}
            </p>
          </div>
        ) : (
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
        )}
      </div>
    </div>
  );
}
