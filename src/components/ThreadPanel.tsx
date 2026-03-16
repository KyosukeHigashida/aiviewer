import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnnotationThread, SelectionDraft } from '../types/annotation';

type ThreadPanelProps = {
  activeThread: AnnotationThread | null;
  activeThreadId: string | null;
  currentDocumentName: string | null;
  isInitializing: boolean;
  isMobileSheetExpanded: boolean;
  legacyThreads: AnnotationThread[];
  onAppendMessage: (threadId: string, content: string) => void;
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
  activeThread,
  activeThreadId,
  currentDocumentName,
  isInitializing,
  isMobileSheetExpanded,
  legacyThreads,
  onAppendMessage,
  selectionDraft,
  threads,
  onActivateThread,
  onCreateThread,
  onClearSelection,
  onToggleMobileSheet,
}: ThreadPanelProps) {
  const [newThreadComment, setNewThreadComment] = useState('');
  const [replyComment, setReplyComment] = useState('');
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setNewThreadComment('');
  }, [selectionDraft]);

  useEffect(() => {
    setReplyComment('');
  }, [activeThreadId]);

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
  const isReplyMode = !hasSelection && Boolean(activeThread);
  const canCreate = Boolean(currentDocumentName) && hasSelection && newThreadComment.trim().length > 0;
  const canReply = Boolean(activeThread) && replyComment.trim().length > 0;
  const latestMessage = activeThread?.messages[activeThread.messages.length - 1] ?? null;

  const handleReply = () => {
    if (!activeThread || !canReply) {
      return;
    }

    onAppendMessage(activeThread.id, replyComment);
    setReplyComment('');
  };

  const handleCreate = () => {
    if (!canCreate) {
      return;
    }

    onCreateThread(newThreadComment);
    setNewThreadComment('');
  };

  const threadCards = useMemo(() => {
    return threads.map((thread) => {
      const latestThreadMessage = thread.messages[thread.messages.length - 1];
      const preview = latestThreadMessage?.content ?? thread.comment ?? '';
      const previewSingleLine = preview.replace(/\s+/g, ' ').trim();
      const previewText =
        previewSingleLine.length > 92 ? `${previewSingleLine.slice(0, 92)}...` : previewSingleLine;

      return {
        ...thread,
        latestPreview: previewText,
        latestCreatedAt: latestThreadMessage?.createdAt ?? thread.createdAt,
        messageCount: thread.messages.length,
      };
    });
  }, [threads]);

  return (
    <div className="thread-panel">
      <button
        aria-expanded={isMobileSheetExpanded}
        className="thread-sheet-handle"
        onClick={onToggleMobileSheet}
        type="button"
      >
        <span className="thread-sheet-grip" />
        <span className="thread-sheet-title">メモ</span>
        <span className="thread-sheet-state">{threads.length} 件</span>
      </button>

      <div className="thread-panel-scroll">
        {activeThread ? (
          <div className="panel-section composer-section reply-composer-section">
            <div className="panel-section-header">
              <h2>返信中</h2>
              <span className="thread-count">{activeThread.messages.length} 件</span>
            </div>
            <div className="reply-target-card">
              <p className="reply-target-label">対象</p>
              <p className="reply-target-quote">「{activeThread.quotePreview}」</p>
            </div>
            <div className="thread-history" role="log">
              {activeThread.messages.map((message) => (
                <article
                  className={`thread-message${message.role === 'assistant' ? ' is-assistant' : ''}`}
                  key={message.id}
                >
                  <div className="thread-message-header">
                    <span className="thread-message-role">
                      {message.role === 'assistant' ? 'Assistant' : 'You'}
                    </span>
                    <span className="thread-message-date">{formatDate(message.createdAt)}</span>
                  </div>
                  <p className="thread-message-content">{message.content}</p>
                </article>
              ))}
            </div>
            <textarea
              id="reply-comment"
              className="comment-input"
              onChange={(event) => setReplyComment(event.target.value)}
              placeholder="このスレッドにコメントを追加します。"
              rows={3}
              value={replyComment}
            />
            <div className="composer-actions">
              <span className="composer-inline-hint">
                {isReplyMode ? `最新: ${latestMessage ? formatDate(latestMessage.createdAt) : '返信なし'}` : '返信できます。'}
              </span>
              <button
                className="primary-button compact-button"
                disabled={!canReply}
                onClick={handleReply}
                type="button"
              >
                返信
              </button>
            </div>
          </div>
        ) : null}

        <div className="panel-section composer-section">
          <div className="panel-section-header">
            <h2>新規スレッド</h2>
            {hasSelection ? (
              <button className="ghost-button compact-button" onClick={onClearSelection} type="button">
                選択解除
              </button>
            ) : null}
          </div>
          <div className={`selection-card${hasSelection ? '' : ' is-empty'}${hasSelection ? ' has-selection' : ''}`}>
            {hasSelection
              ? selectionDraft?.selectedText
              : isInitializing
                ? '保存済みの PDF と注釈を復元しています。'
                : currentDocumentName
                  ? 'PDF 上のテキストを選択してください。'
                  : '先にローカルの PDF を選択してください。'}
          </div>
          <textarea
            id="new-thread-comment"
            className="comment-input"
            onChange={(event) => setNewThreadComment(event.target.value)}
            placeholder={
              !currentDocumentName
                ? 'PDF を選択すると、ここにコメントを入力できます。'
                : hasSelection
                  ? '選択箇所に対するメモや論点を書きます。'
                  : 'PDF 上のテキストを選ぶと、新規スレッドを作成できます。'
            }
            rows={4}
            value={newThreadComment}
          />
          <div className="composer-actions">
            {hasSelection ? null : (
              <span className="composer-inline-hint">
                {!currentDocumentName
                  ? 'PDF を選択してください。'
                  : activeThread
                    ? '返信中でも新規スレッドを作れます。'
                    : 'スレッドをタップすると返信できます。'}
              </span>
            )}
            <button
              className="primary-button compact-button"
              disabled={!canCreate}
              onClick={handleCreate}
              type="button"
            >
              保存
            </button>
          </div>
        </div>

        <div className="panel-section list-section">
          <div className="panel-section-header">
            <h2>保存済み</h2>
            <span className="thread-count">{threads.length} 件</span>
          </div>
          {threads.length === 0 ? (
            <p className="empty-state">
              {currentDocumentName ? 'この PDF に保存済みスレッドはありません。' : 'PDF を選択すると、この文書のスレッドが表示されます。'}
            </p>
          ) : (
            <ul className="thread-list">
              {threadCards.map((thread) => (
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
                      <div className="thread-card-badges">
                        <span className="thread-badge">{thread.messageCount} 件</span>
                        {typeof thread.pageNumber === 'number' ? (
                          <span className="thread-badge">P.{thread.pageNumber}</span>
                        ) : (
                          <span className="thread-badge is-muted">旧データ</span>
                        )}
                      </div>
                    </div>
                    <p className="thread-comment">{thread.latestPreview || 'コメントはまだありません。'}</p>
                    <p className="thread-meta">{formatDate(thread.latestCreatedAt)}</p>
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
                    <p className="thread-comment">
                      {thread.messages[thread.messages.length - 1]?.content ?? thread.comment}
                    </p>
                    <p className="thread-meta">
                      {formatDate(thread.messages[thread.messages.length - 1]?.createdAt ?? thread.createdAt)}
                    </p>
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
