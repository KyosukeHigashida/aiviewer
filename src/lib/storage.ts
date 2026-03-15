import type { AnnotationThread } from '../types/annotation';

const STORAGE_KEY = 'viewer.annotationThreads.v1';

export function loadThreads(): AnnotationThread[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const rawValue = window.localStorage.getItem(STORAGE_KEY);

  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? (parsed as AnnotationThread[]) : [];
  } catch {
    return [];
  }
}

export function saveThreads(threads: AnnotationThread[]) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}
