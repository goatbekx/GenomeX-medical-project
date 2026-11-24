import { DurableObject } from 'cloudflare:workers';

const API_PORT = 8000;
const IDLE_TIMEOUT_MS = 60_000;
const STARTUP_TIMEOUT_MS = 45_000;

export class GenomeApi extends DurableObject {
  #readiness;

  async fetch(request) {
    const container = this.ctx.container;
    try {
      this.#readiness ??= this.#waitForApi(container).finally(() => {
        this.#readiness = undefined;
      });
      await this.#readiness;

      const destination = new URL(request.url);
      destination.protocol = 'http:';
      destination.host = 'container';
      const forwarded = new Request(destination, request);
      forwarded.headers.delete('host');
      return await container.getTcpPort(API_PORT).fetch(forwarded);
    } catch (error) {
      console.error('Genome X API connection failed', error.message);
      return Response.json({ detail: 'The model is temporarily unavailable.' }, { status: 503 });
    }
  }

  async #waitForApi(container) {
    if (!container) throw new Error('Missing FastAPI container binding');
    if (!container.running) {
      container.start({ image: container.images.base, instance: 'basic', enableInternet: false });
    }
    await container.setInactivityTimeout(IDLE_TIMEOUT_MS);

    const port = container.getTcpPort(API_PORT);
    const deadline = Date.now() + STARTUP_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const health = await port.fetch('http://container/health', { signal: AbortSignal.timeout(1000) });
        await health.body?.cancel();
        if (health.ok) return;
      } catch {
        // FastAPI opens its port only after the model finishes loading.
      }
      await scheduler.wait(250);
    }
    throw new Error('FastAPI did not become ready');
  }
}

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = pathname === '/analyze' ? 'POST' : pathname === '/health' ? 'GET' : null;
    if (!method) return env.ASSETS.fetch(request);
    if (request.method !== method) {
      return new Response(null, { status: 405, headers: { Allow: method } });
    }
    return env.API.getByName('inference').fetch(request);
  },
};
