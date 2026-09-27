export async function api<T>(path: string, input?: unknown): Promise<T> {
  const body = input === undefined ? undefined : JSON.stringify(input);
  const response = await fetch(`/api/${path}`, body === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Life-Manager': '1' }, body,
    keepalive: new TextEncoder().encode(body).length < 60_000,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data as T;
}

export async function uploadImage(file: File): Promise<string> {
  const response = await fetch('/api/attachments', { method: 'POST', headers: { 'X-Life-Manager': '1', 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Image upload failed.');
  return data.url;
}
