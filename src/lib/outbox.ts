/**
 * Device-side outbox: keeps unsent messages after a refresh so they can be resent.
 * Message details live in localStorage; media files live in IndexedDB (full quality).
 */
import type { ChatMessage } from "@/lib/care-desk";

const KEY = "popotso-outbox-v1";
const DB = "popotso-outbox";
const STORE = "blobs";

export type OutboxItem = ChatMessage;

export function loadOutbox(userId: string): OutboxItem[] {
  if (typeof window === "undefined") return [];
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "[]") as OutboxItem[];
    return all.filter((m) => m.sender_id === userId);
  } catch {
    return [];
  }
}

function saveAll(items: OutboxItem[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    /* storage full — ignore */
  }
}

export function putOutbox(item: ChatMessage) {
  const all = (() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? "[]") as OutboxItem[];
    } catch {
      return [];
    }
  })();
  const clean: OutboxItem = {
    ...item,
    localUrl: undefined,
    pending: false,
    failed: true,
    progress: 0,
  };
  const next = all.filter((m) => m.client_id !== item.client_id);
  next.push(clean);
  saveAll(next);
}

export function removeOutbox(clientId: string) {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "[]") as OutboxItem[];
    saveAll(all.filter((m) => m.client_id !== clientId));
  } catch {
    /* ignore */
  }
  void deleteBlob(clientId);
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveBlob(clientId: string, blob: Blob) {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(blob, clientId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (e) {
    console.warn("Could not keep file for resend", e);
  }
}

export async function getBlob(clientId: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE).objectStore(STORE).get(clientId);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

async function deleteBlob(clientId: string) {
  try {
    const db = await openDb();
    db.transaction(STORE, "readwrite").objectStore(STORE).delete(clientId);
  } catch {
    /* ignore */
  }
}
