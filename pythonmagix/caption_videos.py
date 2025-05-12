#!/usr/bin/env python3
# caption_videos.py — Magix “Oracle” automatic video captioner
# ─────────────────────────────────────────────────────────────────────────────
# Walks an input directory (recursively), passes each video through
# Qwen-VL-2B-Instruct, and stores the resulting captions either as:
#   • one JSONL file   (path \t caption)
#   • individual .txt  files next to the clips
#
# Works great after you’ve run  `chop_scenes.py`  to create lots of short clips.
#
# Usage examples:
#   python caption_videos.py dataset/videos captions.jsonl
#   python caption_videos.py dataset/videos captions_dir  --format txt
#   python caption_videos.py in out.jsonl --fps 0.5 --max-pixels 360*420
#
# Requirements:
#   pip install "transformers>=4.39" accelerate einops tqdm
#   # plus whatever torch build matches your GPU.
#   # FFmpeg only needed if you use --fps to force frame-list mode.
# -----------------------------------------------------------------------------

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Sequence

import torch
from tqdm import tqdm
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration

# Qwen helper
from qwen_vl_utils import process_vision_info  # type: ignore

VIDEO_EXT = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".m4v"}

BANNER = "\033[1m\033[35m✨  Magix Oracle: unveiling stories inside pixels…\033[0m"


# ─── Utilities ──────────────────────────────────────────────────────────────
def list_videos(root: Path) -> Sequence[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXT)


def extract_frames(
    video: Path,
    fps: float,
    tmp_dir: Path,
) -> List[str]:
    """
    Extract frames at given fps to tmp_dir. Returns list of file:// URIs.
    """
    tmp_dir.mkdir(parents=True, exist_ok=True)
    pattern = tmp_dir / "frame_%06d.jpg"
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(video),
        "-vf",
        f"fps={fps}",
        str(pattern),
    ]
    subprocess.run(cmd, check=True)
    return [f"file://{f.as_posix()}" for f in sorted(tmp_dir.glob("frame_*.jpg"))]


def build_message(
    video_path: Path,
    fps: float | None,
    max_pixels: int | None,
) -> Dict:
    if fps is not None:
        # frame-list mode
        tmp = Path(tempfile.mkdtemp())
        uris = extract_frames(video_path, fps, tmp)
        content = [
            {
                "type": "video",
                "video": uris,
                "fps": fps,
            },
            {"type": "text", "text": "Describe this video."},
        ]
    else:
        content = [
            {
                "type": "video",
                "video": f"file://{video_path.as_posix()}",
                **({"max_pixels": max_pixels} if max_pixels else {}),
                "fps": 1.0,
            },
            {"type": "text", "text": "Describe this video."},
        ]
    return {"role": "user", "content": content}


# ─── Main captioning routine ────────────────────────────────────────────────
def caption(
    vids: Sequence[Path],
    output: Path,
    fmt: str,
    fps: float | None,
    max_pixels: int | None,
    device: str,
):
    print("🔮  Loading Qwen-VL-2B-Instruct… (this can take a minute)")
    model = Qwen2VLForConditionalGeneration.from_pretrained(
        "Qwen/Qwen2-VL-2B-Instruct", torch_dtype="auto", device_map="auto"
    ).eval()
    processor = AutoProcessor.from_pretrained("Qwen/Qwen2-VL-2B-Instruct")

    # Ensure out path
    if fmt == "txt":
        output.mkdir(parents=True, exist_ok=True)
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        out_jsonl = output.open("w", encoding="utf-8")

    for vid in tqdm(vids, desc="Captioning"):
        # 1) Build prompt
        messages = [build_message(vid, fps, max_pixels)]
        text_prompt = processor.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        image_inputs, video_inputs = process_vision_info(messages)
        inputs = processor(
            text=[text_prompt],
            images=image_inputs,
            videos=video_inputs,
            padding=True,
            return_tensors="pt",
        ).to(device)

        # 2) Generate
        with torch.inference_mode():
            gen_ids = model.generate(**inputs, max_new_tokens=128)
        trimmed = gen_ids[:, inputs.input_ids.shape[1] :]
        caption = processor.batch_decode(
            trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
        )[0]

        # 3) Save
        if fmt == "txt":
            txt_path = output / vid.with_suffix(".txt").name
            txt_path.write_text(caption.strip() + "\n", encoding="utf-8")
        else:  # jsonl
            out_jsonl.write(json.dumps({"path": str(vid), "caption": caption}) + "\n")

    if fmt == "jsonl":
        out_jsonl.close()
    print(f"\n\033[32m✅  Captions stored at → {output}\033[0m")


# ─── CLI ────────────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Batch-caption every video in a directory using Qwen-VL-2B.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("input", type=Path, help="Folder containing videos (recursive)")
    p.add_argument("output", type=Path, help="Output .jsonl file OR directory for .txt")
    p.add_argument("--format", choices=["jsonl", "txt"], default="jsonl",
                   help="Storage format for captions")
    p.add_argument("--fps", type=float, default=None,
                   help="If set, sample frames at this FPS and send as list "
                        "(slower, but avoids feeding entire video)")
    p.add_argument("--max-pixels", type=int, default=None,
                   help="Pass max_pixels arg for big videos (see Qwen docs)")
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu",
                   help="Device for inference")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    print(BANNER)

    videos = list(list_videos(args.input))
    if not videos:
        print("⚠️  No videos found. Exiting.")
        return
    print(f"🎬  Found {len(videos)} video(s).")

    caption(
        videos,
        args.output,
        fmt=args.format,
        fps=args.fps,
        max_pixels=args.max_pixels,
        device=args.device,
    )


if __name__ == "__main__":
    main()
