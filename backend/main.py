import binascii
import logging
import os
from base64 import b64decode
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from time import perf_counter

from anyio import CapacityLimiter
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image, ImageOps
from pydantic import BaseModel, ValidationError
from starlette.concurrency import run_in_threadpool

load_dotenv()
logger = logging.getLogger("uvicorn.error")

MAX_IMAGE_BYTES = 5 * 1024 * 1024
MAX_BASE64_BYTES = 4 * ((MAX_IMAGE_BYTES + 2) // 3)
MAX_REQUEST_BYTES = MAX_BASE64_BYTES + 1024
MAX_IMAGE_PIXELS = 12_000_000
IMAGE_SIZE = 640
CONFIDENCE_THRESHOLD = 0.25
# Ultralytics patches Image.open with a HEIF fallback. This API accepts JPEG and PNG.
open_pillow_image = Image.open


class ImagePayload(BaseModel):
    image_base64: str


class Detection(BaseModel):
    label: str
    confidence: float
    box: tuple[float, float, float, float]


class Prediction(BaseModel):
    width: int
    height: int
    detections: list[Detection]


def load_model():
    path = Path(
        os.getenv("MODEL_PATH", str(Path(__file__).with_name("best.pt")))
    ).expanduser().resolve()
    if path.suffix.lower() != ".pt" or not path.is_file():
        raise RuntimeError(
            f"Could not find a .pt checkpoint at {path}. Set MODEL_PATH to your best.pt file."
        )

    try:
        os.environ["YOLO_AUTOINSTALL"] = "false"
        os.environ["YOLO_OFFLINE"] = "true"
        from ultralytics import YOLO, __version__

        model = YOLO(str(path))
        if model.task != "detect":
            raise ValueError(f"Expected a detection checkpoint, got task {model.task!r}")
        # Initialize the predictor and verify that the checkpoint can run on CPU.
        with Image.new("RGB", (IMAGE_SIZE, IMAGE_SIZE)) as warmup_image:
            predict(model, warmup_image)
    except Exception as exc:
        raise RuntimeError(
            f"Could not load or warm up {path}. Check that the checkpoint is an "
            "Ultralytics detector and install the dependencies in backend/requirements.txt."
        ) from exc

    logger.info("Loaded %s on CPU with Ultralytics %s; labels: %s", path.name, __version__, model.names)
    return model


@asynccontextmanager
async def lifespan(app: FastAPI):
    started = perf_counter()
    app.state.model = load_model()
    app.state.inference_slots = CapacityLimiter(1)
    logger.info("Model ready in %.2f seconds", perf_counter() - started)
    yield


app = FastAPI(title="GenomeX API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip().rstrip("/")
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def decode_image(encoded: str) -> Image.Image:
    if encoded.startswith("data:"):
        header, _, encoded = encoded.partition(",")
        if not (header.startswith("data:image/") and header.endswith(";base64")):
            raise HTTPException(422, "Expected a base64 image data URL.")

    if len(encoded) > MAX_BASE64_BYTES:
        raise HTTPException(413, "Images must be 5 MiB or smaller.")

    try:
        raw = b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(422, "The image contains invalid base64.") from None
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "Images must be 5 MiB or smaller.")

    try:
        with open_pillow_image(BytesIO(raw), formats=("JPEG", "PNG")) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise HTTPException(413, "Images must be 12 megapixels or smaller.")
            if getattr(source, "is_animated", False):
                raise HTTPException(422, "Upload a still JPEG or PNG image.")
            return ImageOps.exif_transpose(source).convert("RGB")
    except Image.DecompressionBombError:
        raise HTTPException(413, "Images must be 12 megapixels or smaller.") from None
    except (OSError, SyntaxError, ValueError):
        raise HTTPException(422, "Upload a readable JPEG or PNG image.") from None


def predict(model, image: Image.Image) -> Prediction:
    try:
        result = model.predict(
            image, device="cpu", imgsz=IMAGE_SIZE, conf=CONFIDENCE_THRESHOLD,
            save=False, verbose=False,
        )[0]
        boxes = result.boxes
        detections = [
            Detection(label=result.names[class_id], confidence=confidence, box=coordinates)
            for class_id, confidence, coordinates in zip(
                boxes.cls.int().tolist(), boxes.conf.tolist(), boxes.xyxy.tolist()
            )
        ]
        return Prediction(width=image.width, height=image.height, detections=detections)
    finally:
        # Ultralytics reuses its predictor between calls and keeps the last input in these fields.
        if model.predictor is not None:
            model.predictor.dataset = None
            model.predictor.batch = None
            model.predictor.results = None


def analyze_image(model, payload: ImagePayload) -> Prediction:
    with decode_image(payload.image_base64) as image:
        try:
            return predict(model, image)
        except Exception:
            logger.exception("Checkpoint inference failed")
            raise HTTPException(500, "The model could not analyze this image.") from None


@app.get("/health")
async def health():
    return {"status": "ready"}


@app.post(
    "/analyze",
    response_model=Prediction,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/json": {"schema": ImagePayload.model_json_schema()}},
        },
    },
)
async def analyze_karyotype(request: Request):
    # Bound the body before JSON parsing and keep a single image in inference at a time.
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            raise HTTPException(413, "The image request is too large.")
        body.extend(chunk)

    try:
        payload = ImagePayload.model_validate_json(body)
    except ValidationError:
        raise HTTPException(422, "Send an image_base64 string in a JSON object.") from None
    del body

    async with request.app.state.inference_slots:
        return await run_in_threadpool(analyze_image, request.app.state.model, payload)
