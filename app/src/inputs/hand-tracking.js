import { JOINTS } from '../arm/rig.js';

const HANDS_VERSION = '0.4.1675469240';
const FACE_VERSION = '0.4.1646425229';
const cdn = (packageName, version) => `https://cdn.jsdelivr.net/npm/@mediapipe/${packageName}@${version}/`;
const scripts = new Map();

function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve();
  if (scripts.has(url)) return scripts.get(url);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => fail(), 20000);
    function fail() {
      clearTimeout(timeout);
      script.remove();
      scripts.delete(url);
      reject(new Error('Tracking files could not be loaded. Check your connection and try again.'));
    }
    script.src = url;
    script.crossOrigin = 'anonymous';
    script.onload = () => { clearTimeout(timeout); window[globalName] ? resolve() : fail(); };
    script.onerror = fail;
    document.head.append(script);
  });
  scripts.set(url, promise);
  return promise;
}

function jointTarget(index, amount) {
  const joint = JOINTS[index];
  return joint.min + Math.max(0, Math.min(1, amount)) * (joint.max - joint.min);
}

function fingerCurl(a, b, c) {
  const dot = (a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y);
  const length = Math.hypot(a.x - b.x, a.y - b.y) * Math.hypot(c.x - b.x, c.y - b.y);
  const angle = length > 0 ? Math.acos(Math.max(-1, Math.min(1, dot / length))) : Math.PI;
  return 1 - Math.max(0, Math.min(1, (angle - Math.PI / 3) / (Math.PI * .6)));
}

export class HandTracking {
  constructor({ video, canvas, getAngles, onAngles, onState, onError }) {
    Object.assign(this, { video, canvas, getAngles, onAngles, onState, onError });
    this.context = canvas.getContext('2d');
    this.enabled = false;
    this.busy = false;
    this.control = false;
    this.smoothing = true;
    this.blur = false;
    this.faceBox = null;
    this.lastFrame = -1;
    this.lastPoseTime = 0;
    this.request = 0;
    this.frameTask = null;
    this.generation = 0;
  }

  async toggle() {
    if (this.busy) return;
    if (this.enabled) { await this.stop(); return; }
    this.busy = true;
    const generation = ++this.generation;
    const checkStartup = () => {
      if (generation !== this.generation) throw new DOMException('Camera startup cancelled', 'AbortError');
    };
    this.onState('loading');
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('The camera needs localhost or HTTPS and a browser with camera support.');
      await loadScript(`${cdn('hands', HANDS_VERSION)}hands.js`, 'Hands');
      checkStartup();
      this.hands = new window.Hands({ locateFile: file => `${cdn('hands', HANDS_VERSION)}${file}` });
      this.hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: .7, minTrackingConfidence: .6 });
      this.hands.onResults(results => this.onHands(results));
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 400 }, facingMode: 'user' }, audio: false });
      if (generation !== this.generation) stream.getTracks().forEach(track => track.stop());
      checkStartup();
      this.stream = stream;
      this.video.srcObject = this.stream;
      await this.video.play();
      checkStartup();
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      this.canvas.parentElement.style.aspectRatio = `${this.canvas.width} / ${this.canvas.height}`;
      this.enabled = true;
      this.smoothed = [...this.getAngles()];
      this.lastFrame = -1;
      this.onState('detecting');
      this.schedule();
    } catch (error) {
      await this.stop();
      if (error.name === 'AbortError') return;
      const message = error.name === 'NotAllowedError' ? 'Camera access was denied. Allow camera access in your browser and try again.' : error.name === 'NotFoundError' ? 'No camera was found. Connect one and try again.' : error.message;
      this.onError(message);
    } finally { this.busy = false; }
  }

  setControl(enabled) {
    this.control = !!enabled && this.enabled;
    this.smoothed = [...this.getAngles()];
    this.lastPoseTime = performance.now();
  }

  async setBlur(enabled) {
    this.blur = enabled;
    if (!enabled) { this.faceBox = null; return; }
    if (!this.enabled || this.face) return;
    try {
      await loadScript(`${cdn('face_detection', FACE_VERSION)}face_detection.js`, 'FaceDetection');
      if (!this.enabled || !this.blur || this.face) return;
      this.face = new window.FaceDetection({ locateFile: file => `${cdn('face_detection', FACE_VERSION)}${file}` });
      this.face.setOptions({ model: 'short', minDetectionConfidence: .5 });
      this.face.onResults(results => { this.faceBox = results.detections?.[0]?.boundingBox ?? null; });
    } catch (error) { this.blur = false; this.onError(error.message); }
  }

  schedule() {
    if (!this.enabled) return;
    this.request = requestAnimationFrame(() => {
      this.frameTask = this.processFrame().finally(() => { this.frameTask = null; this.schedule(); });
    });
  }

  async processFrame() {
    if (!this.enabled || this.video.readyState < 2 || this.video.currentTime === this.lastFrame) return;
    this.lastFrame = this.video.currentTime;
    try {
      if (this.blur && this.face) await this.face.send({ image: this.video });
      await this.hands.send({ image: this.video });
    } catch (error) {
      if (!this.enabled) return;
      this.enabled = this.control = false;
      this.releaseCamera();
      this.onState('off');
      this.onError(`Hand tracking stopped: ${error.message}`);
      // Close MediaPipe only after its send promise has settled.
      queueMicrotask(() => { void this.stop(); });
    }
  }

  onHands(results) {
    if (!this.enabled) return;
    const ctx = this.context, width = this.canvas.width, height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    // Video and canvas share the same aspect ratio and CSS mirror, so their
    // coordinate systems stay aligned without a second horizontal flip.
    if (this.blur && this.faceBox) {
      const box = this.faceBox;
      const left = (box.xCenter - box.width * .65) * width;
      const top = (box.yCenter - box.height * .65) * height;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, box.width * 1.3 * width, box.height * 1.3 * height);
      ctx.clip();
      ctx.filter = 'blur(22px)';
      ctx.drawImage(this.video, 0, 0, width, height);
      ctx.restore();
    }
    const landmarks = results.multiHandLandmarks?.[0];
    if (!landmarks) { this.onState('detecting'); this.lastPoseTime = performance.now(); return; }
    this.onState('tracking');
    const connections = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
    ctx.strokeStyle = '#72bce3';
    ctx.lineWidth = 2;
    ctx.beginPath();
    connections.forEach(([a, b]) => { ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height); ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height); });
    ctx.stroke();
    ctx.fillStyle = '#eef8ff';
    landmarks.forEach(point => { ctx.beginPath(); ctx.arc(point.x * width, point.y * height, 3, 0, Math.PI * 2); ctx.fill(); });
    if (!this.control) return;
    const palm = [0, 5, 9, 13, 17].map(index => landmarks[index]);
    const x = palm.reduce((sum, point) => sum + point.x, 0) / palm.length;
    const y = palm.reduce((sum, point) => sum + point.y, 0) / palm.length;
    const tilt = Math.atan2(landmarks[9].x - landmarks[0].x, landmarks[0].y - landmarks[9].y);
    const targets = [jointTarget(0, x), jointTarget(1, 1 - y), jointTarget(2, .5 + tilt / Math.PI), jointTarget(3, fingerCurl(landmarks[5], landmarks[6], landmarks[7]))];
    const now = performance.now();
    const delta = Math.min(.1, (now - this.lastPoseTime) / 1000);
    this.lastPoseTime = now;
    const amount = this.smoothing ? 1 - Math.exp(-delta * 7) : 1;
    this.smoothed = this.smoothed.map((angle, index) => angle + (targets[index] - angle) * amount);
    this.onAngles(this.smoothed, 'hand');
  }

  releaseCamera() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  async stop() {
    this.generation++;
    this.enabled = this.control = false;
    cancelAnimationFrame(this.request);
    this.releaseCamera();
    await this.frameTask;
    const resources = [this.hands, this.face];
    this.hands = this.face = null;
    await Promise.allSettled(resources.filter(Boolean).map(resource => resource.close()));
    this.faceBox = null;
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.onState('off');
  }
}
