/* Local Whisper inference for Cascade Motion.
 *
 * The model, tokenizer and ONNX runtime all execute in this worker on the
 * user's device. Audio is decoded in the editor and sent here as a mono
 * Float32Array; it is never uploaded to Cascade or a third-party provider.
 * Model weights are downloaded once from Hugging Face and cached by the
 * browser's Cache Storage API.
 */
import { pipeline, env } from '../vendor/transformers/transformers.bundle.mjs';

const VENDOR = new URL('../vendor/transformers/', import.meta.url).href;
env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = {
  mjs: `${VENDOR}ort-wasm-simd-threaded.jsep.mjs`,
  wasm: `${VENDOR}ort-wasm-simd-threaded.jsep.wasm`,
};
env.backends.onnx.wasm.proxy = false;
env.backends.onnx.wasm.numThreads = self.crossOriginIsolated
  ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 2))
  : 1;

const MODELS = {
  'onnx-community/whisper-tiny': { label: 'Tiny', multilingual: true },
  'onnx-community/whisper-base': { label: 'Base', multilingual: true },
  'onnx-community/whisper-small': { label: 'Small', multilingual: true },
  'onnx-community/whisper-tiny.en': { label: 'Tiny English', multilingual: false },
  'onnx-community/whisper-base.en': { label: 'Base English', multilingual: false },
};

let loadedModel = '';
let loadedDevice = '';
let transcriber = null;

function post(message, transfer) {
  self.postMessage(message, transfer || []);
}

async function create(model, progress) {
  // CPU/WASM is the reliable local path across browsers and drivers. It still
  // runs entirely on this device; no audio or model request goes to Cascade.
  const instance = await pipeline('automatic-speech-recognition', model, {
    device: 'wasm',
    dtype: 'q8',
    progress_callback: (event) => progress(event),
  });
  return { instance, device: 'wasm' };
}

self.addEventListener('message', async (event) => {
  const data = event.data || {};
  if (data.type !== 'transcribe') return;
  const { id, audio, model, language = 'en', translate = false } = data;
  const info = MODELS[model];
  if (!info) {
    post({ type: 'error', id, error: `Unsupported local Whisper model: ${model}` });
    return;
  }
  const started = performance.now();
  try {
    if (!transcriber || loadedModel !== model) {
      loadedModel = '';
      loadedDevice = '';
      transcriber = null;
      post({ type: 'status', id, message: `Loading ${info.label} Whisper model…` });
      const built = await create(model, (progress) => {
        if (progress.status === 'progress' && Number.isFinite(progress.progress)) {
          post({
            type: 'progress',
            id,
            loaded: progress.loaded,
            total: progress.total,
            percent: progress.progress,
            file: progress.file,
          });
        } else if (progress.status === 'ready') {
          post({ type: 'status', id, message: 'Model ready' });
        }
      });
      transcriber = built.instance;
      loadedModel = model;
      loadedDevice = built.device;
      post({ type: 'ready', id, model, device: built.device });
    }
    const options = {
      // The public ONNX Whisper exports do not include cross-attentions, so
      // word-level timestamps are unavailable. Segment timestamps are reliable;
      // split each segment evenly across its words for caption animation.
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      task: translate ? 'translate' : 'transcribe',
    };
    // Transformers.js defaults Whisper to English when no language token is
    // supplied; an explicit choice is required for other languages.
    if (info.multilingual && language) options.language = language === 'auto' ? 'en' : language;
    post({ type: 'status', id, message: 'Transcribing on this device…' });
    const result = await transcriber(audio, options);
    const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
    const words = [];
    for (const chunk of chunks) {
      const [start, end] = Array.isArray(chunk.timestamp) ? chunk.timestamp : [0, 0];
      const text = String(chunk.text || '').trim();
      if (!text) continue;
      const pieces = text.split(/\s+/);
      const from = Number(start) || 0;
      const span = Math.max(0.08, ((Number(end) || from) - from) / Math.max(1, pieces.length));
      pieces.forEach((piece, index) => words.push({
        text: piece,
        start: from + index * span,
        end: from + (index + 1) * span,
      }));
    }
    post({
      type: 'done',
      id,
      result: {
        text: String(result?.text || words.map((word) => word.text).join(' ')).trim(),
        words,
        language: info.multilingual ? (language === 'auto' ? 'en' : language) : 'en',
        model,
        device: loadedDevice,
        local: true,
        elapsedMs: Math.round(performance.now() - started),
      },
    });
  } catch (err) {
    post({ type: 'error', id, error: err?.message || 'Local transcription failed' });
  }
});
