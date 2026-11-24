# Genome X

Genome X is a computer vision research demo for karyotypes, images that show a cell’s chromosomes arranged in groups. Upload a JPEG or PNG or try the built-in sample. A YOLO detector highlights regions it associates with Down, Edwards, or Patau syndrome and shows its confidence for each box.

**April 2026 olympiad:** second place, as reported by the project author. See [Recognition](#recognition) for the April model and pending verification.

**Live demo:** [Add the public URL after approval] · **Short walkthrough:** [Add recording URL]

<img src="docs/inference-mobile.png" alt="Genome X on a phone, showing a box around the three copies of chromosome 21 and an 89.7 percent model confidence score" width="414">

*Actual local inference on the bundled sample. The model drew one box around the chromosome 21 group and returned `down_syndrome` at 89.7% confidence.*

## My contributions

I trained the project’s vision model, built the FastAPI backend, and developed the React interface. The April presentation notes credit my teammate with defining the medical research question and collecting, preparing, and reviewing the dataset. **[Add one specific training or engineering decision you made and confirm the preferred author and team credits.]**

## Model and output

The current build serves the June 5, 2026 `best.pt` checkpoint. It is an Ultralytics **YOLO11n** object detector fine-tuned from `yolo11n.pt` with Ultralytics 8.4.60. The API decodes still JPEG or PNG images, applies EXIF orientation, converts to RGB, and runs inference on CPU with a 640-pixel inference size and a 0.25 confidence threshold.

| Checkpoint label | Region highlighted in the public examples |
| --- | --- |
| `down_syndrome` | Chromosome 21 group |
| `edwards_syndrome` | Chromosome 18 group |
| `patau_syndrome` | Chromosome 13 group |

The public examples show boxes around groups containing three copies. **[Confirm whether training annotations consistently covered the whole trisomy group using the annotation guidelines or labeled export.]** The API returns image dimensions and a list of detections with a class, confidence score, and `[left, top, right, bottom]` box in pixels of the oriented image. The model has three classes and no normal class. An empty list means that no detection passed the threshold. Use the demo for research and education only. Upload public or synthetic images.

The training metadata references `Genome-X-visualmodel-2/data.yaml`, which matches the owner-provided Roboflow ID `genome-x-visualmodel/2` and suggests dataset provenance. Universe lists an object-detection project with the same name and three classes, 82 images, and one hosted model. This app runs the local checkpoint. **[Add the direct Universe project URL and confirm whether its hosted weights are this checkpoint, a separate model you trained, or an external reference.]** [Roboflow Universe search results](https://universe.roboflow.com/search?q=like%3Ayolov5-w7acb%2Fyolov5-chromosome)

## Evaluation and limitations

These are box-detection metrics recorded by Ultralytics on the training run’s **validation split** (`val`). `last.pt` is the final epoch, whose values match the final row of `results5.csv`.

| Checkpoint | Box precision | Box recall | Box mAP@0.50 | Box mAP@0.50:0.95 |
| --- | ---: | ---: | ---: | ---: |
| `best.pt` (served) | 0.9480 | 0.8284 | 0.9600 | 0.8495 |
| `last.pt` (epoch 250) | 0.7786 | 0.9992 | 0.9418 | 0.7980 |

The supplied precision–recall curve reports AP@0.50 of 0.995 for Down, 0.995 for Edwards, and 0.890 for Patau. The supplied F1 curve peaks at 0.88 at confidence 0.688. The supplied confusion matrix contains 15 ground-truth boxes, four false-positive boxes, and one missed box. Validation metrics are for detection boxes. Clinical performance and performance on an independent test split remain unverified.

The demo images are already arranged and have printed labels. Their overlap with the training data is unknown. They illustrate the interface and how the model draws boxes. **[Add the validation image count, split method, and any independent test results.]** A comparison with the April YOLOv8 model or the Roboflow-hosted model needs the same held-out images and the same metrics.

## Run locally

Use Python 3.12, Node.js 22.12 or later, and the trusted `best.pt` checkpoint from the project author. Place the checkpoint at `backend/best.pt` or set `MODEL_PATH` to its full path. The API loads it once at startup and runs a warm-up before serving requests.

**Backend** from the repository root

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
OMP_NUM_THREADS=1 MKL_NUM_THREADS=1 .venv/bin/python -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

**Backend on Windows PowerShell**

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
$env:OMP_NUM_THREADS = '1'
$env:MKL_NUM_THREADS = '1'
.\.venv\Scripts\python.exe -m uvicorn main:app --app-dir backend --host 127.0.0.1 --port 8000
```

**Frontend** in a second terminal

```bash
cd frontend
npm ci
npm run dev
```

Open [the local demo](http://localhost:5173), choose **Открыть демо**, and select **Попробовать пример** (Try a sample). The button sends the same `POST /analyze` request as a file upload. FastAPI’s [interactive API docs](http://127.0.0.1:8000/docs) describe the `image_base64` request. The server processes images in memory and releases the model’s references after inference.

The checked checkpoint’s SHA-256 is `5289fec6654dd35356bed5601d02f7bbd410b6342a8471266283a4ce5f2b88c1`.

## Deployment

The original frontend targeted a Railway backend where `POST /analyze` called Gemini through OpenRouter. The original Railway URL returned 404 for `/openapi.json` during verification. The frontend host and current Railway service settings are pending confirmation.

1. For a Railway staging service, set the project root to `/backend` and use Railpack. Stage `best.pt` through approved private storage, such as a Railway volume mounted at `/model`. Set `MODEL_PATH=/model/best.pt`, `OMP_NUM_THREADS=1`, and `MKL_NUM_THREADS=1`.
2. Set the start command to `uvicorn main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 --limit-concurrency 10`. Set the health check path to `/health`. [Railpack Python support](https://github.com/railwayapp/railpack/blob/main/docs/src/content/docs/languages/python.md)
3. Set `CORS_ORIGINS` to the frontend’s HTTPS origin. Build from `frontend/` with `npm ci` and `npm run build`, setting `VITE_API_URL` to the HTTPS API URL before the build. Serve the resulting `dist/` with the static frontend host.
4. Check startup, memory, and latency in staging with a sample and an image at the upload limit. Railway Free allows 0.5 GB RAM. The local API reached 601 MiB peak working set while exercising the permitted 12-megapixel input, so Free has insufficient headroom based on this run. Verify the existing service has at least 1 GiB available for the staging test. [Railway plan limits](https://docs.railway.com/pricing/plans)

Linux x86-64 wheels resolved for the pinned Python 3.12 requirements. A one-thread CPU run on Windows (Ryzen 7 8845HS) took 3.76 seconds to load and warm up after the application module was imported. Fifteen warm HTTP requests using the bundled sample had a 58.1 ms median. The checkpoint metadata identifies the Ultralytics AGPL-3.0 license. Confirm the source and weights publication terms before public deployment. [Ultralytics licensing](https://www.ultralytics.com/license)

## Recognition

Genome X was presented at an olympiad in April 2026. The presentation notes describe **YOLOv8**. This repository’s current **YOLO11n** checkpoint is from a June 2026 run.

- **Award:** Second place (author-reported). **[Add event name, organizer, category, and result link if available.]**
- **Presentation:** **[Add the public slide deck or talk link.]**
- **Certificate:** **[Add the redacted certificate or official results.]**

## Sample credit

The demo bundles the 760-pixel version of *Down syndrome human karyotype 47,XY,+21* by Wessex Reg. Genetics Centre. The screenshot adds the predicted box over the image. [Wellcome Collection record](https://wellcomecollection.org/works/wmcdanw6) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
