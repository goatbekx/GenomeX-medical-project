let worker;
let nextId = 0;
const pending = new Map();

export function predictInBrowser(file) {
  if (!worker) {
    worker = new Worker(new URL('./browser-inference.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data: { id, result, error } }) => {
      const request = pending.get(id);
      if (!request) return;
      pending.delete(id);
      if (error) request.reject(Object.assign(new Error(error.message), { status: error.status }));
      else request.resolve(result);
    };
    worker.onerror = event => {
      event.preventDefault();
      worker.terminate();
      worker = undefined;
      for (const request of pending.values()) request.reject(new Error('Browser inference worker failed.'));
      pending.clear();
    };
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, file });
  });
}
