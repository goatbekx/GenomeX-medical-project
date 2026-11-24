import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web/wasm';
import sharp from 'sharp';

export const MAX_IMAGE_PIXELS = 12_000_000;
const SIZE = 640;
const STRIDE = 32;
const LABELS = ['down_syndrome', 'edwards_syndrome', 'patau_syndrome'];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
ort.env.wasm.numThreads = 1;

let session;

export class ImageError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getSession(modelUrl) {
  session ??= readFile(modelUrl)
    .then(bytes => ort.InferenceSession.create(bytes, { executionProviders: ['wasm'] }))
    .catch(error => {
      session = undefined;
      throw error;
    });
  return session;
}

async function prepareImage(bytes) {
  const isPng = bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (!isPng && !isJpeg) throw new ImageError(422, 'Upload a readable JPEG or PNG image.');

  try {
    const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await image.metadata();
    const { width, height } = metadata.autoOrient;
    if (width * height > MAX_IMAGE_PIXELS) throw new ImageError(413, 'Images must be 12 megapixels or smaller.');
    if (metadata.pages > 1) throw new ImageError(422, 'Upload a still JPEG or PNG image.');

    const scale = SIZE / Math.max(width, height);
    const resizedWidth = Math.max(1, Math.round(width * scale));
    const resizedHeight = Math.max(1, Math.round(height * scale));
    // Match the detector's rectangular input by padding to the next stride boundary.
    const inputWidth = Math.ceil(resizedWidth / STRIDE) * STRIDE;
    const inputHeight = Math.ceil(resizedHeight / STRIDE) * STRIDE;
    const left = Math.floor((inputWidth - resizedWidth) / 2);
    const top = Math.floor((inputHeight - resizedHeight) / 2);
    const pixels = await image.autoOrient()
      .resize(resizedWidth, resizedHeight, { fit: 'fill', kernel: 'linear', fastShrinkOnLoad: false })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer();

    const plane = inputWidth * inputHeight;
    const data = new Float32Array(3 * plane).fill(114 / 255);
    for (let y = 0; y < resizedHeight; y++) {
      for (let x = 0; x < resizedWidth; x++) {
        const source = (y * resizedWidth + x) * 3;
        const target = (y + top) * inputWidth + x + left;
        data[target] = pixels[source] / 255;
        data[plane + target] = pixels[source + 1] / 255;
        data[2 * plane + target] = pixels[source + 2] / 255;
      }
    }
    return {
      width, height, scale, left, top,
      tensor: new ort.Tensor('float32', data, [1, 3, inputHeight, inputWidth]),
    };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    if (error.message.includes('pixel limit')) {
      throw new ImageError(413, 'Images must be 12 megapixels or smaller.');
    }
    throw new ImageError(422, 'Upload a readable JPEG or PNG image.');
  }
}

export async function predict(bytes, modelUrl) {
  const { tensor, width, height, scale, left, top } = await prepareImage(bytes);
  let output;
  try {
    const model = await getSession(modelUrl);
    ({ output0: output } = await model.run({ images: tensor }));
    const detections = [];
    const toPixel = (position, padding, limit) => Math.min(limit, Math.max(0, (position - padding) / scale));
    // The exported graph applies confidence filtering and NMS and pads unused rows with zeros.
    for (let i = 0; i < output.data.length; i += 6) {
      const [x1, y1, x2, y2, confidence, classId] = output.data.subarray(i, i + 6);
      if (confidence <= 0) continue;
      if (!LABELS[classId]) throw new Error('Unexpected class from the ONNX checkpoint');
      detections.push({
        label: LABELS[classId],
        confidence,
        box: [toPixel(x1, left, width), toPixel(y1, top, height), toPixel(x2, left, width), toPixel(y2, top, height)],
      });
    }
    return { width, height, detections };
  } finally {
    tensor.dispose();
    output?.dispose();
  }
}
