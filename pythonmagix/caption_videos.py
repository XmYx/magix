#!/usr/bin/env python3
# caption_videos.py — Magix "Oracle" (v6 – Predictive OOM Prevention)
# ─────────────────────────────────────────────────────────────────────────────
# Same power, softer touch, now with predictive OOM prevention:
#   • Videos already captioned are **left where they are** (silently skipped).
#   • 30-second timeout per video with model reload on timeout
#   • Smart OOM prediction based on previous failures
#   • Preemptive scaling for videos likely to cause OOM
#   • Progressive downscaling as fallback (90% -> 80% -> ... -> 25%)
#   • Aggressive VRAM cleanup between videos for stability
#   • Fixed processor kwargs handling
# -----------------------------------------------------------------------------

from __future__ import annotations

import argparse
import gc
import json
import shutil
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Dict, List, Sequence, Optional, Tuple

import torch
from tqdm import tqdm
from transformers import AutoProcessor, Qwen2VLForConditionalGeneration

from qwen_vl_utils import process_vision_info  # type: ignore

VIDEO_EXT = {".mp4", ".mkv", ".mov", ".avi", ".webm", ".flv", ".m4v"}
BANNER = "\033[1m\033[35m✨  Magix Oracle: unveiling stories inside pixels… (Predictive OOM)\033[0m"
TIMEOUT_SECONDS = 30
MIN_SCALE = 0.25  # Minimum 25% of original size
SCALE_STEP = 0.1  # Reduce by 10% each time
OOM_HISTORY_FILE = "oom_history.json"


class TimeoutError(Exception):
    pass


def timeout_handler(signum, frame):
    raise TimeoutError("Video processing timed out")


class OOMPredictor:
    """Predicts OOM likelihood based on video characteristics."""

    def __init__(self, history_file: Path):
        self.history_file = history_file
        self.oom_failures = []
        self.load_history()

    def load_history(self):
        """Load OOM failure history from file."""
        if self.history_file.exists():
            try:
                with open(self.history_file, 'r') as f:
                    self.oom_failures = json.load(f)
                print(f"📊  Loaded {len(self.oom_failures)} OOM failure records")
            except Exception as e:
                print(f"⚠️  Could not load OOM history: {e}")
                self.oom_failures = []

    def save_history(self):
        """Save OOM failure history to file."""
        try:
            with open(self.history_file, 'w') as f:
                json.dump(self.oom_failures, f, indent=2)
        except Exception as e:
            print(f"⚠️  Could not save OOM history: {e}")

    def record_oom_failure(self, video_info: Dict):
        """Record a new OOM failure."""
        self.oom_failures.append({
            **video_info,
            'timestamp': time.time()
        })
        self.save_history()
        print(f"📝  Recorded OOM failure for {video_info.get('name', 'unknown')}")

    def get_safe_thresholds(self) -> Dict[str, float]:
        """Calculate safe thresholds based on OOM history."""
        if not self.oom_failures:
            # Conservative defaults if no history
            return {
                'file_size_mb': 500,  # 500MB
                'total_pixels': 1920 * 1080 * 300,  # 1080p * 300 frames
                'width': 1920,
                'height': 1080,
                'frame_count': 300,
                'duration': 30.0
            }

        # Find the smallest values that caused OOM (most conservative)
        thresholds = {}
        for metric in ['file_size_mb', 'total_pixels', 'width', 'height', 'frame_count', 'duration']:
            values = [f.get(metric, float('inf')) for f in self.oom_failures if f.get(metric) is not None]
            if values:
                # Use 80% of the smallest failing value as threshold
                thresholds[metric] = min(values) * 0.8
            else:
                # Fallback defaults
                defaults = {
                    'file_size_mb': 500,
                    'total_pixels': 1920 * 1080 * 300,
                    'width': 1920,
                    'height': 1080,
                    'frame_count': 300,
                    'duration': 30.0
                }
                thresholds[metric] = defaults[metric]

        return thresholds

    def predict_oom_risk(self, video_info: Dict) -> Tuple[bool, float, str]:
        """
        Predict if video is likely to cause OOM.
        Returns: (is_risky, suggested_scale, reason)
        """
        thresholds = self.get_safe_thresholds()

        risks = []

        # Check various risk factors
        if video_info.get('file_size_mb', 0) > thresholds['file_size_mb']:
            excess = video_info['file_size_mb'] / thresholds['file_size_mb']
            risks.append(('file_size', excess))

        if video_info.get('total_pixels', 0) > thresholds['total_pixels']:
            excess = video_info['total_pixels'] / thresholds['total_pixels']
            risks.append(('total_pixels', excess))

        if video_info.get('width', 0) > thresholds['width']:
            excess = video_info['width'] / thresholds['width']
            risks.append(('width', excess))

        if video_info.get('height', 0) > thresholds['height']:
            excess = video_info['height'] / thresholds['height']
            risks.append(('height', excess))

        if video_info.get('frame_count', 0) > thresholds['frame_count']:
            excess = video_info['frame_count'] / thresholds['frame_count']
            risks.append(('frame_count', excess))

        if not risks:
            return False, 1.0, "safe"

        # Find the highest risk factor
        highest_risk = max(risks, key=lambda x: x[1])
        risk_type, risk_ratio = highest_risk

        # Suggest scale based on risk ratio
        if risk_ratio > 2.0:
            suggested_scale = 0.5  # 50% for very high risk
        elif risk_ratio > 1.5:
            suggested_scale = 0.7  # 70% for high risk
        else:
            suggested_scale = 0.9  # 90% for moderate risk

        reason = f"{risk_type} {risk_ratio:.1f}x over threshold"
        return True, suggested_scale, reason


# ─── Utilities ──────────────────────────────────────────────────────────────
def list_videos(root: Path) -> Sequence[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in VIDEO_EXT)


def get_video_info(video: Path) -> Dict:
    """Get comprehensive video information."""
    info = {
        'name': video.name,
        'path': str(video),
        'file_size_mb': video.stat().st_size / (1024 * 1024),
    }

    try:
        # Get resolution, frame count, and duration
        out = subprocess.check_output(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=width,height,nb_frames,duration",
                "-of", "csv=p=0", str(video)
            ],
            stderr=subprocess.DEVNULL,
            text=True,
        )

        parts = out.strip().split(',')
        if len(parts) >= 2:
            info['width'] = int(parts[0])
            info['height'] = int(parts[1])

            # Try to get frame count (might not always work)
            if len(parts) >= 3 and parts[2] and parts[2] != 'N/A':
                info['frame_count'] = int(parts[2])
            else:
                # Fallback: count frames manually
                frame_count = get_num_frames(video)
                if frame_count:
                    info['frame_count'] = frame_count

            # Duration
            if len(parts) >= 4 and parts[3] and parts[3] != 'N/A':
                info['duration'] = float(parts[3])

            # Calculate total pixels
            if 'frame_count' in info:
                info['total_pixels'] = info['width'] * info['height'] * info['frame_count']

    except Exception:
        pass

    return info


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


def create_downscaled_video(video: Path, scale: float, tmp_dir: Path) -> Path:
    """Create a downscaled version of the video."""
    tmp_dir.mkdir(parents=True, exist_ok=True)
    scaled_video = tmp_dir / f"scaled_{scale:.0%}_{video.name}"

    # Use scale filter to downscale video
    scale_filter = f"scale=iw*{scale}:ih*{scale}"

    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", str(video),
            "-vf", scale_filter,
            "-c:v", "libx264", "-preset", "fast", "-crf", "23",
            "-avoid_negative_ts", "make_zero",
            str(scaled_video)
        ],
        check=True,
    )
    return scaled_video


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


def aggressive_cleanup():
    """Aggressive GPU memory cleanup."""
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()
        torch.cuda.ipc_collect()
        # Force garbage collection multiple times
        for _ in range(3):
            gc.collect()
        torch.cuda.empty_cache()


def load_model(device: str) -> Tuple[Qwen2VLForConditionalGeneration, AutoProcessor]:
    """Load the model and processor."""
    print("🔮  Loading Qwen-VL-2B-Instruct…")

    # Clear any existing GPU memory first
    aggressive_cleanup()

    model = Qwen2VLForConditionalGeneration.from_pretrained(
        "Qwen/Qwen2-VL-2B-Instruct",
        torch_dtype="auto",
        device_map="auto"
    ).eval()

    processor = AutoProcessor.from_pretrained("Qwen/Qwen2-VL-2B-Instruct")

    return model, processor


def safe_processor_call(processor, prompt: str, img_in, vid_in, device: str):
    """Safely call processor with fallback for kwargs issues."""
    try:
        # Try the standard call first
        inputs = processor(
            text=[prompt],
            images=img_in,
            videos=vid_in,
            padding=True,
            return_tensors="pt",
        )
    except TypeError as e:
        if "return_tensors" in str(e) or "unrecognized kwargs" in str(e):
            # Fallback without return_tensors
            try:
                inputs = processor(
                    text=[prompt],
                    images=img_in,
                    videos=vid_in,
                    padding=True,
                )
                # Convert to tensors manually if needed
                for key, value in inputs.items():
                    if isinstance(value, list) and len(value) > 0:
                        if isinstance(value[0], (int, float)):
                            inputs[key] = torch.tensor(value)
                        elif hasattr(value[0], '__iter__'):
                            inputs[key] = torch.tensor(value)
            except Exception:
                # Last resort - try minimal call
                inputs = processor(text=[prompt], padding=True)
        else:
            raise

    return inputs.to(device)


def process_single_video_with_prediction(
        vid: Path,
        model: Qwen2VLForConditionalGeneration,
        processor: AutoProcessor,
        fps: float | None,
        max_pixels: int | None,
        device: str,
        tmp_dir: Path,
        oom_predictor: OOMPredictor,
) -> Optional[str]:
    """Process a single video with OOM prediction and progressive scaling."""

    # Get video info for prediction
    video_info = get_video_info(vid)

    # Predict OOM risk
    is_risky, suggested_scale, reason = oom_predictor.predict_oom_risk(video_info)

    if is_risky:
        print(f"🔍  {vid.name}: Predicted OOM risk ({reason}) - starting at {suggested_scale:.0%}")
        current_scale = suggested_scale
    else:
        current_scale = 1.0

    current_video = vid
    scaled_video_path = None

    while current_scale >= MIN_SCALE:
        try:
            # Create scaled video if needed
            if current_scale < 1.0 and current_video == vid:
                scaled_video_path = create_downscaled_video(vid, current_scale, tmp_dir)
                current_video = scaled_video_path

            # Set up timeout
            signal.signal(signal.SIGALRM, timeout_handler)
            signal.alarm(TIMEOUT_SECONDS)

            frames = get_num_frames(current_video)
            if frames is None or frames < 2:
                return None

            messages = [build_message(current_video, fps, max_pixels)]
            prompt = processor.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )
            img_in, vid_in = process_vision_info(messages)

            # Use safe processor call
            inputs = safe_processor_call(processor, prompt, img_in, vid_in, device)

            with torch.inference_mode():
                out_ids = model.generate(**inputs, max_new_tokens=128)

            trimmed = out_ids[:, inputs.input_ids.shape[1]:]
            caption = processor.batch_decode(
                trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False
            )[0]

            # Clean up tensors
            del inputs, out_ids, trimmed
            aggressive_cleanup()

            # Clean up any scaled video file
            if scaled_video_path and scaled_video_path.exists():
                scaled_video_path.unlink()

            scale_info = f" (scaled to {current_scale:.0%})" if current_scale < 1.0 else ""
            if current_scale < 1.0:
                print(f"✅ Processed {vid.name}{scale_info}")

            return caption.strip()

        except TimeoutError:
            print(f"\n⏰  Timeout processing {vid.name} - will reload model and continue")
            return "TIMEOUT"

        except RuntimeError as e:
            if "CUDA out of memory" in str(e) or "out of memory" in str(e):
                print(f"\n🔥  CUDA OOM for {vid.name} at {current_scale:.0%} scale")

                # Record this OOM failure if at original scale
                if current_scale == 1.0:
                    oom_predictor.record_oom_failure(video_info)

                # Aggressive cleanup after OOM
                signal.alarm(0)  # Cancel timeout
                if 'inputs' in locals():
                    del inputs
                if 'out_ids' in locals():
                    del out_ids
                if 'trimmed' in locals():
                    del trimmed
                aggressive_cleanup()
                time.sleep(1)  # Brief pause

                # Try scaling down
                current_scale -= SCALE_STEP
                if current_scale < MIN_SCALE:
                    print(f"❌  Cannot scale {vid.name} below {MIN_SCALE:.0%}, giving up")
                    return None

                # Clean up previous scaled video
                if scaled_video_path and scaled_video_path.exists():
                    scaled_video_path.unlink()

                print(f"🔽  Scaling down to {current_scale:.0%} and retrying...")

                try:
                    scaled_video_path = create_downscaled_video(vid, current_scale, tmp_dir)
                    current_video = scaled_video_path
                    # Continue the loop to retry with scaled video
                    continue
                except Exception as scale_error:
                    print(f"❌  Failed to scale video: {scale_error}")
                    return None
            else:
                print(f"\n❌  Error processing {vid.name}: {e}")
                return None

        except Exception as e:
            print(f"\n❌  Error processing {vid.name}: {e}")
            return None
        finally:
            signal.alarm(0)  # Cancel the alarm

    return None


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
    # Initialize OOM predictor
    oom_predictor = OOMPredictor(skip_dir / OOM_HISTORY_FILE)

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
    timeout_dir = skip_dir / "timeout_failures"
    bad_dir.mkdir(parents=True, exist_ok=True)
    timeout_dir.mkdir(parents=True, exist_ok=True)

    # Create temp directory for scaled videos
    temp_dir = Path(tempfile.mkdtemp(prefix="scaled_videos_"))

    # --- load model ----------------------------------------------------------
    model, processor = load_model(device)

    # --- prepare output ------------------------------------------------------
    if fmt == "txt":
        out_path.mkdir(parents=True, exist_ok=True)
    else:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_jsonl = out_path.open("a", encoding="utf-8")

    # --- main loop -----------------------------------------------------------
    processed_count = 0
    timeout_count = 0

    try:
        for i, vid in enumerate(tqdm(videos, desc="Captioning")):
            if str(vid) in done:
                continue  # already captioned, leave it be 🌱

            caption_result = process_single_video_with_prediction(
                vid, model, processor, fps, max_pixels, device, temp_dir, oom_predictor
            )

            if caption_result == "TIMEOUT":
                # Handle timeout - reload model and move video
                timeout_count += 1
                shutil.move(str(vid), timeout_dir / vid.name)

                # Reload model every few timeouts
                if timeout_count % 3 == 0:
                    print(f"\n🔄  Reloading model after {timeout_count} timeouts...")
                    del model, processor
                    aggressive_cleanup()
                    time.sleep(2)  # Brief pause
                    model, processor = load_model(device)
                    processed_count = 0

                continue

            elif caption_result is None:
                # Regular failure - move to bad_frames
                shutil.move(str(vid), bad_dir / vid.name)
                continue

            # Success - save caption
            if fmt == "txt":
                (out_path / vid.with_suffix(".txt").name).write_text(
                    caption_result + "\n", encoding="utf-8"
                )
            else:
                out_jsonl.write(json.dumps({"path": str(vid), "caption": caption_result}) + "\n")

            processed_count += 1

            # Periodic cleanup
            if processed_count % 50 == 0:
                print(f"\n🧹  Periodic cleanup after {processed_count} videos...")
                aggressive_cleanup()

            # Reload model periodically for very long runs
            if processed_count % 300 == 0:
                print(f"\n🔄  Periodic model reload after {processed_count} videos...")
                del model, processor
                aggressive_cleanup()
                time.sleep(2)
                model, processor = load_model(device)

    finally:
        # Cleanup temp directory
        shutil.rmtree(temp_dir, ignore_errors=True)

    if fmt == "jsonl":
        out_jsonl.close()

    print(f"\n\033[32m✅  Captions stored at → {out_path}\033[0m")
    print(f"⚠️   Uncaptionable videos moved to → {bad_dir}")
    if timeout_count > 0:
        print(f"⏰  {timeout_count} videos timed out and moved to → {timeout_dir}")


# ─── CLI ────────────────────────────────────────────────────────────────────
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Caption every video; predictive OOM prevention with smart scaling.",
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
        print("⚠️  No videos found.");
        return
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