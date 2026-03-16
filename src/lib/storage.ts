import type { AnnotationMessage, AnnotationThread } from '../types/annotation';

const DB_NAME = 'viewer.persistence';
const DB_VERSION = 1;
const THREADS_STORE = 'threads';
const DOCUMENTS_STORE = 'documents';
const APP_STATE_STORE = 'appState';
const LEGACY_STORAGE_KEY = 'viewer.annotationThreads.v1';
const LAST_DOCUMENT_KEY = 'lastDocumentFingerprint';
const LEGACY_MIGRATION_KEY = 'legacyLocalStorageMigrated';

type AppStateRecord = {
  key: string;
  value: string;
};

type DocumentRecord = {
  blob: Blob;
  fingerprint: string;
  name: string;
  updatedAt: string;
};

export type PersistedDocument = {
  blob: Blob;
  fingerprint: string;
  name: string;
};

type LoadedState = {
  currentDocument: PersistedDocument | null;
  threads: AnnotationThread[];
};

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(THREADS_STORE)) {
        const threadsStore = database.createObjectStore(THREADS_STORE, {
          keyPath: 'id',
        });
        threadsStore.createIndex('byDocumentFingerprint', 'documentFingerprint', {
          unique: false,
        });
      }

      if (!database.objectStoreNames.contains(DOCUMENTS_STORE)) {
        database.createObjectStore(DOCUMENTS_STORE, {
          keyPath: 'fingerprint',
        });
      }

      if (!database.objectStoreNames.contains(APP_STATE_STORE)) {
        database.createObjectStore(APP_STATE_STORE, {
          keyPath: 'key',
        });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened.'));
  });
}

function sortThreads(threads: AnnotationThread[]) {
  return [...threads].sort((left, right) => {
    const leftLastMessage = left.messages[left.messages.length - 1];
    const rightLastMessage = right.messages[right.messages.length - 1];
    const leftTimestamp = new Date(leftLastMessage?.createdAt ?? left.createdAt).getTime();
    const rightTimestamp = new Date(rightLastMessage?.createdAt ?? right.createdAt).getTime();
    return rightTimestamp - leftTimestamp;
  });
}

function createFallbackMessage(thread: AnnotationThread): AnnotationMessage | null {
  const content = thread.comment?.trim();

  if (!content) {
    return null;
  }

  return {
    id: `${thread.id}-legacy-message`,
    role: 'user',
    content,
    createdAt: thread.createdAt,
  };
}

function normalizeThread(thread: AnnotationThread): AnnotationThread {
  const normalizedMessages =
    Array.isArray(thread.messages) && thread.messages.length > 0
      ? thread.messages
      : (() => {
          const fallbackMessage = createFallbackMessage(thread);
          return fallbackMessage ? [fallbackMessage] : [];
        })();

  return {
    ...thread,
    messages: normalizedMessages,
  };
}

function loadLegacyThreads(): AnnotationThread[] {
  const rawValue = window.localStorage.getItem(LEGACY_STORAGE_KEY);

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

async function migrateLegacyThreads(database: IDBDatabase) {
  const appStateTransaction = database.transaction(APP_STATE_STORE, 'readonly');
  const appStateStore = appStateTransaction.objectStore(APP_STATE_STORE);
  const migrationState = await requestToPromise(
    appStateStore.get(LEGACY_MIGRATION_KEY),
  ) as AppStateRecord | undefined;
  await transactionToPromise(appStateTransaction);

  if (migrationState?.value === 'true') {
    return;
  }

  const legacyThreads = loadLegacyThreads();
  const migrationTransaction = database.transaction([THREADS_STORE, APP_STATE_STORE], 'readwrite');
  const threadsStore = migrationTransaction.objectStore(THREADS_STORE);
  const stateStore = migrationTransaction.objectStore(APP_STATE_STORE);

  legacyThreads.forEach((thread) => {
    threadsStore.put(thread);
  });

  stateStore.put({
    key: LEGACY_MIGRATION_KEY,
    value: 'true',
  } satisfies AppStateRecord);

  await transactionToPromise(migrationTransaction);
}

async function loadAllThreads(database: IDBDatabase) {
  const transaction = database.transaction(THREADS_STORE, 'readonly');
  const store = transaction.objectStore(THREADS_STORE);
  const threads = await requestToPromise(store.getAll()) as AnnotationThread[];
  await transactionToPromise(transaction);
  return sortThreads(threads.map(normalizeThread));
}

async function loadLastDocument(database: IDBDatabase) {
  const transaction = database.transaction([APP_STATE_STORE, DOCUMENTS_STORE], 'readonly');
  const stateStore = transaction.objectStore(APP_STATE_STORE);
  const documentStore = transaction.objectStore(DOCUMENTS_STORE);
  const stateRecord = await requestToPromise(
    stateStore.get(LAST_DOCUMENT_KEY),
  ) as AppStateRecord | undefined;

  if (!stateRecord?.value) {
    await transactionToPromise(transaction);
    return null;
  }

  const documentRecord = await requestToPromise(
    documentStore.get(stateRecord.value),
  ) as DocumentRecord | undefined;
  await transactionToPromise(transaction);

  if (!documentRecord) {
    return null;
  }

  return {
    blob: documentRecord.blob,
    fingerprint: documentRecord.fingerprint,
    name: documentRecord.name,
  } satisfies PersistedDocument;
}

export async function loadPersistedState(): Promise<LoadedState> {
  if (typeof window === 'undefined') {
    return {
      currentDocument: null,
      threads: [],
    };
  }

  const database = await openDatabase();
  try {
    await migrateLegacyThreads(database);
    const [threads, currentDocument] = await Promise.all([
      loadAllThreads(database),
      loadLastDocument(database),
    ]);

    return {
      currentDocument,
      threads,
    };
  } finally {
    database.close();
  }
}

export async function saveCurrentDocument(file: File, fingerprint: string) {
  const database = await openDatabase();

  try {
    const transaction = database.transaction([DOCUMENTS_STORE, APP_STATE_STORE], 'readwrite');
    const documentsStore = transaction.objectStore(DOCUMENTS_STORE);
    const appStateStore = transaction.objectStore(APP_STATE_STORE);

    documentsStore.clear();
    documentsStore.put({
      blob: file,
      fingerprint,
      name: file.name,
      updatedAt: new Date().toISOString(),
    } satisfies DocumentRecord);

    appStateStore.put({
      key: LAST_DOCUMENT_KEY,
      value: fingerprint,
    } satisfies AppStateRecord);

    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}

export async function saveThread(thread: AnnotationThread) {
  const database = await openDatabase();

  try {
    const transaction = database.transaction(THREADS_STORE, 'readwrite');
    transaction.objectStore(THREADS_STORE).put(normalizeThread(thread));
    await transactionToPromise(transaction);
  } finally {
    database.close();
  }
}
