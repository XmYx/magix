#!/usr/bin/env bash
# ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓
# ┃  ✨  SD-card Rescue eXpress (sdrx.sh) — “Magix” Edition  v2.0   ✨      ┃
# ┃                                                                       ┃
# ┃        Hardened, expanded & sprinkled with additional stardust        ┃
# ┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛

# A cross-platform (macOS & Linux) one-command tool to back-up, repair and
# recover files from flakey SD / micro-SD cards.  Requires root.
#
#  - Read-only cloning (ddrescue ⇢ dd fallback)
#  - Boot-sector / header dump (-H)
#  - Partition-table backup (-B)
#  - Filesystem healing (fsck)
#  - Carving familiars (foremost & scalpel)
#  - Optional TestDisk / PhotoRec session
#  - Colourised output, graceful error trapping

set -Eeuo pipefail
IFS=$'\n\t'

VERSION="2.0-magix"
OS=$(uname)

###############################################################################
#  🎨  Colours & glyphs
###############################################################################
C_RESET="\033[0m"
C_INFO="\033[38;5;33m"    # blue
C_WARN="\033[38;5;214m"   # yellow
C_ERR="\033[38;5;196m"    # red
C_SUCC="\033[38;5;82m"    # green
C_MAGIC="\033[38;5;207m"  # magenta

err()  { printf "%b\n" "${C_ERR}[✘] $*${C_RESET}" >&2; }
info() { printf "%b\n" "${C_INFO}[i] $*${C_RESET}"; }
warn() { printf "%b\n" "${C_WARN}[!] $*${C_RESET}"; }
succ() { printf "%b\n" "${C_SUCC}[✔] $*${C_RESET}"; }
spell(){ printf "%b\n" "${C_MAGIC}✨ $* ✨${C_RESET}"; }

trap 'err "Unexpected failure at ${BASH_SOURCE[0]}:${LINENO} (exit $?)"' ERR
trap 'printf "\n"; warn "Interrupted by user"; exit 130' INT

###############################################################################
#  🧰  Helpers
###############################################################################
need_root(){ (( EUID == 0 )) || { err "Run with sudo or as root"; exit 1; }; }
need_bin(){ command -v "$1" >/dev/null 2>&1 || { warn "Missing $1 – some spells skipped"; return 1; }; }
human_ts(){ date +"%Y-%m-%d_%H-%M-%S"; }

banner(){
  cat <<'EOF'
      . · * ✨ SD-card Rescue eXpress ✨ * · .
           (˜‿˜)  summoning stability...
EOF
}

###############################################################################
#  📇  Device helpers (macOS ↔ Linux)
###############################################################################
list_disks(){
  if [[ $OS == Darwin ]]; then
    diskutil list | sed 's/^/  /'
  else
    lsblk -o NAME,SIZE,FSTYPE,LABEL,MODEL | sed 's/^/  /'
  fi
}

unmount_disk(){
  local d=$1
  if [[ $OS == Darwin ]]; then
    diskutil unmountDisk "/dev/$d" 2>/dev/null || true
  else
    lsblk -ln "/dev/$d" | awk '{print $1}' | xargs -I{} umount -f "/dev/{}" 2>/dev/null || true
  fi
}

mount_disk(){
  local d=$1
  if [[ $OS == Darwin ]]; then
    diskutil mountDisk "/dev/$d"
  else
    mkdir -p /mnt/sdrx_$d && mount "/dev/${d}1" /mnt/sdrx_$d && echo "/mnt/sdrx_$d"
  fi
}

raw_node(){
  local d=$1
  [[ $OS == Darwin ]] && echo "/dev/r$d" || echo "/dev/$d"
}

part_nodes(){
  local d=$1
  if [[ $OS == Darwin ]]; then
    diskutil list "/dev/$d" | awk '/^\s+[0-9]+:/ {print "/dev/"$NF}'
  else
    lsblk -ln "/dev/$d" | awk 'NR>1 {print "/dev/"$1}'
  fi
}

fstype_of(){
  local n=$1
  if [[ $OS == Darwin ]]; then
    diskutil info "$n" | awk -F': +' '/Type \(Bundle\)/{print tolower($2)}'
  else
    lsblk -no FSTYPE "$n" | tr '[:upper:]' '[:lower:]'
  fi
}

###############################################################################
#  🔄  Core rituals
###############################################################################
backup_disk(){
  local disk=$1 outdir=$2
  spell "Conjuring read-only clone..."
  local ts img log dev
  ts=$(human_ts)
  img="$outdir/${disk//\//_}_$ts.img"
  log="$img.log"
  dev=$(raw_node "$disk")

  if need_bin ddrescue; then
    ddrescue -f -n "$dev" "$img" "$log"
    ddrescue -f -d -r3 "$dev" "$img" "$log"
  else
    warn "ddrescue not present – using dd (slow & blunt)"
    dd if="$dev" of="$img" bs=1M conv=sync,noerror status=progress
  fi
  succ "Clone saved at $img"
}

backup_headers(){
  local disk=$1 outdir=$2 count=${3:-2048}
  spell "Capturing first $count sectors..."
  local ts hdr dev
  ts=$(human_ts)
  hdr="$outdir/${disk//\//_}_boot_${ts}.bin"
  dev=$(raw_node "$disk")
  dd if="$dev" of="$hdr" bs=512 count="$count" status=none && succ "Headers dumped to $hdr"
}

backup_parttable(){
  local disk=$1 outdir=$2
  spell "Archiving partition table..."
  local ts pt
  ts=$(human_ts)
  pt="$outdir/${disk//\//_}_parttable_$ts.txt"
  if [[ $OS == Darwin ]]; then
    sudo gpt -r show "/dev/$disk" >"$pt"
  else
    sfdisk -d "/dev/$disk" >"$pt"
  fi
  succ "Partition layout saved to $pt"
}

fsck_partition(){
  local node=$1 fstype=$2
  spell "Healing $node ($fstype) ..."
  case "$fstype" in
    fat*|msdos) need_bin fsck.vfat && fsck.vfat -a "$node" || fsck_msdos -fy "$node" ;;
    exfat) need_bin fsck.exfat && fsck.exfat -y "$node" || fsck_exfat -y "$node" ;;
    hfs|hfs+) fsck_hfs -fy "$node" ;;
    apfs) fsck_apfs -y "$node" ;;
    ext2|ext3|ext4) e2fsck -fy "$node" ;;
    *) warn "Unknown/unsupported FS $fstype – skipping" ;;
  esac
}

run_fsck(){
  local disk=$1
  info "Scanning $disk for partitions..."
  for p in $(part_nodes "$disk"); do
    local fs
    fs=$(fstype_of "$p")
    [[ -z $fs ]] && { warn "$p has no recognised filesystem"; continue; }
    fsck_partition "$p" "$fs"
  done
  succ "All fsck spells complete"
}

carve_files(){
  local disk=$1 outdir=$2 tool=$3
  spell "Carving with $tool (patience grasshopper)..."
  local ts dir dev
  ts=$(human_ts)
  dir="$outdir/carve_${tool}_${ts}"
  mkdir -p "$dir"
  dev=$(raw_node "$disk")
  case "$tool" in
    foremost) foremost -i "$dev" -o "$dir" ;;
    scalpel)  scalpel  "$dev" -o "$dir" ;;
    *) err "Unsupported carving tool $tool"; return 1 ;;
  esac
  succ "Results in $dir"
}

open_testdisk(){ need_bin testdisk && { spell "Summoning TestDisk wizard..."; testdisk $(raw_node "$1"); } }
open_photorec(){ need_bin photorec && { spell "Calling PhotoRec familiars..."; photorec $(raw_node "$1"); } }

###############################################################################
#  📝  Usage
###############################################################################
usage(){
  cat <<EOF
✨ SD-card Rescue eXpress v$VERSION ✨\n
Usage (run as root):  ./sdrx.sh [options]\n
Basic:\n  -o DIR   output directory (default \u2192 ./sdrx_YYYYMMDD)\n  -d NAME  target disk (skip interactive prompt, e.g. sdb or disk2)\n\nSafety clones:\n  -C       clone the disk with ddrescue (default on)\n  -H [N]   dump first N sectors (default 2048)\n  -B       save partition table\n\nRepair & recovery:\n  -F       run filesystem checks (fsck)\n  -t       launch TestDisk after fsck\n  -p       launch PhotoRec after TestDisk (implies -t)\n  -c TOOL  carve with TOOL (foremost|scalpel) after fsck\n\nMisc:\n  -l       list available disks then exit\n  -h       show this help\nEOF
}

###############################################################################
#  🚀  Main
###############################################################################
main(){
  need_root
  banner

  # ── default flags ──────────────────────────────────────────────────────
  local outdir="./sdrx_$(date +%Y%m%d)"
  local disk="" do_clone=true do_fsck=true run_td=false run_pr=false do_headers=false header_count=2048 do_pt=false do_carve=false carve_tool="foremost"

  local opt
  while getopts "o:d:CH::BFtpc:lh" opt; do
    case $opt in
      o) outdir=$OPTARG ;;
      d) disk=$OPTARG ;;
      C) do_clone=true ;;
      H) do_headers=true; [[ -n $OPTARG ]] && header_count=$OPTARG ;;
      B) do_pt=true ;;
      F) do_fsck=true ;;
      t) run_td=true ;;
      p) run_td=true; run_pr=true ;;
      c) do_carve=true; carve_tool=$OPTARG ;;
      l) list_disks; exit 0 ;;
      h) usage; exit 0 ;;
      *) usage; exit 1 ;;
    esac
  done
  shift $((OPTIND-1))

  mkdir -p "$outdir"

  if [[ -z $disk ]]; then
    info "Connected disks:"; list_disks; printf "\n"
    read -rp "✨ Which disk shall we enchant? (e.g. sdb / disk2): " disk
  fi

  [[ -z $disk || ! -e "/dev/${disk}" ]] && { err "No such disk /dev/${disk}"; exit 1; }

  unmount_disk "$disk"

  $do_clone   && backup_disk      "$disk" "$outdir"
  $do_headers && backup_headers   "$disk" "$outdir" "$header_count"
  $do_pt      && backup_parttable "$disk" "$outdir"
  $do_fsck    && run_fsck         "$disk"
  $run_td     && open_testdisk    "$disk"
  $run_pr     && open_photorec    "$disk"
  $do_carve   && carve_files      "$disk" "$outdir" "$carve_tool"

  if read -rp "🌟 Attempt to mount the disk now? [y/N]: " ans && [[ $ans =~ ^[Yy] ]]; then
    mount_disk "$disk" || warn "Mount attempt failed."
  fi

  spell "All done! Review the artefacts in $outdir and reformat the card once safe."
}

main "$@"