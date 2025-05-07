#!/usr/bin/env python3
# huggingface_downloader.py — Teleports models from Hugging Face into your ComfyUI
# tree with cosmic courtesy and rainbow‑grade UX. 🚀✨

"""
╭──────────────────────────────────────────────────────────────────────────────╮
│  Magix ☄️ Hugging Face Downloader                                        │
│                                                                              │
│  * Automagically fetch any HF file (checkpoint, LoRA, VAE, etc.).            │
│  * One‑time config: tell us where your `comfyui/models` kingdom lives.       │
│  * Choose or create destination sub‑folders on the fly.                      │
│  * Optional renaming (or accept the default — your call).                    │
│                                                                              │
│  Run it:                                                                     │
│    $ python huggingface_downloader.py                                        │
│                                                                              │
│  ✨  Because “download & unzip” is no one’s favourite meditation.             │
╰──────────────────────────────────────────────────────────────────────────────╯
"""

from __future__ import annotations

import json
import os
import sys
import textwrap
import urllib.parse
from pathlib import Path
from typing import Dict, Optional

try:
    import requests
    from tqdm import tqdm
except ImportError:
    sys.exit(
        "Missing deps! Run:\n  pip install --upgrade requests tqdm\n"
        "…then re‑invoke this script. 🔄✨"
    )

# ─── Styling ──────────────────────────────────────────────────────────────────
BOLD = "\033[1m"
MAGENTA = "\033[0;35m"
CYAN = "\033[0;36m"
YELLOW = "\033[1;33m"
GREEN = "\033[0;32m"
RED = "\033[0;31m"
RESET = "\033[0m"

SPARKLE = "✨"
ROCKET = "🚀"
CHECK = "✅"
WARNING = "⚠️"
HEART = "💖"

# ─── Configuration ────────────────────────────────────────────────────────────
CONFIG_FILE = Path(__file__).with_name("magix_config.json")
MODELS_KEY = "comfyui_models_dir"


def load_config() -> Dict[str, str]:
    if CONFIG_FILE.exists():
        try:
            with CONFIG_FILE.open("r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            print(f"{YELLOW}{WARNING} Could not read config; starting fresh.{RESET}")
    return {}


def save_config(cfg: Dict[str, str]) -> None:
    try:
        with CONFIG_FILE.open("w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        print(f"{GREEN}{CHECK} Config saved to {CONFIG_FILE}{RESET}")
    except OSError:
        print(f"{RED}{WARNING} Failed to write config file.{RESET}")


# ─── Helpers ──────────────────────────────────────────────────────────────────
def prompt(text: str, default: Optional[str] = None) -> str:
    suffix = f" [{default}]" if default else ""
    while True:
        reply = input(f"{CYAN}{text}{suffix}{RESET}\n> ").strip()
        if reply:
            return reply
        if default is not None:
            return default


def pick_option(options: list[str], message: str) -> str:
    print(f"\n{BOLD}{message}{RESET}")
    for idx, opt in enumerate(options, 1):
        print(f"  {idx}) {opt}")
    while True:
        sel = input("\nEnter number (or 0 to create new): ").strip()
        if sel == "0":
            name = prompt("Name of new sub‑folder")
            return name
        if sel.isdigit() and 1 <= int(sel) <= len(options):
            return options[int(sel) - 1]
        print(f"{YELLOW}Invalid choice. Try again.{RESET}")


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"\n{ROCKET} Downloading to {dest} …")
    with requests.get(url, stream=True, allow_redirects=True) as r:
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        with tqdm(
            total=total,
            unit="B",
            unit_scale=True,
            unit_divisor=1024,
            bar_format=" {l_bar}{bar} | {n_fmt}/{total_fmt}",
        ) as bar, dest.open("wb") as f:
            for chunk in r.iter_content(chunk_size=4096):
                f.write(chunk)
                bar.update(len(chunk))
    print(f"{GREEN}{CHECK} Download complete!{RESET}")


def filename_from_url(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    name = Path(parsed.path).name
    return name or "downloaded_file"


# ─── Main Flow ────────────────────────────────────────────────────────────────
def main() -> None:
    print(
        f"{BOLD}{MAGENTA}{SPARKLE} Magix Hugging Face Downloader {SPARKLE}{RESET}\n"
        f"""{textwrap.fill('Let’s warp a file from the Hugging Face universe straight into your'
                                'ComfyUI models directory — while keeping the chi of your workspace '
                                'pure and radiant.', 80)}\n"""
    )

    cfg = load_config()

    # 1) Models directory setup
    if MODELS_KEY not in cfg or not Path(cfg[MODELS_KEY]).is_dir():
        default = os.path.expanduser("~/ComfyUI/models")
        path_input = prompt(
            f"Where is your ComfyUI ‘models’ directory?", default=default
        )
        models_dir = Path(path_input).expanduser().resolve()
        if not models_dir.is_dir():
            print(f"{YELLOW}{WARNING} Directory doesn’t exist; creating…{RESET}")
            models_dir.mkdir(parents=True, exist_ok=True)
        cfg[MODELS_KEY] = str(models_dir)
        save_config(cfg)
    else:
        models_dir = Path(cfg[MODELS_KEY])

    # 2) Choose primary sub‑folder
    subfolders = sorted(
        [p.name for p in models_dir.iterdir() if p.is_dir() and not p.name.startswith(".")]
    )
    chosen = pick_option(
        subfolders,
        f"Select a sub‑folder under {models_dir} "
        f"for the incoming artefact (or create new):",
    )
    dest_root = models_dir / chosen
    dest_root.mkdir(parents=True, exist_ok=True)

    # 3) Optional deeper sub‑folder
    deeper = prompt(
        "Optional: add a deeper sub‑folder? (leave blank to skip)", default=""
    )
    if deeper:
        dest_root = dest_root / deeper
        dest_root.mkdir(parents=True, exist_ok=True)

    # 4) Hugging Face URL
    url = prompt("Paste the direct Hugging Face download URL")

    # 5) Optional rename
    default_name = filename_from_url(url)
    new_name = prompt(
        f"Filename on disk?", default=default_name
    )
    target_path = dest_root / new_name

    if target_path.exists():
        overwrite = prompt(
            f"{target_path} exists. Overwrite? [y/N]", default="n"
        ).lower() == "y"
        if not overwrite:
            print(f"{RED}Abort to keep your existing file safe. Bye!{RESET}")
            return

    # 6) Download
    try:
        download(url, target_path)
    except Exception as e:
        print(f"{RED}{WARNING} Download failed: {e}{RESET}")
        return

    print(
        f"\n{MAGENTA}{HEART} All done! Your artefact awaits at:\n"
        f"   {BOLD}{target_path}{RESET}\n\n"
        f"May your frames be ever high‑def and your mind ever high‑dimensional. {SPARKLE}"
    )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Interrupted. No worries — breathe and try again later.{RESET}")
