import * as ort from 'onnxruntime-web/wasm';
import loaderUrl from 'onnxruntime-web/ort-wasm-simd-threaded.mjs?url';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import { MAX_IMAGE_PIXELS, imageGeometry, imageTensorData, readDetections } from '../../node-backend/detection.mjs';

const MODEL_URL = new URL(`${import.meta.env.BASE_URL}model/genome-x.onnx`, self.location.origin);
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
const PNG_IHDR = 0x49484452;
const PNG_IDAT = 0x49444154;
const PNG_ACTL = 0x6163544c;

ort.env.wasm.numThreads = 1;
ort.env.wasm.wasmPaths = { mjs: loaderUrl, wasm: wasmUrl };
let session;

function getSession() {
  session ??= fetch(MODEL_URL, { signal: AbortSignal.timeout(90_000) })
    .then(response => {
      if (!response.ok) throw new Error('ONNX checkpoint unavailable');
      return response.arrayBuffer();
    })
    .then(bytes => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }))
    .catch(error => {
      session = undefined;
      throw error;
    });
  return session;
}

function validateDimensions(width, height) {
  if (!width || !height) throw new Error('Invalid image dimensions');
  if (width * height > MAX_IMAGE_PIXELS) {
    throw Object.assign(new Error('Image pixel limit exceeded'), { status: 413 });
  }
}

function validateImageHeader(view) {
  if (view.byteLength >= 33 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    if (view.getUint32(8) !== 13 || view.getUint32(12) !== PNG_IHDR) throw new Error('Invalid PNG header');
    validateDimensions(view.getUint32(16), view.getUint32(20));
    for (let offset = 33; offset + 12 <= view.byteLength;) {
      const size = view.getUint32(offset);
      const type = view.getUint32(offset + 4);
      if (size > view.byteLength - offset - 12) throw new Error('Invalid PNG chunk');
      if (type === PNG_ACTL) throw new Error('Animated PNG is unsupported');
      if (type === PNG_IDAT) return;
      offset += size + 12;
    }
    throw new Error('Missing PNG image data');
  }
  if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    for (let offset = 2; offset + 4 <= view.byteLength && view.getUint8(offset) === 0xff;) {
      while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++;
      if (offset + 3 > view.byteLength) break;
      const marker = view.getUint8(offset++);
      if (marker === 0xda || marker === 0xd9) break;
      const size = view.getUint16(offset);
      if (size < 2 || size > view.byteLength - offset) break;
      if (JPEG_FRAME_MARKERS.has(marker) && size >= 8) {
        validateDimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
        return;
      }
      offset += size;
    }
  }
  throw new Error('Expected a JPEG or PNG image');
}

async function readBitmap(file) {
  try {
    validateImageHeader(new DataView(await file.arrayBuffer()));
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch (error) {
    if (error.status === 413) throw error;
    throw Object.assign(new Error('Upload a readable JPEG or PNG image.'), { status: 422 });
  }
}

async function predict(file) {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new Error('Browser image processing is unavailable');
  }
  const bitmap = await readBitmap(file);
  let tensor;
  let output;
  try {
    const geometry = imageGeometry(bitmap.width, bitmap.height);
    const { resizedWidth, resizedHeight, inputWidth, inputHeight } = geometry;
    const canvas = new OffscreenCanvas(resizedWidth, resizedHeight);
    const context = canvas.getContext('2d');
    context.drawImage(bitmap, 0, 0, resizedWidth, resizedHeight);
    const pixels = context.getImageData(0, 0, resizedWidth, resizedHeight).data;
    tensor = new ort.Tensor('float32', imageTensorData(pixels, geometry, 4), [1, 3, inputHeight, inputWidth]);
    const model = await getSession();
    ({ output0: output } = await model.run({ images: tensor }));
    return readDetections(output.data, geometry);
  } finally {
    bitmap.close();
    tensor?.dispose();
    output?.dispose();
  }
}

self.addEventListener('message', async ({ data: { id, file } }) => {
  try {
    const result = await predict(file);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: { message: error.message, status: error.status } });
  }
});
