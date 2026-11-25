import argparse
import os
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory

os.environ["YOLO_AUTOINSTALL"] = "false"
os.environ["YOLO_OFFLINE"] = "true"

from ultralytics import YOLO


ROOT = Path(__file__).resolve().parents[1]
LABELS = {0: "down_syndrome", 1: "edwards_syndrome", 2: "patau_syndrome"}


def main():
    parser = argparse.ArgumentParser(description="Export the Genome X detector for Node.js.")
    parser.add_argument("--checkpoint", type=Path, default=ROOT / "backend" / "best.pt")
    parser.add_argument("--output", type=Path, default=ROOT / "node-backend" / "model" / "genome-x.onnx")
    args = parser.parse_args()
    if not args.checkpoint.is_file():
        parser.error(f"Checkpoint not found at {args.checkpoint}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=args.output.parent) as work:
        checkpoint = Path(work) / "best.pt"
        copyfile(args.checkpoint, checkpoint)
        model = YOLO(str(checkpoint))
        if model.task != "detect" or model.names != LABELS or int(model.model.stride.max()) != 32:
            parser.error("Expected the Genome X detector with its original three classes and stride 32.")
        exported = Path(model.export(
            format="onnx", imgsz=640, device="cpu", dynamic=True, batch=1, opset=17,
            simplify=False, nms=True, conf=0.25, iou=0.7, max_det=300,
        ))
        exported.replace(args.output)
    print(f"Exported {args.output}")


if __name__ == "__main__":
    main()
