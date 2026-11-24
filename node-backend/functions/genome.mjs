import { getSession, ImageError, predict } from '../model.mjs';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_BASE64_BYTES = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);
const MAX_REQUEST_BYTES = MAX_BASE64_BYTES + 1024;
const MODEL_URL = new URL('../model/genome-x.onnx', import.meta.url);
const allowedOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',').map(origin => origin.trim().replace(/\/$/, ''));

export const config = { path: ['/analyze', '/health'] };

async function readPayload(request) {
  if (Number(request.headers.get('content-length')) > MAX_REQUEST_BYTES) {
    throw new ImageError(413, 'The image request is too large.');
  }
  if (!request.body) throw new ImageError(422, 'Send an image_base64 string in a JSON object.');

  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new ImageError(413, 'The image request is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  let encoded;
  try {
    encoded = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))?.image_base64;
  } catch {
    throw new ImageError(422, 'Send an image_base64 string in a JSON object.');
  }
  if (typeof encoded !== 'string') {
    throw new ImageError(422, 'Send an image_base64 string in a JSON object.');
  }
  if (encoded.startsWith('data:')) {
    const comma = encoded.indexOf(',');
    if (comma < 0 || !/^data:image\/[\w.+-]+;base64$/i.test(encoded.slice(0, comma))) {
      throw new ImageError(422, 'Expected a base64 image data URL.');
    }
    encoded = encoded.slice(comma + 1);
  }
  if (encoded.length > MAX_BASE64_BYTES) throw new ImageError(413, 'Images must be 4 MiB or smaller.');
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded) throw new ImageError(422, 'The image contains invalid base64.');
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageError(413, 'Images must be 4 MiB or smaller.');
  return bytes;
}

export default async function handler(request) {
  const path = new URL(request.url).pathname;
  const method = path === '/health' ? 'GET' : 'POST';
  const headers = { Vary: 'Origin', 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = `${method}, OPTIONS`;
    headers['Access-Control-Allow-Headers'] = 'Content-Type';
  }
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== method) {
    return new Response(null, { status: 405, headers: { ...headers, Allow: `${method}, OPTIONS` } });
  }

  try {
    if (path === '/health') {
      await getSession(MODEL_URL);
      return Response.json({ status: 'ready' }, { headers });
    }
    return Response.json(await predict(await readPayload(request), MODEL_URL), { headers });
  } catch (error) {
    if (error instanceof ImageError) {
      return Response.json({ detail: error.message }, { status: error.status, headers });
    }
    console.error('Genome X inference failed', error.message);
    return Response.json({ detail: 'The model could not analyze this image.' }, { status: 500, headers });
  }
}
