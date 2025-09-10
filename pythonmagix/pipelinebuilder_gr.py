"""
Gradio Modular Pipeline Builder Engine

Deployable on Hugging Face Spaces.

Key features
- Modular pipeline registry with unified main input types: image, video, text.
- Each pipeline can declare arbitrary parameters (ints/floats/text/choice/bool) and extra media inputs (image/video) beyond the main input.
- Reveal middle steps for any pipeline run.
- Import/export full pipeline runs as a single .zip (JSON manifest + inputs/outputs/steps/media files).
- Easily extendable: add new pipelines by subclassing BasePipeline and registering.

Requirements (add this to requirements.txt on HF Spaces):
    gradio>=4.41.0
    pillow
    imageio

Optional but recommended on HF Spaces:
    ffmpeg (provided by the runtime) for robust video read/write via imageio/ffmpeg

Run locally:
    uvicorn not required; simply: `python app.py`
    Or `gradio app.py` if using CLI. On HF Spaces, the `demo` variable is auto-discovered.
"""

from __future__ import annotations
import os
import io
import json
import shutil
import time
import zipfile
import tempfile
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import gradio as gr
from PIL import Image, ImageOps, ImageDraw, ImageFont
import imageio

# -----------------------------
# Utility helpers
# -----------------------------

def _safe_name(name: str) -> str:
    keep = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    return "".join(c if c in keep else "_" for c in name) or "file"


def _ensure_dir(path: str):
    os.makedirs(path, exist_ok=True)


def pil_to_bytes(img: Image.Image, format: str = "PNG") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format=format)
    return buf.getvalue()


def save_image(img: Image.Image, path: str):
    _ensure_dir(os.path.dirname(path))
    img.save(path)


def save_bytes(data: bytes, path: str):
    _ensure_dir(os.path.dirname(path))
    with open(path, "wb") as f:
        f.write(data)


def read_video_frames(path: str, max_frames: int = 32) -> List[Image.Image]:
    frames = []
    try:
        reader = imageio.get_reader(path)
        for i, frame in enumerate(reader):
            if i >= max_frames:
                break
            frames.append(Image.fromarray(frame))
        reader.close()
    except Exception as e:
        print(f"Video read error: {e}")
    return frames


def write_gif_from_frames(frames: List[Image.Image], out_path: str, fps: int = 8):
    _ensure_dir(os.path.dirname(out_path))
    if not frames:
        raise ValueError("No frames to write.")
    duration = 1.0 / max(1, fps)
    frames[0].save(
        out_path,
        save_all=True,
        append_images=frames[1:],
        loop=0,
        duration=int(duration * 1000),
        optimize=False,
        format="GIF",
    )

# -----------------------------
# Pipeline base + registry
# -----------------------------

@dataclass
class ParamSpec:
    name: str
    ptype: str  # 'int','float','text','bool','choice','image','video'
    default: Any = None
    choices: Optional[List[Any]] = None
    help: str = ""
    multiple: bool = False  # for image/video extra inputs


@dataclass
class BasePipeline:
    name: str
    main_input_type: str  # 'image' | 'video' | 'text'
    main_output_type: str  # 'image' | 'video' | 'text'
    params: List[ParamSpec] = field(default_factory=list)

    def run(self, main_input: Any, **params) -> Tuple[Any, List[Dict[str, Any]]]:
        """Return (output, steps). Steps is a list of dicts, each may include:
        {
            'label': str,
            'image': PIL.Image.Image (optional),
            'images': List[PIL.Image.Image] (optional),
            'text': str (optional),
            'video_path': str (optional)
        }
        """
        raise NotImplementedError


REGISTRY: Dict[str, BasePipeline] = {}

def register(pipe: BasePipeline):
    REGISTRY[pipe.name] = pipe

# -----------------------------
# Example pipelines (replace/extend with your own)
# -----------------------------

class ImageGrayscale(BasePipeline):
    def __init__(self):
        super().__init__(
            name="Image → Grayscale",
            main_input_type="image",
            main_output_type="image",
            params=[
                ParamSpec("invert", "bool", default=False, help="Invert grayscale result"),
            ],
        )

    def run(self, main_input: Image.Image, **params):
        invert = params.get("invert", False)
        steps = []
        steps.append({"label": "Original", "image": main_input})
        gray = ImageOps.grayscale(main_input)
        steps.append({"label": "Grayscale", "image": gray})
        if invert:
            gray = ImageOps.invert(gray)
            steps.append({"label": "Inverted", "image": gray})
        return gray, steps


class TextReverse(BasePipeline):
    def __init__(self):
        super().__init__(
            name="Text ↔ Reverse",
            main_input_type="text",
            main_output_type="text",
            params=[ParamSpec("uppercase", "bool", default=False, help="Uppercase final output")],
        )

    def run(self, main_input: str, **params):
        uppercase = params.get("uppercase", False)
        steps = [{"label": "Input", "text": main_input}]
        rev = main_input[::-1]
        steps.append({"label": "Reversed", "text": rev})
        if uppercase:
            rev = rev.upper()
            steps.append({"label": "Uppercased", "text": rev})
        return rev, steps


class ImageBlend(BasePipeline):
    def __init__(self):
        super().__init__(
            name="Image + Image → Blend",
            main_input_type="image",
            main_output_type="image",
            params=[
                ParamSpec("overlay", "image", multiple=False, help="Second image to blend"),
                ParamSpec("alpha", "float", default=0.5, help="Blend factor 0..1"),
            ],
        )

    def run(self, main_input: Image.Image, **params):
        overlay: Image.Image = params.get("overlay")
        alpha: float = float(params.get("alpha", 0.5))
        if overlay is None:
            raise gr.Error("Please provide an overlay image.")
        w, h = main_input.size
        overlay = overlay.resize((w, h))
        steps = [
            {"label": "Base", "image": main_input},
            {"label": "Overlay (resized)", "image": overlay},
        ]
        out = Image.blend(main_input.convert("RGBA"), overlay.convert("RGBA"), alpha)
        steps.append({"label": f"Blended α={alpha}", "image": out})
        return out, steps


class VideoToGIF(BasePipeline):
    def __init__(self):
        super().__init__(
            name="Video → GIF",
            main_input_type="video",
            main_output_type="video",
            params=[
                ParamSpec("max_frames", "int", default=48, help="Max frames to read"),
                ParamSpec("fps", "int", default=8, help="GIF FPS"),
            ],
        )

    def run(self, main_input: str, **params):
        # main_input is a video file path (from gr.Video)
        max_frames = int(params.get("max_frames", 48))
        fps = int(params.get("fps", 8))
        frames = read_video_frames(main_input, max_frames=max_frames)
        steps = []
        thumb_steps = []
        for i, f in enumerate(frames[:min(12, len(frames))]):
            thumb_steps.append({"label": f"Frame {i}", "image": f})
        if thumb_steps:
            steps.extend(thumb_steps)
        temp_dir = tempfile.mkdtemp(prefix="pipeline_")
        out_path = os.path.join(temp_dir, "out.gif")
        write_gif_from_frames(frames, out_path, fps=fps)
        steps.append({"label": "GIF created", "text": f"Frames: {len(frames)}, FPS: {fps}"})
        return out_path, steps


class TextOnImage(BasePipeline):
    def __init__(self):
        super().__init__(
            name="Image + Text → Poster",
            main_input_type="image",
            main_output_type="image",
            params=[
                ParamSpec("caption", "text", default="Hello", help="Text to overlay"),
                ParamSpec("font_size", "int", default=42, help="Font size"),
            ],
        )

    def run(self, main_input: Image.Image, **params):
        caption = str(params.get("caption", "Hello"))
        font_size = int(params.get("font_size", 42))
        img = main_input.convert("RGBA").copy()
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()
        w, h = img.size
        bbox = draw.textbbox((0, 0), caption, font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        x, y = (w - tw) // 2, h - th - 20
        draw.rectangle([x - 10, y - 10, x + tw + 10, y + th + 10], fill=(0, 0, 0, 160))
        draw.text((x, y), caption, font=font, fill=(255, 255, 255, 255))
        steps = [{"label": "Captioned", "image": img}]
        return img, steps


# Register example pipelines
register(ImageGrayscale())
register(TextReverse())
register(ImageBlend())
register(VideoToGIF())
register(TextOnImage())

# -----------------------------
# Dynamic UI builders
# -----------------------------

def build_param_component(spec: ParamSpec):
    label = spec.name
    info = spec.help or None
    if spec.ptype == "int":
        return gr.Number(label=label, value=spec.default, precision=0, interactive=True, info=info)
    if spec.ptype == "float":
        return gr.Number(label=label, value=spec.default, interactive=True, info=info)
    if spec.ptype == "text":
        return gr.Textbox(label=label, value=spec.default or "", lines=2, interactive=True, info=info)
    if spec.ptype == "bool":
        return gr.Checkbox(label=label, value=bool(spec.default), interactive=True, info=info)
    if spec.ptype == "choice":
        return gr.Dropdown(label=label, choices=spec.choices or [], value=spec.default, interactive=True, info=info)
    if spec.ptype == "image":
        if spec.multiple:
            return gr.File(label=label + " (images)", file_count="multiple", file_types=["image"], interactive=True)
        return gr.Image(label=label, type="pil", interactive=True)
    if spec.ptype == "video":
        if spec.multiple:
            return gr.File(label=label + " (videos)", file_count="multiple", file_types=["video"], interactive=True)
        return gr.Video(label=label, interactive=True)
    raise ValueError(f"Unknown ptype {spec.ptype}")


def collect_param_values(param_specs: List[ParamSpec], components: List[Any]) -> Dict[str, Any]:
    values = {}
    for spec, comp in zip(param_specs, components):
        values[spec.name] = comp
    return values

# -----------------------------
# Export / Import helpers
# -----------------------------

MANIFEST_NAME = "manifest.json"


def export_run_zip(pipeline_name: str, main_type: str, main_input: Any, params: Dict[str, Any], output: Any, steps: List[Dict[str, Any]]) -> str:
    tmp_root = tempfile.mkdtemp(prefix="export_")
    media_dir = os.path.join(tmp_root, "media")
    steps_dir = os.path.join(tmp_root, "steps")
    _ensure_dir(media_dir)
    _ensure_dir(steps_dir)

    manifest: Dict[str, Any] = {
        "pipeline": pipeline_name,
        "main_input_type": main_type,
        "params": {},
        "files": {
            "main_input": None,
            "output": None,
            "steps": [],
        },
    }

    # Save main input
    if main_type == "image" and isinstance(main_input, Image.Image):
        in_name = f"input_{_safe_name(pipeline_name)}.png"
        in_path = os.path.join(media_dir, in_name)
        save_image(main_input, in_path)
        manifest["files"]["main_input"] = os.path.relpath(in_path, tmp_root)
    elif main_type == "video" and isinstance(main_input, str):
        in_name = os.path.basename(main_input)
        in_path = os.path.join(media_dir, in_name)
        try:
            shutil.copy2(main_input, in_path)
        except Exception:
            # fallback: read bytes
            save_bytes(open(main_input, "rb").read(), in_path)
        manifest["files"]["main_input"] = os.path.relpath(in_path, tmp_root)
    elif main_type == "text":
        in_name = f"input_{_safe_name(pipeline_name)}.txt"
        in_path = os.path.join(media_dir, in_name)
        with open(in_path, "w", encoding="utf-8") as f:
            f.write(str(main_input))
        manifest["files"]["main_input"] = os.path.relpath(in_path, tmp_root)

    # Save params (including extra media)
    params_serialized: Dict[str, Any] = {}
    for key, val in params.items():
        if isinstance(val, Image.Image):
            fname = f"param_{_safe_name(key)}.png"
            fpath = os.path.join(media_dir, fname)
            save_image(val, fpath)
            params_serialized[key] = {"file": os.path.relpath(fpath, tmp_root)}
        elif isinstance(val, (int, float, str, bool)) or val is None:
            params_serialized[key] = val
        elif isinstance(val, list):
            saved_list = []
            for i, v in enumerate(val):
                if hasattr(v, "read"):
                    # gr.File returns objects with .name/.read sometimes; persist bytes
                    data = v.read()
                    fname = f"param_{_safe_name(key)}_{i}"
                    ext = ".bin"
                    try:
                        ext = os.path.splitext(v.name)[1] or ext
                    except Exception:
                        pass
                    fpath = os.path.join(media_dir, fname + ext)
                    save_bytes(data, fpath)
                    saved_list.append({"file": os.path.relpath(fpath, tmp_root)})
                else:
                    saved_list.append(v)
            params_serialized[key] = saved_list
        elif hasattr(val, "name"):
            # File-like from gradio
            data = val.read()
            ext = os.path.splitext(getattr(val, "name", "param.bin"))[1] or ".bin"
            fpath = os.path.join(media_dir, f"param_{_safe_name(key)}{ext}")
            save_bytes(data, fpath)
            params_serialized[key] = {"file": os.path.relpath(fpath, tmp_root)}
        else:
            # unknown type: try json
            try:
                json.dumps(val)
                params_serialized[key] = val
            except Exception:
                params_serialized[key] = str(val)
    manifest["params"] = params_serialized

    # Save output
    out_rel = None
    if isinstance(output, Image.Image):
        out_path = os.path.join(media_dir, "output.png")
        save_image(output, out_path)
        out_rel = os.path.relpath(out_path, tmp_root)
    elif isinstance(output, str) and os.path.exists(output):
        out_name = os.path.basename(output)
        out_path = os.path.join(media_dir, out_name)
        try:
            shutil.copy2(output, out_path)
        except Exception:
            save_bytes(open(output, "rb").read(), out_path)
        out_rel = os.path.relpath(out_path, tmp_root)
    elif isinstance(output, (int, float, str, bool)):
        out_path = os.path.join(media_dir, "output.txt")
        with open(out_path, "w", encoding="utf-8") as f:
            f.write(str(output))
        out_rel = os.path.relpath(out_path, tmp_root)
    manifest["files"]["output"] = out_rel

    # Save steps
    for si, s in enumerate(steps):
        rec = {"label": s.get("label")}
        if s.get("image") is not None:
            sp = os.path.join(steps_dir, f"step_{si:03d}.png")
            save_image(s["image"], sp)
            rec["image"] = os.path.relpath(sp, tmp_root)
        if s.get("images"):
            imgs_rel = []
            for ii, im in enumerate(s["images"]):
                sp = os.path.join(steps_dir, f"step_{si:03d}_{ii:02d}.png")
                save_image(im, sp)
                imgs_rel.append(os.path.relpath(sp, tmp_root))
            rec["images"] = imgs_rel
        if s.get("text") is not None:
            rec["text"] = s["text"]
        if s.get("video_path") is not None:
            v_src = s["video_path"]
            v_dst = os.path.join(steps_dir, os.path.basename(v_src))
            try:
                shutil.copy2(v_src, v_dst)
            except Exception:
                save_bytes(open(v_src, "rb").read(), v_dst)
            rec["video_path"] = os.path.relpath(v_dst, tmp_root)
        manifest["files"]["steps"].append(rec)

    # Write manifest
    with open(os.path.join(tmp_root, MANIFEST_NAME), "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    # Zip all
    zip_path = os.path.join(tempfile.gettempdir(), f"pipeline_run_{int(time.time())}.zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for root, dirs, files in os.walk(tmp_root):
            for file in files:
                abspath = os.path.join(root, file)
                arcname = os.path.relpath(abspath, tmp_root)
                z.write(abspath, arcname)
    shutil.rmtree(tmp_root, ignore_errors=True)
    return zip_path


def import_run_zip(zip_file: str) -> Tuple[str, Dict[str, Any], Dict[str, Any], str, List[str]]:
    """Return (pipeline_name, params_dict, main_input_payload, main_input_type, media_paths)
    main_input_payload is suitable for setting gradio inputs: Image.Image for image, str for video path, str for text.
    media_paths is a list of extracted file paths we should clean up when session ends.
    """
    work_dir = tempfile.mkdtemp(prefix="import_")
    with zipfile.ZipFile(zip_file, "r") as z:
        z.extractall(work_dir)
    mani_path = os.path.join(work_dir, MANIFEST_NAME)
    manifest = json.load(open(mani_path, "r", encoding="utf-8"))

    pipeline_name = manifest["pipeline"]
    main_type = manifest["main_input_type"]

    # load main input
    mi_rel = manifest["files"].get("main_input")
    main_payload: Any = None
    if mi_rel:
        mi_abs = os.path.join(work_dir, mi_rel)
        if main_type == "image":
            main_payload = Image.open(mi_abs).convert("RGBA")
        elif main_type == "video":
            main_payload = mi_abs  # path for gr.Video
        else:
            main_payload = open(mi_abs, "r", encoding="utf-8").read()

    # load params
    params = {}
    for k, v in manifest.get("params", {}).items():
        if isinstance(v, dict) and "file" in v:
            f_abs = os.path.join(work_dir, v["file"])
            ext = os.path.splitext(f_abs)[1].lower()
            if ext in [".png", ".jpg", ".jpeg", ".bmp", ".gif"]:
                try:
                    params[k] = Image.open(f_abs).convert("RGBA")
                except Exception:
                    params[k] = f_abs
            else:
                params[k] = f_abs
        elif isinstance(v, list):
            out_list = []
            for item in v:
                if isinstance(item, dict) and "file" in item:
                    out_list.append(os.path.join(work_dir, item["file"]))
                else:
                    out_list.append(item)
            params[k] = out_list
        else:
            params[k] = v

    # For cleanup
    to_cleanup = []
    for root, dirs, files in os.walk(work_dir):
        for f in files:
            to_cleanup.append(os.path.join(root, f))

    return pipeline_name, params, main_payload, main_type, to_cleanup

# -----------------------------
# Gradio App
# -----------------------------

with gr.Blocks(title="Modular Pipeline Builder") as demo:
    gr.Markdown("""
    # 🧩 Modular Pipeline Builder
    - Choose a pipeline, provide the **main input** (image/video/text) and any **extra parameters**.
    - Click **Run** to execute; toggle **Show steps** to reveal intermediate steps.
    - **Export** bundles everything (JSON + inputs/outputs/steps/media) as a ZIP.
    - **Import** loads a previously exported ZIP and restores inputs/params.
    - Extend by adding new `BasePipeline` subclasses and registering them.
    """)

    with gr.Row():
        pipeline_dropdown = gr.Dropdown(
            label="Pipeline",
            choices=list(REGISTRY.keys()),
            value=list(REGISTRY.keys())[0] if REGISTRY else None,
            interactive=True,
        )
        show_steps_chk = gr.Checkbox(label="Show steps", value=True)

    # Dynamic main input area
    main_image = gr.Image(label="Main Image", type="pil", visible=False)
    main_video = gr.Video(label="Main Video", visible=False)
    main_text = gr.Textbox(label="Main Text", visible=False, lines=4)

    # Dynamic params container
    params_container = gr.Group()
    params_components: List[gr.components.Component] = []

    # Results
    with gr.Row():
        out_image = gr.Image(label="Output Image", visible=False)
        out_video = gr.Video(label="Output Video", visible=False)
        out_text = gr.Textbox(label="Output Text", visible=False)
    steps_gallery = gr.Gallery(label="Intermediate Steps", show_label=True, visible=True, columns=4, height=220)
    steps_log = gr.Dataframe(headers=["Label", "Text"], datatype=["str", "str"], interactive=False, visible=True)

    # State
    run_state = gr.State(value=None)  # will hold dict with last run data used for export

    run_btn = gr.Button("▶️ Run", variant="primary")

    with gr.Row():
        export_btn = gr.Button("📦 Export ZIP")
        export_file = gr.File(label="Download ZIP", interactive=False)
    with gr.Accordion("Import a ZIP", open=False):
        import_file = gr.File(label="Choose ZIP", file_count="single", file_types=[".zip"])
        import_btn = gr.Button("🔄 Import")
        import_status = gr.Markdown(visible=False)

    # -------- Dynamic wiring functions --------

    def _build_param_ui(pipe_name: str):
        comps = []
        specs = REGISTRY[pipe_name].params
        with params_container:
            # clear container by returning new components list
            built = []
            for spec in specs:
                built.append(build_param_component(spec))
        return built

    def on_pipeline_change(name: str):
        if not name:
            return (
                gr.update(visible=False),
                gr.update(visible=False),
                gr.update(visible=False),
                [],
            )
        pipe = REGISTRY[name]
        # Toggle main input
        img_v = pipe.main_input_type == "image"
        vid_v = pipe.main_input_type == "video"
        txt_v = pipe.main_input_type == "text"
        built = _build_param_ui(name)
        # store component references in a simple list
        return (
            gr.update(visible=img_v),
            gr.update(visible=vid_v),
            gr.update(visible=txt_v),
            built,
        )

    pipeline_dropdown.change(
        fn=on_pipeline_change,
        inputs=[pipeline_dropdown],
        outputs=[main_image, main_video, main_text, params_container],
        queue=False,
    )

    # Initialize UI on load
    demo.load(
        fn=on_pipeline_change,
        inputs=[pipeline_dropdown],
        outputs=[main_image, main_video, main_text, params_container],
        queue=False,
    )

    def _collect_params(pipe_name: str, *vals):
        specs = REGISTRY[pipe_name].params
        params = {}
        for spec, val in zip(specs, vals):
            params[spec.name] = val
        return params

    def run_pipeline(pipe_name: str, show_steps: bool, img, vid, txt, *param_vals):
        pipe = REGISTRY[pipe_name]
        params = _collect_params(pipe_name, *param_vals)

        # Prepare main input
        main_input = None
        if pipe.main_input_type == "image":
            if img is None:
                raise gr.Error("Please provide a main image input.")
            main_input = img
        elif pipe.main_input_type == "video":
            if vid is None:
                raise gr.Error("Please provide a main video input.")
            main_input = vid
        else:
            main_input = txt or ""

        output, steps = pipe.run(main_input, **params)

        # Prepare UI updates
        out_img_u = gr.update(visible=False)
        out_vid_u = gr.update(visible=False)
        out_txt_u = gr.update(visible=False)
        gallery_items = []
        step_rows = []
        if show_steps:
            for s in steps:
                if s.get("image") is not None:
                    # gallery expects (image, caption)
                    gallery_items.append((s["image"], s.get("label", "step")))
                if s.get("images"):
                    for im in s["images"]:
                        gallery_items.append((im, s.get("label", "step")))
                if s.get("text") is not None:
                    step_rows.append([s.get("label", "step"), s["text"]])
        # Output placement
        if pipe.main_output_type == "image" and isinstance(output, Image.Image):
            out_img_u = output
        elif pipe.main_output_type == "video" and isinstance(output, str):
            out_vid_u = output
        else:
            out_txt_u = str(output)

        run_payload = {
            "pipeline": pipe_name,
            "main_input_type": pipe.main_input_type,
            "main_input": main_input,
            "params": params,
            "output": output,
            "steps": steps,
        }
        return (
            out_img_u,
            out_vid_u,
            out_txt_u,
            gallery_items,
            step_rows or [["—", "—"]],
            run_payload,
        )

    # Wire RUN button: outputs (out_image, out_video, out_text, steps_gallery, steps_log, state)
    run_btn.click(
        fn=run_pipeline,
        inputs=[
            pipeline_dropdown,
            show_steps_chk,
            main_image,
            main_video,
            main_text,
            params_container,
        ],
        outputs=[out_image, out_video, out_text, steps_gallery, steps_log, run_state],
    )

    # Export ZIP
    def do_export(state):
        if not state:
            raise gr.Error("Run a pipeline first.")
        zpath = export_run_zip(
            state["pipeline"],
            state["main_input_type"],
            state["main_input"],
            state["params"],
            state["output"],
            state["steps"],
        )
        return zpath

    export_btn.click(fn=do_export, inputs=[run_state], outputs=[export_file])

    # Import ZIP
    def do_import(zipfile_obj):
        if zipfile_obj is None:
            raise gr.Error("Please choose a ZIP to import.")
        zpath = zipfile_obj.name if hasattr(zipfile_obj, "name") else zipfile_obj
        pipe_name, params, main_payload, main_type, _paths = import_run_zip(zpath)
        if pipe_name not in REGISTRY:
            return (
                gr.update(value=f"Imported pipeline '{pipe_name}' is not registered in this app.", visible=True),
                gr.update(value=None),
                gr.update(value=None),
                gr.update(value=None),
                gr.update(value=None),
                gr.update(value=None),
            )
        # Build components to set values accordingly
        updates = {}
        updates["pipe"] = gr.update(value=pipe_name)
        updates["img_vis"] = gr.update(visible=(main_type == "image"), value=main_payload if main_type == "image" else None)
        updates["vid_vis"] = gr.update(visible=(main_type == "video"), value=main_payload if main_type == "video" else None)
        updates["txt_vis"] = gr.update(visible=(main_type == "text"), value=main_payload if main_type == "text" else None)
        # Params population is best-effort; we display a status note
        note = "Imported. Review parameters below (media restored when possible)."
        return (
            gr.update(value=note, visible=True),
            updates["pipe"],
            updates["img_vis"],
            updates["vid_vis"],
            updates["txt_vis"],
            params,
        )

    import_btn.click(
        fn=do_import,
        inputs=[import_file],
        outputs=[import_status, pipeline_dropdown, main_image, main_video, main_text, params_container],
    )


# For HF Spaces
if __name__ == "__main__":
    demo.launch()
