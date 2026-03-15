import { useEffect, useRef, useState } from 'react';
import type { AnnotationThread, SelectionDraft } from '../types/annotation';

type ThreadPanelProps = {
  activeThreadId: string | null;
  currentDocumentName: string | null;
  isMobileSheetExpanded: boolean;
  legacyThreads: AnnotationThread[];
  selectionDraft: SelectionDraft | null;
  threads: AnnotationThread[];
  onActivateThread: (threadId: string) => void;
  onCreateThread: (comment: string) => void;
  onClearSelection: () => void;
  onToggleMobileSheet: () => void;
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function ThreadPanel({
  activeThreadId,
  currentDocumentName,
  isMobileSheetExpanded,
  legacyThreads,
  selectionDraft,
  threads,
  onActivateThread,
  onCreateThread,
  onClearSelection,
  onToggleMobileSheet,
}: ThreadPanelProps) {
  const [comment, setComment] = useState('');
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setComment('');
  }, [selectionDraft]);

  useEffect(() => {
    if (!activeThreadId) {
      return;
    }

    itemRefs.current[activeThreadId]?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [activeThreadId]);

  const hasSelection = selectionDraft?.selectedText.trim().length ? true : false;
  const canSave = Boolean(currentDocumentName) && hasSelection && comment.trim().length > 0;

  const handleSave = () => {
    if (!canSave) {
      return;
    }

    onCreateThread(comment);
    setComment('');
  };

  return (
    <div className="thread-panel">
      <div className="thread-panel-top">
        <button
          aria-expanded={isMobileSheetExpanded}
          className="thread-sheet-handle"
          onClick={onToggleMobileSheet}
          type="button"
        >
          <span className="thread-sheet-grip" />
          <span className="thread-sheet-title">スレッド</span>
          <span className="thread-sheet-state">{isMobileSheetExpanded ? '一覧を閉じる' : '一覧を開く'}</span>
        </button>
        <div className="panel-section composer-section">
          <div className="panel-section-header">
            <h2>新規スレッド</h2>
            {hasSelection ? (
              <button className="ghost-button" onClick={onClearSelection} type="button">
                選択解除
              </button>
            ) : null}
          </div>
          <div className={`selection-card${hasSelection ? '' : ' is-empty'}`}>
            {hasSelection
              ? selectionDraft?.selectedText
              : currentDocumentName
                ? 'PDF 上のテキストを選択すると、ここに引用が表示されます。'
                : '先にローカルの PDF を選択してください。'}
          </div>
          {!currentDocumentName ? (
            <p className="composer-hint">右上の「PDF を選択」から対象の PDF を開いてください。</p>
          ) : !hasSelection ? (
            <p className="composer-hint">
              先に PDF 上のテキストを選択してください。コメントは先に入力できますが、保存は選択後に有効になります。
            </p>
          ) : null}
          <label className="field-label" htmlFor="comment">
            コメント
          </label>
          <textarea
            id="comment"
            className="comment-input"
            onChange={(event) => setComment(event.target.value)}
            placeholder={
              !currentDocumentName
                ? 'PDF を選択すると、ここにコメントを入力できます。'
                : hasSelection
                  ? '選択箇所に対するメモや論点を書きます。'
                  : 'コメントは先に入力できます。保存する前に PDF 上のテキストを選択してください。'
            }
            rows={5}
            value={comment}
          />
          <button className="primary-button" disabled={!canSave} onClick={handleSave} type="button">
            スレッドを保存
          </button>
        </div>
      </div>

      <div className="thread-panel-scroll">
        <div className="panel-section list-section">
          <div className="panel-section-header">
            <h2>保存済みスレッド</h2>
            <span className="thread-count">{threads.length} 件</span>
          </div>
          {threads.length === 0 ? (
            <p className="empty-state">
              {currentDocumentName ? 'この PDF に保存済みスレッドはありません。' : 'PDF を選択すると、この文書のスレッドが表示されます。'}
            </p>
          ) : (
            <ul className="thread-list">
              {threads.map((thread) => (
                <li className="thread-item" key={thread.id}>
                  <button
                    className={`thread-card-button${thread.id === activeThreadId ? ' is-active' : ''}`}
                    disabled={typeof thread.pageNumber !== 'number'}
                    onClick={() => onActivateThread(thread.id)}
                    ref={(element) => {
                      itemRefs.current[thread.id] = element;
                    }}
                    type="button"
                  >
                    <div className="thread-item-header">
                      <p className="thread-quote">「{thread.quotePreview}」</p>
                      {typeof thread.pageNumber === 'number' ? (
                        <span className="thread-badge">P.{thread.pageNumber}</span>
                      ) : (
                        <span className="thread-badge is-muted">旧データ</span>
                      )}
                    </div>
                    <p className="thread-comment">{thread.comment}</p>
                    <p className="thread-meta">{formatDate(thread.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {legacyThreads.length > 0 ? (
          <div className="panel-section list-section">
            <div className="panel-section-header">
              <h2>旧データ</h2>
              <span className="thread-count">{legacyThreads.length} 件</span>
            </div>
            <p className="empty-state">
              文書指紋を持たない旧データです。現在の PDF とは自動で再接続しません。
            </p>
            <ul className="thread-list">
              {legacyThreads.map((thread) => (
                <li className="thread-item" key={thread.id}>
                  <button className="thread-card-button" disabled type="button">
                    <div className="thread-item-header">
                      <p className="thread-quote">「{thread.quotePreview}」</p>
                      <span className="thread-badge is-muted">旧データ</span>
                    </div>
                    <p className="thread-comment">{thread.comment}</p>
                    <p className="thread-meta">{formatDate(thread.createdAt)}</p>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
