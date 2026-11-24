import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { TICKS, wordsToCues } from '../../public/motion/schema.mjs';
import { binary, spawnFfmpeg, tmpFile, cleanupFile } from './ffmpeg.js';

/* Transcription providers. The project never stores a provider key: hosted
 * providers read the deployment's environment, and the administrator chooses
 * the provider in Settings → Motion. */
export async function extractAudio(input, settings) {
  const out = tmpFile('wav');
  await spawnFfmpeg([
    '-y', '-v', 'error', '-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out,
  ], { binary: binary(settings), timeoutMs: 15 * 60_000 });
  return out;
}

export function normalizeWords(raw) {
  const list = [];
  const words = raw?.words || raw?.word_segments || [];
  for (const w of words) {
    const text = String(w.word ?? w.text ?? '').trim();
    if (!text) continue;
    const start = Number(w.start ?? w.startTime ?? w.timestamps?.from ?? 0);
    const end = Number(w.end ?? w.endTime ?? w.timestamps?.to ?? start);
    list.push({ text, start: Math.round(start * TICKS), end: Math.max(Math.round(end * TICKS), Math.round(start * TICKS) + 1000) });
  }
  if (list.length) return list;
  for (const segment of raw?.segments || raw?.transcription || []) {
    const text = String(segment.text ?? '').trim();
    if (!text) continue;
    const start = Number(segment.start ?? segment.timestamps?.from ?? 0);
    const end = Number(segment.end ?? segment.timestamps?.to ?? start);
    // Some local engines only emit sentence timings. Spread words evenly so
    // word-level caption animation still has a usable, deterministic rhythm.
    const pieces = text.split(/\s+/);
    const span = Math.max(0.05, end - start) / pieces.length;
    pieces.forEach((piece, i) => list.push({
      text: piece,
      start: Math.round((start + i * span) * TICKS),
      end: Math.round((start + (i + 1) * span) * TICKS),
    }));
  }
  return list;
}

export async function transcribe({ inputPath, settings, provider, language = 'auto', prompt = '', model = '', translate = false, translateTo = '' }) {
  const configured = settings.whisper || {};
  const chosen = provider || configured.provider || 'disabled';
  if (chosen === 'disabled') throw new Error('Whisper is disabled. An administrator can enable it in Settings → Motion.');
  const wav = await extractAudio(inputPath, settings);
  try {
    if (chosen === 'openai' || chosen === 'compatible') {
      let endpoint = chosen === 'openai'
        ? (configured.endpoint || 'https://api.openai.com/v1/audio/transcriptions')
        : configured.endpoint;
      if (!endpoint) throw new Error('A compatible transcription endpoint is not configured');
      const englishTranslation = translate && (!translateTo || translateTo === 'en');
      if (englishTranslation) endpoint = endpoint.replace(/\/audio\/transcriptions\/?$/, '/audio/translations');
      const key = process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY || '';
      if (!key) throw new Error('OPENAI_API_KEY (or WHISPER_API_KEY) is not set on the server');
      const form = new FormData();
      const bytes = fs.readFileSync(wav);
      form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', model || configured.model || 'whisper-1');
      form.append('response_format', 'verbose_json');
      form.append('timestamp_granularities[]', 'word');
      form.append('timestamp_granularities[]', 'segment');
      if (!englishTranslation && language && language !== 'auto') form.append('language', language);
      if (prompt) form.append('prompt', String(prompt).slice(0, 900));
      const res = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${key}` }, body: form });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error?.message || `Transcription provider returned ${res.status}`);
      const words = normalizeWords(body);
      return { words, language: body.language || language, text: body.text || words.map((w) => w.text).join(' '), provider: chosen, translated: englishTranslation };
    }
    if (chosen === 'local') {
      return await transcribeLocal({ inputPath: wav, configured, settings, language, prompt, model, translate });
    }
    throw new Error(`Unknown transcription provider "${chosen}"`);
  } finally {
    cleanupFile(wav);
  }
}

async function transcribeLocal({ inputPath, configured, settings, language, prompt, model: modelOverride, translate = false }) {
  const binaryPath = configured.binary || 'whisper-cli';
  const model = configured.modelPath || modelOverride;
  if (!model) throw new Error('WHISPER_MODEL_PATH must point at a whisper.cpp model');
  if (!fs.existsSync(model)) throw new Error('The configured whisper.cpp model does not exist');
  const outPrefix = tmpFile('whisper');
  const args = ['-m', model, '-f', inputPath, '-oj', '-ml', '1', '-of', outPrefix];
  if (language && language !== 'auto') args.push('-l', String(language));
  if (configured.threads) args.push('-t', String(configured.threads));
  if (prompt) args.push('--prompt', String(prompt).slice(0, 900));
  if (translate) args.push('-tr');
  const result = await spawnProcess(binaryPath, args, 60 * 60 * 1000);
  const jsonPath = `${outPrefix}.json`;
  let parsed = {};
  try { parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')); } catch { throw new Error(`Whisper did not produce JSON: ${result.stderr.slice(-300)}`); }
  cleanupFile(jsonPath);
  cleanupFile(outPrefix);
  const words = normalizeWords(parsed);
  return { words, language: parsed.result?.language || language, text: parsed.transcription?.map((s) => s.text).join(' ') || words.map((w) => w.text).join(' '), provider: 'local', translated: !!translate };
}

function spawnProcess(bin, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* noop */ } }, timeoutMs);
    child.stdout.on('data', (c) => { stdout = (stdout + c).slice(-100000); });
    child.stderr.on('data', (c) => { stderr = (stderr + c).slice(-100000); });
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().split('\n').slice(-3).join(' ') || `Transcriber exited ${code}`));
    });
  });
}

export function transcriptCues(result, options = {}) {
  return wordsToCues(result.words || [], options);
}

export async function translateCues(cues, settings, target) {
  const endpoint = settings.whisper?.endpoint;
  const key = process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY || '';
  if (settings.whisper?.translateProvider !== 'openai' || !endpoint || !key) {
    throw new Error('Subtitle translation is not configured');
  }
  const res = await fetch(endpoint.replace(/\/audio\/transcriptions\/?$/, '/chat/completions'), {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.whisper.translateModel || 'gpt-4o-mini',
      messages: [
        { role: 'system', content: `Translate each subtitle cue to ${target}. Return only a JSON array of strings, same order and length.` },
        { role: 'user', content: JSON.stringify(cues.map((c) => c.text)) },
      ],
      response_format: { type: 'json_object' },
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message || `Translation provider returned ${res.status}`);
  const content = body.choices?.[0]?.message?.content || '{}';
  const parsed = JSON.parse(content);
  const list = parsed.translations || parsed.cues || parsed;
  if (!Array.isArray(list) || list.length !== cues.length) throw new Error('Translation provider returned a mismatched cue list');
  return cues.map((cue, i) => ({ ...cue, text: String(list[i]) }));
}

export async function cuesFromAsset(inputPath, settings, opts = {}) {
  const result = await transcribe({ inputPath, settings, ...opts });
  return { ...result, cues: transcriptCues(result, opts.cueOptions) };
}
