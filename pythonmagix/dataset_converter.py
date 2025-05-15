#!/usr/bin/env python3
"""
build_dataset.py

Scan a directory tree for *.mp4 video files that have a sibling *.txt caption file.
Outputs either:
  • captions.txt  +  video_paths.txt   (line-aligned)         OR
  • captions.json (list of {"video_path", "caption"} objects)

Assumptions
-----------
For every <name>.mp4 there is a <name>.txt containing one caption line.
If a caption is missing the video is skipped (warning to stderr).

Examples
--------
# Two-file manifest written next to videos
python build_dataset.py ./dataset_root

# Single JSON manifest in ./manifest/
python build_dataset.py ./dataset_root --output-format json --output-dir ./manifest

Afterwards you can feed it to the trainer, e.g.:
python scripts/preprocess_dataset.py manifest/ \
    --caption-column captions \
    --video-column video_paths
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def collect_pairs(root: Path, recursive: bool = False):
    """Return a list of (relative_video_path, caption) tuples."""
    pattern = "**/*.mp4" if recursive else "*.mp4"
    videos = list(root.glob(pattern))
    pairs: list[tuple[str, str]] = []

    for video in sorted(videos):
        caption_file = video.with_suffix(".txt")
        if not caption_file.exists():
            print(f"⚠️  No caption for {video}, skipping.", file=sys.stderr)
            continue

        caption = caption_file.read_text(encoding="utf-8").strip()
        # Collapse multi-line captions to one line
        caption = " ".join(caption.splitlines()).strip()

        rel_path = video.relative_to(root).as_posix()  # portable
        pairs.append((rel_path, caption))

    return pairs


def write_txt(pairs, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "captions.txt").open("w", encoding="utf-8") as cfp, \
         (out_dir / "video_paths.txt").open("w", encoding="utf-8") as vfp:
        for video_path, caption in pairs:
            cfp.write(caption + "\n")
            vfp.write(video_path + "\n")
    print(f"✅ Wrote {len(pairs):,} pairs → captions.txt & video_paths.txt")


def write_json(pairs, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    with (out_dir / "captions.json").open("w", encoding="utf-8") as fp:
        json.dump(
            [{"video_path": vp, "caption": cap} for vp, cap in pairs],
            fp,
            ensure_ascii=False,
            indent=2,
        )
    print(f"✅ Wrote {len(pairs):,} pairs → captions.json")


def main():
    p = argparse.ArgumentParser(description="Build manifest for video-caption dataset")
    p.add_argument("root", type=Path,
                   help="Directory containing *.mp4 + *.txt pairs")
    p.add_argument("--output-format", choices=("txt", "json"), default="txt",
                   help="Manifest type to write (default: txt)")
    p.add_argument("--output-dir", type=Path, default=None,
                   help="Destination directory (default: <root>/)")
    p.add_argument("--recursive", action="store_true",
                   help="Descend into sub-directories")
    args = p.parse_args()

    if not args.root.is_dir():
        p.error(f"{args.root} is not a directory")

    pairs = collect_pairs(args.root, args.recursive)
    if not pairs:
        p.error("No video/caption pairs found")

    out_dir = args.output_dir or args.root
    (write_txt if args.output_format == "txt" else write_json)(pairs, out_dir)


if __name__ == "__main__":
    main()
