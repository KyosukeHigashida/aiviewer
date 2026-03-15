import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { PdfViewer } from './components/PdfViewer';
import { ThreadPanel } from './components/ThreadPanel';
import type { AnnotationThread, SelectionDraft } from './types/annotation';
import { loadPersistedState, saveCurrentDocument, saveThread } from './lib/storage';

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

async function createDocumentFingerprint(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

type CurrentDocument = {
  fingerprint: string;
  name: string;
  url: string;
};

export default function App() {
  const [isInitializing, setIsInitializing] = useState(true);
  const [persistenceMessage, setPersistenceMessage] = useState<string | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [threads, setThreads] = useState<AnnotationThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [currentDocument, setCurrentDocument] = useState<CurrentDocument | null>(null);
  const [isPickingFile, setIsPickingFile] = useState(false);
  const [isMobileSheetExpanded, setIsMobileSheetExpanded] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let ignore = false;

    const initialize = async () => {
      setIsInitializing(true);

      try {
        const persistedState = await loadPersistedState();

        if (ignore) {
          return;
        }

        setThreads(persistedState.threads);

        if (persistedState.currentDocument) {
          setCurrentDocument({
            fingerprint: persistedState.currentDocument.fingerprint,
            name: persistedState.currentDocument.name,
            url: URL.createObjectURL(persistedState.currentDocument.blob),
          });
        }
      } catch {
        if (!ignore) {
          setPersistenceMessage('保存済みデータの復元に失敗しました。');
        }
      } finally {
        if (!ignore) {
          setIsInitializing(false);
        }
      }
    };

    void initialize();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (currentDocument?.url) {
        URL.revokeObjectURL(currentDocument.url);
      }
    };
  }, [currentDocument]);

  const currentThreads = currentDocument
    ? threads.filter((thread) => thread.documentFingerprint === currentDocument.fingerprint)
    : [];
  const legacyThreads = threads.filter((thread) => !thread.documentFingerprint);

  const handleCreateThread = (comment: string) => {
    if (!selectionDraft || !currentDocument) {
      return;
    }

    const normalizedText = selectionDraft.selectedText.replace(/\s+/g, ' ').trim();
    const normalizedComment = comment.trim();

    if (!normalizedText || !normalizedComment) {
      return;
    }

    const nextThread: AnnotationThread = {
      id: createThreadId(),
      documentFingerprint: currentDocument.fingerprint,
      selectedText: normalizedText,
      quotePreview: buildQuotePreview(normalizedText),
      comment: normalizedComment,
      createdAt: new Date().toISOString(),
      pageNumber: selectionDraft.pageNumber,
      contextBefore: selectionDraft.contextBefore,
      contextAfter: selectionDraft.contextAfter,
      selectionStart: selectionDraft.selectionStart,
      selectionEnd: selectionDraft.selectionEnd,
      anchorStartSpanIndex: selectionDraft.anchorStartSpanIndex,
      anchorEndSpanIndex: selectionDraft.anchorEndSpanIndex,
      highlightRects: selectionDraft.highlightRects,
    };

    setThreads((current) => [nextThread, ...current]);
    setSelectionDraft(null);
    setActiveThreadId(nextThread.id);
    setPersistenceMessage(null);
    void saveThread(nextThread).catch(() => {
      setPersistenceMessage('スレッドの保存に失敗しました。');
    });
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file || (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf'))) {
      return;
    }

    setIsPickingFile(true);
    setPersistenceMessage(null);
    let fingerprint = '';

    try {
      fingerprint = await createDocumentFingerprint(file);
      const nextUrl = URL.createObjectURL(file);
      await saveCurrentDocument(file, fingerprint);

      setCurrentDocument((current) => {
        if (current?.url) {
          URL.revokeObjectURL(current.url);
        }

        return {
          fingerprint,
          name: file.name,
          url: nextUrl,
        };
      });
      setSelectionDraft(null);
      setActiveThreadId(null);
      setIsMobileSheetExpanded(false);
    } catch {
      setPersistenceMessage('PDF の保存に失敗しました。今回の表示だけ継続します。');

      if (!fingerprint) {
        return;
      }

      const fallbackUrl = URL.createObjectURL(file);

      setCurrentDocument((current) => {
        if (current?.url) {
          URL.revokeObjectURL(current.url);
        }

        return {
          fingerprint,
          name: file.name,
          url: fallbackUrl,
        };
      });
    } finally {
      setIsPickingFile(false);
      event.target.value = '';
    }
  };

  const handleOpenFilePicker = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className={`app-shell${isMobileSheetExpanded ? ' is-mobile-sheet-expanded' : ''}`}>
      <header className="app-header">
        <div className="app-header-copy">
          <p className="eyebrow">研究・技術文書の読解用 PDF ビューア</p>
          <h1>ローカル PDF 読込対応</h1>
          <p className="app-subtitle">
            ローカル PDF を選択して開き、その文書ごとに注釈スレッドを保存します。
          </p>
        </div>
        <div className="app-header-actions">
          <input
            accept="application/pdf"
            className="file-input"
            onChange={handleFileChange}
            ref={fileInputRef}
            type="file"
          />
          <button className="primary-button" onClick={handleOpenFilePicker} type="button">
            {isPickingFile ? 'PDF を準備中...' : 'PDF を選択'}
          </button>
          <p className="document-status">
            {isInitializing
              ? '保存済みの PDF を復元しています。'
              : persistenceMessage
                ? persistenceMessage
                : currentDocument
                  ? currentDocument.name
                  : 'まだ PDF は選択されていません。'}
          </p>
        </div>
      </header>
      <main className="app-layout">
        <section className="viewer-pane">
          <PdfViewer
            activeThreadId={activeThreadId}
            documentName={currentDocument?.name ?? null}
            file={currentDocument?.url ?? null}
            isInitializing={isInitializing}
            onSelectionChange={setSelectionDraft}
            onThreadActivate={setActiveThreadId}
            threads={currentThreads}
          />
        </section>
        <aside className="thread-pane">
          <ThreadPanel
            activeThreadId={activeThreadId}
            currentDocumentName={currentDocument?.name ?? null}
            isMobileSheetExpanded={isMobileSheetExpanded}
            isInitializing={isInitializing}
            legacyThreads={legacyThreads}
            selectionDraft={selectionDraft}
            threads={currentThreads}
            onActivateThread={setActiveThreadId}
            onCreateThread={handleCreateThread}
            onClearSelection={() => setSelectionDraft(null)}
            onToggleMobileSheet={() => setIsMobileSheetExpanded((current) => !current)}
          />
        </aside>
      </main>
    </div>
  );
}
