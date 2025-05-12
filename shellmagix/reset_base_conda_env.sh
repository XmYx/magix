#!/usr/bin/env bash
# reset_conda_env.sh — Rewind any Conda env to a previous revision with ✨ Magix ✨
# ──────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./reset_conda_env.sh                        # interactively pick env & revision
#   ./reset_conda_env.sh -e myenv               # pick env only, choose revision interactively
#   ./reset_conda_env.sh -e myenv -r 3          # target env & revision, ask confirmation
#   ./reset_conda_env.sh -e myenv -r 5 -f       # same, no confirmation
#   ./reset_conda_env.sh -r 2 -f                # base env implicit, force-reset to rev 2
# -----------------------------------------------------------------------------

set -euo pipefail

# ─── Colours & emoji ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

SPARKLE="✨"
CHECK="✅"
WARNING="⚠️"
REWIND="⏪"
BOOK="📜"
ROCKET="🚀"

# ─── CLI flags (getopts) ──────────────────────────────────────────────────────
FORCE=0
ENV_NAME=""      # empty → prompt later
REVISION=""     # empty → prompt later

usage() {
  echo "Usage: $0 [-e env] [-r revision] [-f]"
  exit 1
}

while getopts ":fe:r:" opt; do
  case $opt in
    f) FORCE=1 ;;
    e) ENV_NAME="$OPTARG" ;;
    r) REVISION="$OPTARG" ;;
    *) usage ;;
  esac
done

# ─── Conda presence check ─────────────────────────────────────────────────────
if ! command -v conda &> /dev/null; then
  echo -e "${RED}${WARNING}  ‘conda’ is not on your PATH.${RESET}"
  echo -e "    Install / initialise Conda, then channel your inner wizard again.\n"
  exit 1
fi

# ─── Bring Conda into the current shell ───────────────────────────────────────
# shellcheck disable=SC1091
eval "$(conda shell.bash hook)"

# ─── Discover available environments ─────────────────────────────────────────
mapfile -t ENVS < <(conda env list | awk '/^#|^\s*$/{next}{print $1}' | sed 's/\*$//')

# Validate provided env, or prompt for one
if [[ -n "$ENV_NAME" ]]; then
  if [[ ! " ${ENVS[*]} " =~ " ${ENV_NAME} " ]]; then
    echo -e "${RED}${WARNING}  Environment ‘${ENV_NAME}’ not found.${RESET}"
    exit 1
  fi
else
  echo -e "${CYAN}${BOOK}  Available Conda environments:${RESET}"
  for i in "${!ENVS[@]}"; do
    printf "  [%d] %s\n" "$i" "${ENVS[$i]}"
  done
  echo
  read -rp "🔎  Which environment would you like to rewind? [0] " idx
  idx="${idx:-0}"
  if ! [[ "$idx" =~ ^[0-9]+$ ]] || (( idx < 0 || idx >= ${#ENVS[@]} )); then
    echo -e "${RED}${WARNING}  Invalid selection.${RESET}"
    exit 1
  fi
  ENV_NAME="${ENVS[$idx]}"
fi

# ─── Welcome banner ───────────────────────────────────────────────────────────
echo -e "\n${BOLD}${MAGENTA}${SPARKLE}  Magix Time-Turner engaged!${RESET}"
echo -e "  We’re about to rewind your ${BOLD}${ENV_NAME}${RESET} env to a previous timeline.\n"

# ─── Show revision ledger ─────────────────────────────────────────────────────
conda list -n "$ENV_NAME" --revisions | sed '1i Revision ledger for “'"$ENV_NAME"'”:'

# ─── Ask for revision if not provided ─────────────────────────────────────────
if [[ -z "$REVISION" ]]; then
  echo
  read -rp "🔎  Which revision should we roll back to? [0] " input_rev
  REVISION="${input_rev:-0}"
fi

# Basic validation: must be a non-negative integer
if ! [[ "$REVISION" =~ ^[0-9]+$ ]]; then
  echo -e "${RED}${WARNING}  Revision must be a non-negative integer.${RESET}"
  exit 1
fi

# ─── Confirmation prompt (unless forced) ──────────────────────────────────────
if [[ $FORCE -eq 0 ]]; then
  echo
  read -rp "${YELLOW}${WARNING}  Roll back ‘${ENV_NAME}’ to revision ${REVISION}?${RESET} [y/N] " yn
  case "$yn" in [Yy]*) ;; *)
     echo -e "${BLUE}No worries — timeline preserved. Bye!${RESET}"
     exit 0
  esac
fi

# ─── Rewind action ────────────────────────────────────────────────────────────
echo -e "\n${MAGENTA}${REWIND}  Reverting ‘${ENV_NAME}’ to revision ${REVISION}…${RESET}"
conda install -n "$ENV_NAME" --revision "$REVISION" -y

echo -e "\n${GREEN}${CHECK}  Done! Your ‘${ENV_NAME}’ environment now reflects revision ${REVISION}.${RESET}"
echo -e "${BOLD}${CYAN}${ROCKET}  Blast off to your next adventure!${RESET}\n"