(() => {
  if (window !== window.top || location.origin !== __ORIGIN__) return;
  const values = __PREFERENCES__;
  const documentId = crypto.randomUUID();
  const pending = new Map();
  const writes = new Map();
  const failures = new Map();
  let sequence = 0;
  function call(method, args) {
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('Desktop operation timed out.')); }, 35000);
      pending.set(id, { resolve, reject, timer });
      window.webkit.messageHandlers.lifeManager.postMessage({ method, id, documentId, ...args });
    });
  }
  Object.defineProperty(window, 'lifeManagerCocoaReply', { value: (document, id, result, error) => {
    if (document !== documentId) return;
    const request = pending.get(id);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(id);
    if (error) request.reject(new Error(error)); else request.resolve(result);
  }});
  Object.defineProperty(window, 'lifeManagerDesktop', { value: Object.freeze({
    sendT3: (prompt, webhookUrl) => call('sendT3', { prompt, webhookUrl }),
    preferences: Object.freeze({
      getItem: key => values[key] ?? null,
      setItem: (key, value) => {
        values[key] = value;
        const write = call('setPreference', { key, value });
        writes.set(key, write);
        write.then(() => { if (writes.get(key) === write) failures.delete(key); }, () => {
          if (writes.get(key) === write) failures.set(key, 'Client preferences could not be saved.');
        }).finally(() => { if (writes.get(key) === write) writes.delete(key); });
      },
    }),
  })});
  Object.defineProperty(window, 'lifeManagerCocoaQuit', { value: async token => {
    let error = null;
    try {
      document.activeElement?.blur();
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!window.lifeManagerFlush) throw new Error('The workspace is not ready to save.');
      await window.lifeManagerFlush();
      await Promise.all(writes.values());
      if (failures.size) throw new Error('Client preferences could not be saved.');
    } catch (cause) { error = cause.message || String(cause); }
    window.webkit.messageHandlers.lifeManager.postMessage({ method: 'quitResult', token, error });
  }});
})();
