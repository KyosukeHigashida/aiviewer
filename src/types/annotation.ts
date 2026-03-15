export type AnnotationThread = {
  id: string;
  selectedText: string;
  quotePreview: string;
  comment: string;
  createdAt: string;
  pageNumber?: number;
  contextBefore?: string;
  contextAfter?: string;
};

export type SelectionDraft = {
  selectedText: string;
  pageNumber: number;
  contextBefore: string;
  contextAfter: string;
};
