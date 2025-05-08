#!/usr/bin/env bash
# update_conda_env.sh — Supercharge your Conda env (latest PyTorch cu128,
# ComfyUI custom-nodes, LTX-Video Q8 kernels) — now with a persistent
# config prompt so Magix remembers where your ComfyUI lives. ✨
# ------------------------------------------------------------------------------

set -euo pipefail

###############################################################################
# 🎨 Colours & emoji
###############################################################################
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; MAGENTA='\033[0;35m'; CYAN='\033[0;36m'
BOLD='\033[1m'; RESET='\033[0m'
ROCKET="🚀"; SPARKLE="✨"; CHECK="✅"; WARNING="⚠️"; HEART="💖"

###############################################################################
# 📂 1 — Locate / remember ComfyUI root (↔ ~/.magix_config.json)
###############################################################################
CONFIG_FILE="${HOME}/.magix_config.json"
key='comfyui_root_dir'          # shared by all Magix tools

# -- read existing value -------------------------------------------------------
COMFYUI_DIR=""
if [[ -f "$CONFIG_FILE" ]]; then
  COMFYUI_DIR=$(python - "$CONFIG_FILE" "$key" <<'PY'
import json, sys, pathlib, os
cfg = pathlib.Path(sys.argv[1])
k = sys.argv[2]
try:
    data = json.loads(cfg.read_text())
    print(data.get(k, ""))
except Exception:
    pass
PY
  )
fi

# -- prompt / confirm ----------------------------------------------------------
default_dir="${COMFYUI_DIR:-$HOME/ComfyUI}"
if [[ -n "$COMFYUI_DIR" ]]; then
  read -rp "$(echo -e "${CYAN}🤔  Use saved ComfyUI path → ${BOLD}${COMFYUI_DIR}${RESET}${CYAN}? [Y/n] ${RESET}")" yn
  case "$yn" in [Nn]*) COMFYUI_DIR="";; esac
fi

if [[ -z "$COMFYUI_DIR" ]]; then
  read -rp "$(echo -e "${CYAN}🔍  Enter the path to your ComfyUI root:${RESET} [$default_dir] ")" input_dir
  COMFYUI_DIR="${input_dir:-$default_dir}"
fi

# -- persist back to JSON ------------------------------------------------------
python - "$CONFIG_FILE" "$key" "$COMFYUI_DIR" <<'PY'
import json, pathlib, sys, os
cfg = pathlib.Path(sys.argv[1]); key = sys.argv[2]; val = sys.argv[3]
data = {}
if cfg.exists():
    try:
        data = json.loads(cfg.read_text())
    except Exception:
        pass
data[key] = val
cfg.write_text(json.dumps(data, indent=2))
PY

CUSTOM_DIR="${COMFYUI_DIR}/custom_nodes"

###############################################################################
# 0️⃣  Welcome
###############################################################################
echo -e "\n${BOLD}${MAGENTA}${SPARKLE} Hey there, Rockstar Dev! Let's make this environment shine!${RESET}"
echo -e "${BLUE}🎯  Working with ComfyUI at → ${BOLD}${CUSTOM_DIR}${RESET}\n"

###############################################################################
# 1️⃣  Install latest PyTorch (CUDA 12.8)
###############################################################################
echo -e "${BOLD}${CYAN}${ROCKET} Step 1/4 – Installing latest PyTorch (cu128)…${RESET}"
PYTORCH_INDEX="https://download.pytorch.org/whl/cu128"

pip install --upgrade torch torchvision torchaudio --index-url "$PYTORCH_INDEX" \
  && echo -e "${GREEN}${CHECK} PyTorch stack installed successfully!${RESET}" \
  || { echo -e "${RED}${WARNING} PyTorch installation failed. Exiting.${RESET}"; exit 1; }

echo -e "${HEART} PyTorch is ready to rock!\n"

###############################################################################
# 2️⃣  Update main requirements
###############################################################################
echo -e "${BOLD}${CYAN}${ROCKET} Step 2/4 – Updating main environment from requirements.txt…${RESET}"
if [[ -f "requirements.txt" ]]; then
  pip install --upgrade -r requirements.txt \
    && echo -e "${GREEN}${CHECK} Main requirements installed successfully!${RESET}"
else
  echo -e "${YELLOW}${WARNING} No requirements.txt found. Skipping main update.${RESET}"
fi
echo

###############################################################################
# 3️⃣  Process ComfyUI custom nodes
###############################################################################
if [[ -d "$CUSTOM_DIR" ]]; then
  echo -e "${BOLD}${MAGENTA}${SPARKLE} Step 3/4 – Processing custom nodes in '$CUSTOM_DIR'…${RESET}"
  shopt -s nullglob
  for NODE in "$CUSTOM_DIR"/*/ ; do
    [[ -d "$NODE" ]] || continue
    echo -e "\n${BLUE}${ROCKET} Entering ${NODE}${RESET}"

    if [[ -f "${NODE}install.py" ]]; then
      echo -e "${MAGENTA}Running install.py…${RESET}"
      (cd "$NODE" && python install.py) && \
        echo -e "${GREEN}${CHECK} install.py completed for ${NODE}${RESET}"

    elif [[ -f "${NODE}requirements.txt" ]]; then
      echo -e "${CYAN}Installing requirements.txt…${RESET}"
      pip install -r "${NODE}requirements.txt" && \
        echo -e "${GREEN}${CHECK} Requirements installed for ${NODE}${RESET}"
    else
      echo -e "${YELLOW}${WARNING} No install.py or requirements.txt in ${NODE}. Skipping.${RESET}"
    fi
  done
  echo -e "\n${GREEN}${BOLD}${CHECK} All custom nodes processed!${RESET}"
else
  echo -e "${YELLOW}${WARNING} Directory '${CUSTOM_DIR}' not found. Skipping custom nodes step.${RESET}"
fi
echo

###############################################################################
# 4️⃣  Install LTX-Video Q8 kernels
###############################################################################
echo -e "${BOLD}${CYAN}${ROCKET} Step 4/4 – Installing LTXVideo Q8 kernels…${RESET}"
TMP_Q8_DIR="$(mktemp -d)"
REPO_URL="https://github.com/Lightricks/LTX-Video-Q8-Kernels.git"

pip install --upgrade packaging wheel ninja setuptools \
  && echo -e "${GREEN}${CHECK} Build dependencies installed!${RESET}"

echo -e "${MAGENTA}Cloning repo to temporary dir: ${TMP_Q8_DIR}${RESET}"
if git clone --depth 1 "$REPO_URL" "$TMP_Q8_DIR"; then
  echo -e "${BLUE}${ROCKET} Building & installing kernels…${RESET}"
  (cd "$TMP_Q8_DIR" && python setup.py install) \
    && echo -e "${GREEN}${CHECK} LTXVideo Q8 kernels installed successfully!${RESET}"

  echo -e "${MAGENTA}Cleaning up…${RESET}"
  rm -rf "$TMP_Q8_DIR" \
    && echo -e "${GREEN}${CHECK} Temporary directory removed.${RESET}"
else
  echo -e "${RED}${WARNING} Failed to clone LTXVideo Q8 repo. Aborting kernel install.${RESET}"
fi
echo

###############################################################################
# 🎉  Done!
###############################################################################
echo -e "${BOLD}${MAGENTA}${SPARKLE} All set and done! Enjoy coding and may your frames be ever high-def! ${HEART}${RESET}\n"
