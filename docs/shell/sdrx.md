# ✨ SD‑card Rescue eXpress (`sdrx.sh`) — **Magix Edition**

> Hardened, expanded & sprinkled with stardust. A single‑command toolkit to **clone, heal & recover** data from glitchy SD / micro‑SD cards on macOS **and** Linux.

[![Version](https://img.shields.io/badge/version-2.0--magix-magenta?style=flat-square)]()
[![License](https://img.shields.io/github/license/yourname/sdrx.svg?style=flat-square)]()

---

<div align="center">
  <pre><code>  . · * ✨  SD‑card Rescue eXpress ✨ * · .
          (˜‿˜)  summoning stability…
  </code></pre>
</div>

---

## 📜 Table of Contents

1. [Why sdrx?](#why-sdrx)
2. [Features](#features)
3. [Requirements](#requirements)
4. [Installation](#installation)
5. [Usage](#usage)

   * [Quick start](#quick-start)
   * [Options](#options)
   * [Example recipes](#example-recipes)
6. [Recovery Cheat Sheet](#recovery-cheat-sheet)
7. [FAQ](#faq)
8. [Safety Notes](#safety-notes)
9. [Contributing](#contributing)
10. [Changelog](#changelog)
11. [License](#license)

---

## Why *sdrx*?

*SD‑card Rescue eXpress* grew out of late‑night troubleshooting sessions with half‑fried Raspberry Pi cards and camera media. Copy‑pasting `dd` commands or juggling TestDisk options gets old fast—so we wrapped the best‑practice incantations into *one* colourful script. 🪄

---

## ✨ Features

| Category                | Spell                    | Details                                                           |
| ----------------------- | ------------------------ | ----------------------------------------------------------------- |
| **Clone**               | `-C` *(default)*         | Read‑only, resumable clone with **ddrescue** (fallback to `dd`)   |
| **Boot‑sector dump**    | `-H [N]`                 | Save first *N* sectors (default 2048) for forensic work           |
| **Partition backup**    | `-B`                     | Copy GPT / MBR layout to text file                                |
| **Filesystem heal**     | `-F`                     | Auto‑detect FS & run the right `fsck` (FAT/exFAT/HFS/APFS/ext2‑4) |
| **Carve files**         | `-c foremost \| scalpel` | Deep‑scan raw image & recover lost files                          |
| **TestDisk / PhotoRec** | `-t` / `-p`              | Drop straight into interactive wizards after healing              |
| **Cross‑platform**      | macOS & Linux            | Smart device listing, (un)mount helpers                           |
| **Safety first**        | read‑only access         | Auto‑unmount before touch, traps & coloured logs                  |

---

## 🛠 Requirements

| Platform  | Core utils                                             | Extras (optional but recommended)        |
| --------- | ------------------------------------------------------ | ---------------------------------------- |
| **macOS** | `brew install gnu-ddrescue e2fsprogs exfat-utils`      | `brew install testdisk foremost scalpel` |
| **Linux** | `apt install gddrescue testdisk exfat-utils e2fsprogs` | `apt install foremost scalpel`           |

> ☝️  *ddrescue* is strongly recommended. Without it `sdrx` falls back to `dd` (slower, no resume).

---

## 🚀 Installation

```bash
# 1. Download
curl -LO https://raw.githubusercontent.com/yourname/sdrx/main/sdrx.sh

# 2. Make it executable & put it in $PATH
chmod +x sdrx.sh
sudo mv sdrx.sh /usr/local/bin/sdrx
```

---

## 🧙‍♀️ Usage

### Quick start

```bash
# Clone + heal + open TestDisk, saving artefacts to ~/rescue
sudo sdrx -d sdb -o ~/rescue -HB -F -t
```

> **Flow:** *clone → header dump → partition‑table backup → fsck → TestDisk*  🎉

### Options

| Flag | Argument | Description                                      |
| ---- | -------- | ------------------------------------------------ |
| `-o` | `DIR`    | Output directory (default: `./sdrx_YYYYMMDD`)    |
| `-d` | `NAME`   | Target disk *(skip prompt)*, e.g. `sdb`, `disk2` |
| `-C` | —        | Clone with ddrescue (on by default)              |
| `-H` | `[N]`    | Dump first *N* sectors (*2048*)                  |
| `-B` | —        | Backup partition table                           |
| `-F` | —        | Run filesystem checks                            |
| `-t` | —        | Launch **TestDisk** after fsck                   |
| `-p` | —        | Launch **PhotoRec** (implies `-t`)               |
| `-c` | `TOOL`   | Carve with `foremost` or `scalpel`               |
| `-l` | —        | List available disks then exit                   |
| `-h` | —        | Show help & exit                                 |

### Example recipes

```bash
# 1. Full forensic pull + carve with scalpel
sudo sdrx -d sdc -o ~/cases/card42 -CHB -F -c scalpel

# 2. Just clone (no healing) for lab analysis
sudo sdrx -d disk3 -o ~/clones -- -C -F=false

# 3. Repair a camera card in a hurry (interactive)
sudo sdrx           # prompts for disk, uses defaults
```

---

## 🔮 Recovery Cheat Sheet

| Symptom                                          | Suggested incantation                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------- |
| Card mounts but shows “0 bytes free/used”        | `sdrx -F -t` → run TestDisk “Advanced” & rebuild FAT                  |
| Card refuses to mount, dmesg reports *I/O error* | `sdrx -HB -F -c foremost` and inspect `carve_*` folder                |
| Accidentally `rm -rf` photos                     | Skip fsck (`-F=false`), run `-c scalpel` to avoid metadata overwrite  |
| Need to recover files *and* preserve evidence    | Clone only (`-C`), **work on the image** with `testdisk` or `autopsy` |

---

## ❓ FAQ

<details>
<summary>Does sdrx work on Windows?</summary>

Not natively. Use it inside WSL2 or a Linux VM, or try the [WinDdRescue GUI](https://example.com) instead.

</details>

<details>
<summary>Why does the script need <code>sudo</code>?</summary>

Raw block devices (`/dev/sdX`, `/dev/rdiskX`) are root‑only. The script remounts & heals filesystems, which also requires elevated privileges.

</details>

<details>
<summary>Can I point sdrx at an <code>.img</code> file instead of a physical disk?</summary>

Not yet—but it’s on the roadmap. For now, work directly with tools like `testdisk image.img`.

</details>

---

## ⚠️ Safety Notes

* **Read‑only first.** The script uses read‑only clones & `fsck` before any write‑attempts.
* **Work on images.** Always recover files from the cloned image, *not* the live card.
* **Back up your backup!** Store the cloned `.img` on a separate drive.
* **No warranty.** Data‑rescue is risky; double‑check device paths (`/dev/sdX`) before pressing ⏎.

---

## 🤝 Contributing

Pull requests are welcome! Feel free to open issues for feature ideas—extra carving tools, better progress bars, packaging, ✨whatever.

---

## 📜 Changelog

| Version       | Date       | Highlights                                                        |
| ------------- | ---------- | ----------------------------------------------------------------- |
| **2.0‑magix** | 2025‑05‑26 | Linux support, header/partition backups, carving, colourised logs |
| **1.1‑magix** | 2024‑10‑12 | Initial public release                                            |

---

## 🪄 License

Released under the **MIT License**—see [`LICENSE`](LICENSE) for details. May the bytes be ever in your favour! ✨
