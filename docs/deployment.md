# Genome X deployment

The public build runs the June YOLO11n ONNX export in the browser on Cloudflare Pages. For local development, the regular React build calls FastAPI at `http://127.0.0.1:8000`. Both paths use the same June 5, 2026 model and return the oriented image dimensions and detections with a label, confidence, and `[left, top, right, bottom]` box.

## FastAPI

Use a Python 3.12 virtual environment. Install `backend/requirements.txt`, place the trusted checkpoint at `backend/best.pt` or set `MODEL_PATH`, and start the app from the repository root.

```bash
python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

The API loads the checkpoint and warms it up at startup. Check readiness at `GET /health`. `POST /analyze` accepts JSON containing `image_base64`. The frontend development server uses port 5173. Set `VITE_API_URL` at frontend build time and `CORS_ORIGINS` on the backend when hosting them at different origins.

The checked `best.pt` SHA-256 is `5289fec6654dd35356bed5601d02f7bbd410b6342a8471266283a4ce5f2b88c1`. It was fine-tuned from `yolo11n.pt` with Ultralytics 8.4.60. Keep weights and private uploads out of Git. The checkpoint records the Ultralytics AGPL-3.0 license. [Ultralytics licensing](https://www.ultralytics.com/license)

## Cloudflare Pages browser build

With the FastAPI Python environment active and the checkpoint in place, build the ONNX export and the static site from the repository root.

```bash
python -m pip install onnx==1.23.2
python node-backend/export_model.py
npm ci --prefix frontend
npm run build:browser --prefix frontend
npm run preview --prefix frontend -- --outDir dist-browser
```

The export lives at `node-backend/model/genome-x.onnx`. Vite includes it only in the browser build. Upload `frontend/dist-browser` to the existing Pages project. The ONNX file and the WebAssembly runtime are public static assets. [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)

Preview the bundle before uploading it. In a fresh browser session, try the sample, confirm the box overlays the chromosome 21 group, and verify that the model and runtime load without a `POST /analyze` request. Check that an invalid JPEG returns an image error and that a blank image returns an empty result.

## Alternate API hosts

- **Netlify Functions.** The Node.js API in `node-backend/` serves the same ONNX export. Run `npm ci` and `npx --yes netlify-cli@27.20.1 build --offline` there on Linux x86-64 for the image decoder. Set `CORS_ORIGINS` on the API and set `VITE_API_URL` and `VITE_MAX_IMAGE_MIB=4` before running the regular frontend build. [Netlify Functions configuration](https://docs.netlify.com/build/functions/configuration/)
- **Cloudflare Containers.** The optional same-origin Worker in `cloudflare/worker.mjs` forwards `/analyze` and `/health` to FastAPI. Put the checkpoint at `backend/best.pt`, set `VITE_API_URL=/`, and run `npm run build --prefix frontend -- --outDir dist-cloudflare` before `npx --yes wrangler@4.168.0 deploy`. This requires Docker and a Workers Paid account. [Cloudflare Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/)
- **Railway.** Set the service root to `/backend`, mount the checkpoint from private storage, and set `MODEL_PATH`. Use `uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1 --limit-concurrency 10` and monitor `/health`. Allow at least 1 GiB RAM for staging. [Railway plans](https://docs.railway.com/pricing/plans)

In a local Linux container capped at 0.25 vCPU and 1 GiB RAM, FastAPI loaded the checkpoint in 16.9 seconds. Five warm sample requests took a median of 3.1 seconds. Peak memory reached 490 MiB in the 12-megapixel input test. A separate one-thread Windows CPU run took 3.76 seconds to load and warm up after the application module was imported, and 15 warm sample requests had a median of 58.1 ms. These timings describe local tests.
