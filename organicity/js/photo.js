// Photo tours use camera targets, with eased legs and the shortest turn at ±π.
export function cameraPose(cam) {
  return Object.fromEntries(['x', 'z', 'targetY', 'yaw', 'pitch', 'dist'].map(k => [k, cam[k] ?? 0]));
}
export function samplePath(points, progress) {
  if (!points.length) return null;
  if (points.length === 1) return cameraPose(points[0]);
  const p = Math.max(0, Math.min(1, progress)) * (points.length - 1);
  const i = Math.min(points.length - 2, Math.floor(p)), a = points[i], b = points[i + 1];
  const t = p - i, ease = t * t * (3 - 2 * t), pose = {};
  for (const k of ['x', 'z', 'targetY', 'yaw', 'pitch', 'dist']) {
    let delta = b[k] - a[k];
    if (k === 'yaw') delta = Math.atan2(Math.sin(delta), Math.cos(delta));
    pose[k] = a[k] + delta * ease;
  }
  return pose;
}
export function videoType() {
  return typeof MediaRecorder === 'undefined' ? '' : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
}
export class PhotoTour {
  constructor(renderer, changed, save) {
    this.r = renderer; this.changed = changed; this.save = save; this.points = []; this.playing = false; this.busy = false;
  }
  add() { if (!this.busy && this.points.length < 16) this.points.push(cameraPose(this.r.cam)); }
  start(duration, record = false) {
    if (this.busy || this.points.length < 2) return;
    this.duration = Math.max(2, Math.min(120, Number(duration) || 10));
    this.original = cameraPose(this.r.cam); this.cancelled = false; this.chunks = [];
    try {
      if (record) {
        const type = videoType(); if (!type) throw Error('WebM recording is unavailable in this browser.');
        const src = this.r.r.domElement;
        this.canvas = document.createElement('canvas'); this.canvas.width = src.width; this.canvas.height = src.height;
        this.context = this.canvas.getContext('2d');
        this.stream = this.canvas.captureStream(30);
        this.recorder = new MediaRecorder(this.stream, { mimeType: type, videoBitsPerSecond: 8000000 });
        this.recorder.ondataavailable = e => { if (e.data.size) this.chunks.push(e.data); };
        this.recorder.onerror = () => { this.stop(true); this.changed('Video recording failed.'); };
        this.recorder.onstop = () => {
          const blob = new Blob(this.chunks, { type });
          if (!this.cancelled && blob.size) this.save(blob);
          this.release(); this.changed();
        };
      }
      this.busy = this.playing = true; this.started = performance.now();
      Object.assign(this.r.cam, this.points[0]); this.r.updateCamera(); this.r.draw(); this.copyFrame();
      this.recorder?.start(1000); this.changed();
    } catch (e) { this.release(); Object.assign(this.r.cam, this.original); this.changed(e.message); }
  }
  beforeFrame() {
    if (!this.playing) return;
    this.progress = Math.min(1, (performance.now() - this.started) / (this.duration * 1000));
    Object.assign(this.r.cam, samplePath(this.points, this.progress));
  }
  copyFrame() { if (this.context) this.context.drawImage(this.r.r.domElement, 0, 0, this.canvas.width, this.canvas.height); }
  afterFrame() {
    if (!this.playing) return;
    this.copyFrame();
    if (this.progress >= 1) this.stop(false);
  }
  stop(cancel = true) {
    if (!this.busy) return;
    this.cancelled = cancel; this.playing = false;
    if (this.original) Object.assign(this.r.cam, this.original);
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    else this.release();
    this.changed();
  }
  release() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = this.recorder = this.canvas = this.context = null;
    this.chunks = []; this.playing = this.busy = false;
  }
}
