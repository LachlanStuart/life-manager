/** One disposable SQLite image per browser origin; no connection to a server workspace. */
export function openDemoStorage(name = 'life-manager-browser-demo-v1'): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser storage is unavailable. Enable website storage to try this demo.'));
    request.onblocked = () => reject(new Error('Close other demo tabs and reload to update browser storage.'));
  });
}

export function readDemo(db: IDBDatabase): Promise<Uint8Array | undefined> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readonly');
    const request = transaction.objectStore('workspace').get('sqlite');
    transaction.oncomplete = () => resolve(request.result as Uint8Array | undefined);
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not read demo storage.'));
  });
}

export function writeDemo(db: IDBDatabase, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('workspace', 'readwrite');
    transaction.objectStore('workspace').put(bytes, 'sqlite');
    // Report success only after IndexedDB commits, never merely after put().
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(new Error('The demo could not save to browser storage. It may be full or disabled.'));
  });
}
