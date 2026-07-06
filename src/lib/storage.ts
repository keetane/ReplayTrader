import type { PersistedSession } from "../types";

const DB_NAME = "replay-trader";
const STORE_NAME = "sessions";
const SESSION_KEY = "latest";

export async function saveSession(session: PersistedSession): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(session, SESSION_KEY));
  db.close();
}

export async function loadSession(): Promise<PersistedSession | undefined> {
  const db = await openDb();
  const result = await requestToPromise<PersistedSession | undefined>(
    db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(SESSION_KEY),
  );
  db.close();
  return result;
}

export async function clearSession(): Promise<void> {
  const db = await openDb();
  await requestToPromise(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(SESSION_KEY));
  db.close();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
