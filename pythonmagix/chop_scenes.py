#!/usr/bin/env python3
# chop_scenes.py — Magix “Katana” pre-processor
# ─────────────────────────────────────────────────────────────────────────────
# Recursively scans an input directory for video files, detects hard-cut scenes
# with PySceneDetect, exports each scene as a lossless copy into a target
# folder, and (optionally) re-slices every scene into fixed-length chunks
# (e.g. 5-second clips) — perfect for ML dataset curation. ✨
#
# Usage:
#   python chop_scenes.py /path/to/videos  /path/to/output
#   python chop_scenes.py input  out  -c 5        # + chunk every scene at 5 s
#   python chop_scenes.py input  out  -t 20       # raise detection threshold
#   python chop_scenes.py input  out  --dry-run   # see what would happen
#
# Requirements:
#   pip install scenedetect[opencv] tqdm
#   # FFmpeg must be in PATH (used for lossless splitting: -c copy)
# -----------------------------------------------------------------------------

from __future__ import annotations

import argparse
import itertools
import os
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Sequence

from tqdm import tqdm

try:
    from scenedetect import ContentDetector, SceneManager, VideoManager
    from scenedetect.video_splitter import split_video_ffmpeg
except ImportError as e:  # pragma: no cover
    sys.exit(
        "✖️  PySceneDetect not found. Install:  pip install scenedetect[opencv]\n"
        "    (the [opencv] extra makes detection ~3× faster)\n"
    )

# ─── Config defaults ───────────────────────────────────────────────────────────
VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".flv", ".m4v"}
MAGIX_BANNER = (
    "\033[1m\033[35m✨  Magix Katana engaged — slicing video timelines with zen precision…\033[0m"
)

# ─── Helpers ───────────────────────────────────────────────────────────────────


def iter_videos(root: Path) -> Sequence[Path]:
    for p in root.rglob("*"):
        if p.suffix.lower() in VIDEO_EXTS and p.is_file():
            yield p


def fname_safe(stem: str) -> str:
    # keep it simple: replace spaces + forbid chars
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in stem)


def run_ffmpeg_split(
    src: Path,
    dst: Path,
    start: float,
    end: Optional[float] = None,
    dry: bool = False,
):
    cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        f"{start:.3f}",
    ]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"]
    cmd += ["-i", str(src), "-c", "copy", "-y", str(dst)]
    if dry:
        print(" ".join(cmd))
        return
    subprocess.run(cmd, check=True)


# ─── Scene detection & export ─────────────────────────────────────────────────


def process_video(
    path: Path,
    out_dir: Path,
    threshold: int,
    min_len_frames: int,
    chunk: Optional[float],
    dry: bool,
):
    rel_root = path.parent
    video_stem = fname_safe(path.stem)
    video_out_root = out_dir / rel_root.relative_to(rel_root.anchor) / video_stem
    video_out_root.mkdir(parents=True, exist_ok=True)

    # 1) Detect scenes
    vmanager = VideoManager([str(path)])
    smanager = SceneManager()
    smanager.add_detector(ContentDetector(threshold=threshold, min_scene_len=min_len_frames))

    vmanager.start()
    smanager.detect_scenes(frame_source=vmanager)
    scenes = smanager.get_scene_list()
    vmanager.release()

    if not scenes:
        # treat whole video as one scene
        scenes = [(None, None)]

    # 2) Export scenes using ffmpeg -c copy (fast, lossless)
    for idx, (start_time, end_time) in enumerate(scenes):
        start_s = start_time.get_seconds() if start_time else 0.0
        end_s = end_time.get_seconds() if end_time else None
        scene_name = f"{idx:04d}.mp4"
        scene_path = video_out_root / scene_name
        run_ffmpeg_split(path, scene_path, start_s, end_s, dry=dry)

        # Optional fixed-length chunking
        if chunk and not dry:
            dur = (end_s - start_s) if end_s else None
            if dur is None:
                # probe duration
                prob = subprocess.run(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of",
                     "default=noprint_wrappers=1:nokey=1", str(scene_path)],
                    capture_output=True,
                    text=True,
                    check=True,
                )
                dur = float(prob.stdout.strip())
            steps = int(dur // chunk) + (1 if dur % chunk > 0.01 else 0)
            for j in range(steps):
                c_start = j * chunk
                c_end = min(dur, (j + 1) * chunk)
                c_name = scene_path.with_name(f"{scene_path.stem}_{j:02d}{scene_path.suffix}")
                run_ffmpeg_split(scene_path, c_name, c_start, c_end, dry=dry)
            # remove original long scene after slicing
            if steps > 1:
                scene_path.unlink(missing_ok=True)


# ─── CLI ──────────────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Detect scenes & slice videos into dataset-ready clips.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    p.add_argument("input", type=Path, help="Input directory (walked recursively)")
    p.add_argument("output", type=Path, help="Destination root for clips")
    p.add_argument("-t", "--threshold", type=int, default=30,
                   help="Cut detection threshold (PySceneDetect ContentDetector)")
    p.add_argument("--min-frames", type=int, default=15,
                   help="Minimum scene length in frames")
    p.add_argument(
        "-c",
        "--chunk",
        type=float,
        default=None,
        metavar="SECONDS",
        help="If set, further split each scene into fixed-length chunks",
    )
    p.add_argument("--dry-run", action="store_true", help="Print commands, do nothing")
    return p.parse_args()


# ─── Main ─────────────────────────────────────────────────────────────────────
def main() -> None:
    args = parse_args()
    print(MAGIX_BANNER)
    videos = list(iter_videos(args.input))
    if not videos:
        print("⚠️  No videos found. Exiting.")
        return

    print(f"🔍  Found {len(videos)} video(s).")
    for vid in tqdm(videos, desc="Processing"):
        try:
            process_video(
                vid,
                args.output,
                threshold=args.threshold,
                min_len_frames=args.min_frames,
                chunk=args.chunk,
                dry=args.dry_run,
            )
        except subprocess.CalledProcessError as e:
            print(f"⚠️  FFmpeg error while processing {vid}: {e}", file=sys.stderr)
        except Exception as e:
            print(f"⚠️  Failed on {vid}: {e}", file=sys.stderr)

    print("\n\033[32m✅  All done! Clips await at → {}\033[0m".format(args.output))


if __name__ == "__main__":
    main()
