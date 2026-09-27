import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createDemoApi } from '../src/browser/demo-api';
import { openDemoStorage } from '../src/browser/storage';

let ready: Promise<ReturnType<typeof createDemoApi>> | undefined;
export async function demoApi<T>(path: string, input?: unknown): Promise<T> {
  if (!navigator.locks) throw new Error('This demo needs a current browser with Web Locks and website storage enabled.');
  ready ??= Promise.all([initSqlJs({ locateFile: () => wasmUrl }), openDemoStorage()])
    .then(([SQL, storage]) => createDemoApi(SQL, storage, async operation => await navigator.locks.request('life-manager-browser-demo-v1', operation)))
    .catch(error => { ready = undefined; throw error; });
  return await (await ready)(path, input) as T;
}

export function demoImage(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) {
    return Promise.reject(new Error('For this demo, choose a PNG, JPEG, GIF or WebP image under 2 MB.'));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(file);
  });
}
