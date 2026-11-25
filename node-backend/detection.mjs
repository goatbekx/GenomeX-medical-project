export const MAX_IMAGE_PIXELS = 12_000_000;
const SIZE = 640;
const STRIDE = 32;
const LABELS = ['down_syndrome', 'edwards_syndrome', 'patau_syndrome'];

export function imageGeometry(width, height) {
  const scale = SIZE / Math.max(width, height);
  const resizedWidth = Math.max(1, Math.round(width * scale));
  const resizedHeight = Math.max(1, Math.round(height * scale));
  // Match the detector's rectangular input by padding to the next stride boundary.
  const inputWidth = Math.ceil(resizedWidth / STRIDE) * STRIDE;
  const inputHeight = Math.ceil(resizedHeight / STRIDE) * STRIDE;
  const left = Math.floor((inputWidth - resizedWidth) / 2);
  const top = Math.floor((inputHeight - resizedHeight) / 2);
  return { width, height, scale, resizedWidth, resizedHeight, inputWidth, inputHeight, left, top };
}

export function imageTensorData(pixels, geometry, pixelStride) {
  const { inputWidth, inputHeight, resizedWidth, resizedHeight, left, top } = geometry;
  const plane = inputWidth * inputHeight;
  const data = new Float32Array(3 * plane).fill(114 / 255);
  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const source = (y * resizedWidth + x) * pixelStride;
      const target = (y + top) * inputWidth + x + left;
      data[target] = pixels[source] / 255;
      data[plane + target] = pixels[source + 1] / 255;
      data[2 * plane + target] = pixels[source + 2] / 255;
    }
  }
  return data;
}

export function readDetections(rows, { width, height, scale, left, top }) {
  const detections = [];
  const toPixel = (position, padding, limit) => Math.min(limit, Math.max(0, (position - padding) / scale));
  // The exported graph filters by confidence and NMS, then pads unused rows with zeros.
  for (let i = 0; i < rows.length; i += 6) {
    const [x1, y1, x2, y2, confidence, classId] = rows.subarray(i, i + 6);
    if (confidence <= 0) continue;
    if (!LABELS[classId]) throw new Error('Unexpected class from the ONNX checkpoint');
    detections.push({
      label: LABELS[classId],
      confidence,
      box: [toPixel(x1, left, width), toPixel(y1, top, height), toPixel(x2, left, width), toPixel(y2, top, height)],
    });
  }
  return { width, height, detections };
}
