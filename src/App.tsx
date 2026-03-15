import { useEffect, useState } from 'react';
import { PdfViewer } from './components/PdfViewer';
import { ThreadPanel } from './components/ThreadPanel';
import type { AnnotationThread, SelectionDraft } from './types/annotation';
import { loadThreads, saveThreads } from './lib/storage';

const SAMPLE_PDF_PATH = '/sample.pdf';

function createThreadId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `thread-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function buildQuotePreview(text: string) {
  const singleLine = text.replace(/\s+/g, ' ').trim();
  return singleLine.length > 96 ? `${singleLine.slice(0, 96)}...` : singleLine;
}

export default function App() {
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [threads, setThreads] = useState<AnnotationThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);

  useEffect(() => {
    setThreads(loadThreads());
  }, []);

  useEffect(() => {
    saveThreads(threads);
  }, [threads]);

  const handleCreateThread = (comment: string) => {
    if (!selectionDraft) {
      return;
    }

    const normalizedText = selectionDraft.selectedText.replace(/\s+/g, ' ').trim();
    const normalizedComment = comment.trim();

    if (!normalizedText || !normalizedComment) {
      return;
    }

    const nextThread: AnnotationThread = {
      id: createThreadId(),
      selectedText: normalizedText,
      quotePreview: buildQuotePreview(normalizedText),
      comment: normalizedComment,
      createdAt: new Date().toISOString(),
      pageNumber: selectionDraft.pageNumber,
      contextBefore: selectionDraft.contextBefore,
      contextAfter: selectionDraft.contextAfter,
    };

    setThreads((current) => [nextThread, ...current]);
    setSelectionDraft(null);
    setActiveThreadId(nextThread.id);
  };

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <p className="eyebrow">研究・技術文書の読解用 PDF ビューア</p>
          <h1>最初の実装イテレーション</h1>
        </div>
      </header>
      <main className="app-layout">
        <section className="viewer-pane">
          <PdfViewer
            activeThreadId={activeThreadId}
            file={SAMPLE_PDF_PATH}
            onSelectionChange={setSelectionDraft}
            onThreadActivate={setActiveThreadId}
            threads={threads}
          />
        </section>
        <aside className="thread-pane">
          <ThreadPanel
            activeThreadId={activeThreadId}
            selectionDraft={selectionDraft}
            threads={threads}
            onActivateThread={setActiveThreadId}
            onCreateThread={handleCreateThread}
            onClearSelection={() => setSelectionDraft(null)}
          />
        </aside>
      </main>
    </div>
  );
}
