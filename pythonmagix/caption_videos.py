#!/usr/bin/env python3
# caption_videos.py — Magix “Oracle” (v3 – gentle-skip)
# ─────────────────────────────────────────────────────────────────────────────
# Same power, softer touch:
#   • Videos already captioned are **left where they are** (silently skipped).
#   • Only files we cannot caption (too few frames / preprocessing failure /
#     generation error) get moved to   <skip_dir>/bad_frames/
#   • Everything else is unchanged. Enjoy the harmony! ✨
# -----------------------------------------------------------------------------

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Dict, List, Sequence

import torch
from tqdm import tqdm
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration

from qwen_vl_utils import process_vision_info  # type: ignore

VIDEO_EXT = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".m4v"}
BANNER = "\033[1m\033[35m✨  Magix Oracle: unveiling stories inside pixels…\033[0m"


# ─── Utilities ──────────────────────────────────────────────────────────────
def list_videos(root: Path) -> Sequence[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXT)


def get_num_frames(video: Path) -> int | None:
    try:
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-count_packets",
                "-show_entries", "stream=nb_read_packets",
                "-of", "csv=p=0", str(video)
            ],
            stderr=subprocess.DEVNULL,
            text=True,
        )
        return int(out.strip())
    except Exception:
        return None


def extract_frames(video: Path, fps: float, tmp_dir: Path) -> List[str]:
    tmp_dir.mkdir(parents=True, exist_ok=True)
    pattern = tmp_dir / "frame_%06d.jpg"
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error",
         "-i", str(video), "-vf", f"fps={fps}", str(pattern)],
        check=True,
    )
    return [f"file://{f.as_posix()}" for f in sorted(tmp_dir.glob("frame_*.jpg"))]


def build_message(video_path: Path, fps: float | None, max_pixels: int | None) -> Dict:
    if fps is not None:
        tmp = Path(tempfile.mkdtemp())
        uris = extract_frames(video_path, fps, tmp)
        content = [{"type": "video", "video": uris, "fps": fps},
                   {"type": "text", "text": "Describe this video."}]
    else:
        content = [{
            "type": "video",
            "video": f"file://{video_path.as_posix()}",
            **({"max_pixels": max_pixels} if max_pixels else {}),
            "fps": 1.0,
        }, {"type": "text", "text": "Describe this video."}]
    return {"role": "user", "content": content}


# ─── Captioner core ─────────────────────────────────────────────────────────
def caption(
    videos: Sequence[Path],
    out_path: Path,
    fmt: str,
    fps: float | None,
    max_pixels: int | None,
    device: str,
    skip_dir: Path,
):
    # --- gather already captioned -------------------------------------------
    done: set[str] = set()
    if fmt == "txt":
        for vid in videos:
            if (out_path / vid.with_suffix(".txt").name).exists():
                done.add(str(vid))
    else:  # jsonl
        if out_path.exists():
            with out_path.open() as f:
                for line in f:
                    try:
                        done.add(json.loads(line)["path"])
                    except Exception:
                        pass

    bad_dir = skip_dir / "bad_frames"
    bad_dir.mkdir(parents=True, exist_ok=True)

    # --- load model ----------------------------------------------------------
    print("🔮  Loading Qwen-VL-2B-Instruct…")
    model = Qwen2VLForConditionalGeneration.from_pretrained(
        "Qwen/Qwen2-VL-2B-Instruct", torch_dtype="auto", device_map="auto"
    ).eval()
    processor = AutoProcessor.from_pretrained("Qwen/Qwen2-VL-2B-Instruct")

    # --- prepare output ------------------------------------------------------
    if fmt == "txt":
        out_path.mkdir(parents=True, exist_ok=True)
    else:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_jsonl = out_path.open("a", encoding="utf-8")

    # --- main loop -----------------------------------------------------------
    for vid in tqdm(videos, desc="Captioning"):
        if str(vid) in done:
            continue  # already captioned, leave it be 🌱

        frames = get_num_frames(vid)
        if frames is None or frames < 2:
            shutil.move(str(vid), bad_dir / vid.name)
            continue

        try:
            messages = [build_message(vid, fps, max_pixels)]
            prompt = processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            img_in, vid_in = process_vision_info(messages)
            inputs = processor(
                text=[prompt],
                images=img_in,
                videos=vid_in,
                padding=True,
                return_tensors="pt",
            ).to(device)
        except Exception:
            shutil.move(str(vid), bad_dir / vid.name)
            continue

        try:
            with torch.inference_mode():
                out_ids = model.generate(**inputs, max_new_tokens=128)
            trimmed = out_ids[:, inputs.input_ids.shape[1]:]
            caption = processor.batch_decode(
                trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
            )[0]
        except Exception:
            shutil.move(str(vid), bad_dir / vid.name)
            continue

        # save
        if fmt == "txt":
            (out_path / vid.with_suffix(".txt").name).write_text(
                caption.strip() + "\n", encoding="utf-8"
            )
        else:
            out_jsonl.write(json.dumps({"path": str(vid), "caption": caption}) + "\n")

    if fmt == "jsonl":
        out_jsonl.close()
    print(f"\n\033[32m✅  Captions stored at → {out_path}\033[0m")
    print(f"⚠️  Uncaptionable videos moved to → {bad_dir}")


# ─── CLI ────────────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Caption every video; leave already-captioned untouched, move only failures.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("input", type=Path)
    p.add_argument("output", type=Path)
    p.add_argument("--format", choices=["jsonl", "txt"], default="jsonl")
    p.add_argument("--fps", type=float, default=None,
                   help="Frame-sampling FPS (uses raw video if omitted)")
    p.add_argument("--max-pixels", type=int, default=None)
    p.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
    p.add_argument("--skip-dir", type=Path, default=Path("skipped_videos"))
    return p.parse_args()


def main() -> None:
    args = parse_args()
    print(BANNER)

    vids = list(list_videos(args.input))
    if not vids:
        print("⚠️  No videos found."); return
    print(f"🎬  Found {len(vids)} video(s).")

    args.skip_dir.mkdir(parents=True, exist_ok=True)

    caption(
        videos=vids,
        out_path=args.output,
        fmt=args.format,
        fps=args.fps,
        max_pixels=args.max_pixels,
        device=args.device,
        skip_dir=args.skip_dir,
    )


if __name__ == "__main__":
    main()
