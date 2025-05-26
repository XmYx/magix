# ✨ Magix Oracle — *caption\_videos.py*

> *Unveiling stories inside pixels.*
>
> **Version 3 — gentle‑skip edition**

---

| :movie\_camera: | Autocaptions every video in a folder ( **Qwen‑VL 2B** )                                            |
| --------------- | -------------------------------------------------------------------------------------------------- |
| :seedling:      | Already‑captioned clips are **left untouched**                                                     |
| :wastebasket:   | Videos that can’t be processed (too few frames / errors) are moved to **`<skip_dir>/bad_frames/`** |
| :scroll:        | Captions saved to plain‑text *or* streaming JSONL                                                  |

---

## Table of Contents

1. [Why Oracle?](#why-oracle)
2. [Features](#features)
3. [Quick‑Start](#quick-start)
4. [CLI Options](#cli-options)
5. [Dependencies](#dependencies)
6. [How It Works](#how-it-works)
7. [FAQ](#faq)
8. [License](#license)

---

## Why **Oracle**?

*Oracle* grew from countless screening sessions of unlabeled footage. Traditional off‑the‑shelf captioners ingest whole videos repeatedly, or splatter failures across your workspace. **Oracle** is polite:

* It **skips files** that already have captions.
* It cleverly **sidetracks corrupted media** so your nice directory stays pristine.
* It powers all of this with **Qwen‑VL‑2B**—small enough for one GPU / recent CPU, yet strong on audiovisual semantics.

---

## ✨ Features

| Spell                  | Description                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Gentle‑skip**        | If a caption file exists (TXT) or an entry is present in your JSONL, the video is ignored—no overwrite, no log spam. |
| **Auto triage**        | Any clip with < 2 frames **or** preprocessing/model errors gets shuffled to `skipped_videos/bad_frames`.             |
| **Dual output**        | Choose `--format txt` to drop one `.txt` per video, or `--format jsonl` for a streaming dataset file.                |
| **Smart sampling**     | `--fps N` down‑samples high‑FPS footage to reduce tokens. Leave blank to feed whole video.                           |
| **Resolution control** | `--max-pixels` clamps each frame sent to Qwen (avoid OOM on 4K+).                                                    |
| **GPU/CPU toggle**     | Automatically uses CUDA if available (`--device` override).                                                          |
| **Progress bars**      | `tqdm`‑powered delight.                                                                                              |

---

## 🚀 Quick Start

```bash
# 1️⃣  Install deps (CUDA build shown)
conda create -n oracle python=3.11 -y && conda activate oracle
pip install torch --index-url https://download.pytorch.org/whl/cu121
pip install transformers==4.41.2 tqdm ffmpeg-python

# You also need ffmpeg / ffprobe on PATH
# macOS:  brew install ffmpeg
# Debian: sudo apt install ffmpeg

# 2️⃣  Run on a folder of videos → captions.jsonl, skip bin
python caption_videos.py ./videos ./captions.jsonl

# 3️⃣  Fancy: sample at 1 fps, clamp 1.5 MP, output individual TXT files
python caption_videos.py ./videos ./captions --format txt --fps 1 \
       --max-pixels 1500000 --skip-dir ./rejects
```

> **Tip:** You can resume anytime; already‑done files remain unaltered. 💚

---

## 🔧 CLI Options

| Flag                   | Default          | Purpose                                          |                      |
| ---------------------- | ---------------- | ------------------------------------------------ | -------------------- |
| `input`                | —                | Directory (recursive) containing videos          |                      |
| `output`               | —                | Output path: directory (TXT) **or** file (JSONL) |                      |
| `--format {jsonl,txt}` | `jsonl`          | Storage mode                                     |                      |
| `--fps N`              | *(raw video)*    | Extract N frames‑per‑second to send to LLM       |                      |
| `--max-pixels P`       | *(no clamp)*     | Resize frames so `H×W <= P`                      |                      |
| \`--device cuda        | cpu\`            | auto                                             | Force compute device |
| `--skip-dir DIR`       | `skipped_videos` | Where to park troublesome clips                  |                      |
| `-h, --help`           |                  | Show help                                        |                      |

---

## 🧙 How It Works

1. **Discovery** — Recurses through `input`, collecting any file with extension in {mp4, mkv, …}.
2. **Dup‑check** — TXT: looks for `video_name.txt` next to output dir; JSONL: checks if video path already inside.
3. **Validation** — Uses `ffprobe` to count packets; videos with <2 frames are banished.
4. **Frame sampling** — If `--fps` given, `ffmpeg` writes JPEGs to a tmp dir; otherwise raw video URI is passed.
5. **Prompt build** — Creates a Qwen‑VL **ChatML** message: *Describe this video.*
6. **Generation** — Qwen‑VL‑2B emits one chunk (`max_new_tokens 128`).
7. **Storage** — Caption persisted; success counters updated; loop continues.

A failure in **any** step (decode error, model panic, etc.) punts the clip to `bad_frames` so you can inspect later.

---

## ❓ FAQ

<details>
<summary>Can I use a bigger Qwen model?</summary>
Yes—swap the model ID in the source (`Qwen/Qwen2-VL-7B-Instruct`) and make sure you have VRAM.
</details>

<details>
<summary>Why not Whisper-video?</summary>
Whisper transcribes *audio*; Oracle summarises **visual content** (silent CCTV, gameplay, etc.). Different spells!
</details>

<details>
<summary>Is there a Windows build?</summary>
With WSL2 or Conda you should be fine, provided `ffmpeg` works. Native PowerShell TBD.
</details>

---

## 🪄 License

Released under MIT. May your pixels always speak truths. ✨
