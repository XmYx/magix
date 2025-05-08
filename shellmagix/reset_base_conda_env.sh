#!/usr/bin/env bash
# reset_conda_base.sh — Rewind your Conda “base” env to any revision with ✨ Magix ✨
# ──────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./reset_conda_base.sh                # interactively choose a revision
#   ./reset_conda_base.sh -r 3           # target revision 3, ask for confirmation
#   ./reset_conda_base.sh -r 5 -f        # target revision 5, no confirmation
#   ./reset_conda_base.sh -f             # force-reset to revision 0
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
REVISION=""        # empty → prompt later

usage() {
  echo "Usage: $0 [-r revision] [-f]"
  exit 1
}

while getopts ":fr:" opt; do
  case $opt in
    f) FORCE=1 ;;
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

# ─── Welcome banner ───────────────────────────────────────────────────────────
echo -e "\n${BOLD}${MAGENTA}${SPARKLE}  Magix Time-Turner engaged!${RESET}"
echo -e "  We’re about to rewind your ${BOLD}base${RESET} env to a previous timeline.\n"

# ─── Activate base & show revision ledger ─────────────────────────────────────
conda activate base
echo -e "${CYAN}${BOOK}  Revision ledger for ‘base’:${RESET}"
conda list --revisions

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
  read -rp "${YELLOW}${WARNING}  Roll back ‘base’ to revision ${REVISION}?${RESET} [y/N] " yn
  case "$yn" in [Yy]*) ;; *)
     echo -e "${BLUE}No worries — timeline preserved. Bye!${RESET}"
     exit 0
  esac
fi

# ─── Rewind action ────────────────────────────────────────────────────────────
echo -e "\n${MAGENTA}${REWIND}  Reverting ‘base’ to revision ${REVISION}…${RESET}"
conda install --revision "$REVISION" -y

echo -e "\n${GREEN}${CHECK}  Done! Your ‘base’ environment now reflects revision ${REVISION}.${RESET}"
echo -e "${BOLD}${CYAN}${ROCKET}  Blast off to your next adventure!${RESET}\n"
