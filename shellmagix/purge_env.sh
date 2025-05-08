#!/usr/bin/env bash
# purge_env_packages.sh — Strip your current Python env down to bare essentials, with a swirl of ✨ Magix ✨
# ───────────────────────────────────────────────────────────────────────────────
# Removes **all** pip-installed packages *except* a small, configurable “core”
# set (pip, setuptools, wheel by default).
#
# Usage:
#   ./purge_env_packages.sh           # interactive confirmation
#   ./purge_env_packages.sh -f        # no questions asked
#   CORE_KEEP="pip setuptools wheel numpy" ./purge_env_packages.sh   # custom core
# -----------------------------------------------------------------------------

set -euo pipefail

# ─── Colours & emoji ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
MAGENTA='\033[0;35m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
SPARKLE="✨"; WARNING="⚠️"; BROOM="🧹"; CHECK="✅"

# ─── CLI flags ────────────────────────────────────────────────────────────────
FORCE=0
while getopts ":f" opt; do
  case $opt in
    f) FORCE=1 ;;
    *) echo "Usage: $0 [-f]"; exit 1 ;;
  esac
done

# ─── Determine the core packages to keep ──────────────────────────────────────
# Default core list; override by exporting CORE_KEEP env-var.
read -ra CORE <<< "${CORE_KEEP:-pip setuptools wheel}"
declare -A CORE_MAP=()
for pkg in "${CORE[@]}"; do CORE_MAP["$pkg"]=1; done

# ─── Gather installed packages ────────────────────────────────────────────────
mapfile -t ALL_PKGS < <(python -m pip list --disable-pip-version-check --format=freeze | cut -d '=' -f1)
TO_REMOVE=()
for pkg in "${ALL_PKGS[@]}"; do
  [[ -n "${CORE_MAP[$pkg]:-}" ]] && continue
  TO_REMOVE+=("$pkg")
done

# ─── Banner ───────────────────────────────────────────────────────────────────
echo -e "\n${BOLD}${MAGENTA}${SPARKLE}  Magix Clean-Sweep Initialised${RESET}"
echo -e "  Current environment: ${CYAN}$(python -c 'import sys, os; print(os.environ.get(\"CONDA_DEFAULT_ENV\") or \"venv / system\", end=\"\")')${RESET}\n"

# ─── Nothing to do? ───────────────────────────────────────────────────────────
if [[ ${#TO_REMOVE[@]} -eq 0 ]]; then
  echo -e "${GREEN}${CHECK}  Nothing to uninstall — environment already zen-minimal.${RESET}\n"
  exit 0
fi

# ─── Show & confirm ───────────────────────────────────────────────────────────
echo -e "${CYAN}${BROOM}  Packages queued for removal (${#TO_REMOVE[@]}):${RESET}"
printf '   • %s\n' "${TO_REMOVE[@]}"
echo

if [[ $FORCE -eq 0 ]]; then
  read -rp "${YELLOW}${WARNING}  Proceed with uninstall?${RESET} [y/N] " yn
  case "$yn" in [Yy]*) ;; *)
    echo -e "${MAGENTA}Aborted. No spells cast today.${RESET}"; exit 0 ;;
  esac
fi

# ─── Uninstall in one swoop ───────────────────────────────────────────────────
echo -e "\n${MAGENTA}${BROOM}  Sweeping…${RESET}"
python -m pip uninstall -y "${TO_REMOVE[@]}"

echo -e "\n${GREEN}${CHECK}  All done! Your environment is sparkly-clean.${RESET}"
echo -e "${CYAN}${SPARKLE}  Stay light, ship fast, breathe easy.${RESET}\n"
