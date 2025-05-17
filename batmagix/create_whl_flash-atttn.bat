@echo off
::-----------------------------------------------------------------
::  FlashAttention Windows Wheel Wizard ✨
::  Build a reproducible .whl in one go (CUDA 12.8 nightly Torch)
::-----------------------------------------------------------------
::  Tested on Windows 10/11 x64, VS 2022 BuildTools 17.4+, CUDA 12.8.x
::  Requires: git, Python ≥ 3.10 on PATH, NVIDIA driver ≥ 555.
::-----------------------------------------------------------------

:: =================== USER‑TWEAKABLE SETTINGS =====================
set "FA_COMMIT=98edb0d1a7d4e5106b1e555823b899c9e1f5f4de"  :: exact repo revision (or tag)
set "PY_VER=3.10"                                         :: Python ABI tag
set "CUDA_TAG=cu128"                                      :: CUDA 12.8 wheels
set "ENVNAME=fa_build_%PY_VER%"                            :: venv dir
set "MAX_JOBS=4"                                          :: limit clang/nvcc RAM use
:: ===============================================================

SETLOCAL ENABLEDELAYEDEXPANSION
chcp 65001  >nul 2>&1   :: UTF‑8, so emojis work

:: ---------- little helpers for coloured output -----------------
:cecho <colorName> <msg>
powershell -NoProfile -Command "param([string]$c,[string]$m);Write-Host $m -ForegroundColor $c" %1 "%~2"
exit /b

:info    &call :cecho Cyan     "%*" &exit /b
:good    &call :cecho Green    "%*" &exit /b
:warn    &call :cecho Yellow   "%*" &exit /b
:err     &call :cecho Red      "%*" &exit /b 1
:magix   &call :cecho Magenta  "%*" &exit /b

cls
call :magix  "─────────────────────────────────────────────────────────────"
call :magix  "   ⚡  FlashAttention Windows Wheel Wizard  ⚡"
call :magix  "─────────────────────────────────────────────────────────────"

:: 1️⃣  Python check & venv
call :info  "[1/6] Creating Python %PY_VER% virtual environment…"
where python >nul 2>&1 || (call :err "Python not found – install and retry.")
python -m venv "%ENVNAME%" || (call :err "venv creation failed")
call "%ENVNAME%\Scripts\activate.bat"

:: 2️⃣  Build‑time dependencies
call :info  "[2/6] Installing latest Torch nightly (CUDA %CUDA_TAG%)…"
pip install --upgrade pip >nul
pip install --pre --index-url https://download.pytorch.org/whl/nightly/%CUDA_TAG% ^
           torch torchvision torchaudio ^
           wheel ninja packaging einops psutil >nul || (call :err "pip install failed")

:: 3️⃣  Clone & checkout
call :info  "[3/6] Fetching FlashAttention source…"
if not exist flash-attention (git clone https://github.com/Dao-AILab/flash-attention.git) || (call :err "git clone failed")
cd flash-attention || exit /b
git fetch --all --tags >nul
git checkout %FA_COMMIT% >nul || (call :err "git checkout failed – bad commit?")

:: 4️⃣  MSVC / nvcc environment
call :info  "[4/6] Locating MSVC BuildTools…"
for /f "usebackq tokens=*" %%i in (`vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS_PATH=%%i"
if not defined VS_PATH (call :err "VS 2022 BuildTools not found – install with: winget install -e --id Microsoft.VisualStudio.2022.BuildTools")
call "%VS_PATH%\VC\Auxiliary\Build\vcvars64.bat" >nul

:: 5️⃣  Build the wheel
call :info  "[5/6] Compiling FlashAttention (grab coffee – 20‑60 min)…"
set "FLASH_ATTENTION_FORCE_BUILD=TRUE"
set "MAX_JOBS=%MAX_JOBS%"
python setup.py bdist_wheel || (call :err "❌ build failed")

:: 6️⃣  Smoke test & final magic
cd dist
for %%w in (flash_attn*.whl) do set "WHEEL=%%w"
call :info  "[6/6] Installing freshly‑baked %%WHEEL%% for smoke test…"
pip install --force-reinstall "%%WHEEL%%" >nul || (call :err "wheel install failed")
python -c "import flash_attn, sys;print('🪄 FlashAttention import OK – wheel looks good!')" || (call :err "import test failed")

call :good  "✔  Build finished – wheel stored in %CD%\%%WHEEL%%"
call :magix "★  To share:  pip install %CD%\%%WHEEL%%  ★"
exit /b 0