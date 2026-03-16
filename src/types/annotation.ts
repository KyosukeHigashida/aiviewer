export type HighlightRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

export type AnnotationMessage = {
  content: string;
  createdAt: string;
  id: string;
  role: 'user' | 'assistant';
};

export type AnnotationThread = {
  id: string;
  documentFingerprint?: string;
  selectedText: string;
  quotePreview: string;
  comment?: string;
  createdAt: string;
  messages: AnnotationMessage[];
  pageNumber?: number;
  contextBefore?: string;
  contextAfter?: string;
  selectionStart?: number;
  selectionEnd?: number;
  anchorStartSpanIndex?: number;
  anchorEndSpanIndex?: number;
  highlightRects?: HighlightRect[];
};

export type SelectionDraft = {
  selectedText: string;
  pageNumber: number;
  contextBefore: string;
  contextAfter: string;
  selectionStart: number;
  selectionEnd: number;
  anchorStartSpanIndex: number;
  anchorEndSpanIndex: number;
  highlightRects: HighlightRect[];
};
