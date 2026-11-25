import { readFile } from 'node:fs/promises';
import * as ort from 'onnxruntime-web/wasm';
import sharp from 'sharp';
import { MAX_IMAGE_PIXELS, imageGeometry, imageTensorData, readDetections } from './detection.mjs';

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

    const geometry = imageGeometry(width, height);
    const { resizedWidth, resizedHeight, inputWidth, inputHeight } = geometry;
    const pixels = await image.autoOrient()
      .resize(resizedWidth, resizedHeight, { fit: 'fill', kernel: 'linear', fastShrinkOnLoad: false })
      .toColourspace('srgb')
      .removeAlpha()
      .raw()
      .toBuffer();

    return {
      geometry,
      tensor: new ort.Tensor('float32', imageTensorData(pixels, geometry, 3), [1, 3, inputHeight, inputWidth]),
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
  const { tensor, geometry } = await prepareImage(bytes);
  let output;
  try {
    const model = await getSession(modelUrl);
    ({ output0: output } = await model.run({ images: tensor }));
    return readDetections(output.data, geometry);
  } finally {
    tensor.dispose();
    output?.dispose();
  }
}
