const SCAN_TIMEOUT_MS = 60_000;
let worker;
let nextId = 0;
const pending = new Map();

function resetWorker(error) {
  worker.terminate();
  worker = undefined;
  for (const request of pending.values()) {
    clearTimeout(request.deadline);
    request.reject(error);
  }
  pending.clear();
}

export function predictInBrowser(file) {
  if (!worker) {
    const active = new Worker(new URL('./browser-inference.worker.js', import.meta.url), { type: 'module' });
    worker = active;
    active.onmessage = ({ data: { id, result, error } }) => {
      const request = pending.get(id);
      if (!request) return;
      clearTimeout(request.deadline);
      pending.delete(id);
      if (error) request.reject(Object.assign(new Error(error.message), { status: error.status }));
      else request.resolve(result);
    };
    active.onerror = event => {
      event.preventDefault();
      if (worker === active) resetWorker(new Error('Browser inference worker failed.'));
    };
    active.onmessageerror = () => {
      if (worker === active) resetWorker(new Error('Could not read the browser worker response.'));
    };
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    // The page can still stop the worker if WebAssembly never returns.
    const deadline = setTimeout(() => {
      resetWorker(new DOMException('Browser scan deadline exceeded.', 'TimeoutError'));
    }, SCAN_TIMEOUT_MS);
    pending.set(id, { resolve, reject, deadline });
    try {
      worker.postMessage({ id, file });
    } catch (error) {
      clearTimeout(deadline);
      pending.delete(id);
      reject(error);
    }
  });
}
