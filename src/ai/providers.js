/* Provider transport for Cascade AI.
 *
 * Everything here is server-side: OpenAI-compatible endpoints (OpenAI, Groq,
 * OpenRouter, LM Studio, vLLM, …) and native Ollama. Credentials never leave
 * the process. Heavy parsers are plain streams, not dependencies. */
import { providerHeaders, resolveApiKey } from './config.js';

const DEFAULT_TIMEOUT = 120000;

class ProviderError extends Error {
  constructor(message, status = 502, detail = '') {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export { ProviderError };

function joinUrl(base, path) {
  return `${String(base || '').replace(/\/+$/, '')}${path}`;
}

function timeoutSignal(ms) {
  try {
    return AbortSignal.timeout(ms);
  } catch {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms).unref?.();
    return controller.signal;
  }
}

async function errorFromResponse(res) {
  let detail = '';
  try {
    const body = await res.text();
    try {
      const json = JSON.parse(body);
      detail = json.error?.message || json.message || body;
    } catch {
      detail = body;
    }
  } catch { /* ignore */ }
  const message = detail ? detail.slice(0, 400) : `Provider responded ${res.status}`;
  return new ProviderError(message, res.status === 401 || res.status === 403 ? 401 : 502, detail.slice(0, 1000));
}

async function postJson(provider, path, body, { timeout = DEFAULT_TIMEOUT } = {}) {
  const res = await fetch(joinUrl(provider.baseUrl, path), {
    method: 'POST',
    headers: providerHeaders(provider, { 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal: timeoutSignal(timeout),
  });
  if (!res.ok) throw await errorFromResponse(res);
  return res;
}

async function getJson(provider, path, { timeout = 20000 } = {}) {
  const res = await fetch(joinUrl(provider.baseUrl, path), {
    headers: providerHeaders(provider),
    signal: timeoutSignal(timeout),
  });
  if (!res.ok) throw await errorFromResponse(res);
  return res.json();
}

/* ------------------------------------------------------------------------- */
/* Model discovery                                                           */
/* ------------------------------------------------------------------------- */

function guessCapabilities(id) {
  const name = String(id).toLowerCase();
  return {
    vision: /(gpt-4o|gpt-4\.1|gpt-4-turbo|o3|o4|claude|gemini|llava|llama3\.2-vision|qwen2?\.?5?-vl|pixtral|vision)/.test(name),
    tools: !/(embed|whisper|tts|dall-e|image|rerank|moderation)/.test(name),
    image: /(dall-e|gpt-image|flux|stable-diffusion|imagen)/.test(name),
  };
}

export async function discoverModels(provider) {
  if (!provider) throw new ProviderError('No provider configured', 400);
  if (provider.type === 'ollama') {
    const data = await getJson(provider, '/api/tags');
    return (data.models || []).map((m) => ({
      id: m.name || m.model,
      label: m.name || m.model,
      contextWindow: 0,
      vision: /llava|vision|moondream|gemma3/i.test(m.name || ''),
      tools: !/embed/i.test(m.name || ''),
      image: false,
    })).filter((m) => m.id);
  }
  const data = await getJson(provider, '/models');
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  return list.map((m) => {
    const id = m.id || m.name;
    const caps = guessCapabilities(id);
    return { id, label: m.name || id, contextWindow: Number(m.context_length || m.context_window) || 0, ...caps };
  }).filter((m) => m.id);
}

export async function providerHealth(provider) {
  const started = Date.now();
  const models = await discoverModels(provider);
  return { ok: true, models: models.length, latencyMs: Date.now() - started };
}

/* ------------------------------------------------------------------------- */
/* Chat streaming                                                            */
/* ------------------------------------------------------------------------- */

function normalizeUsage(raw) {
  if (!raw) return null;
  const prompt = Number(raw.prompt_tokens ?? raw.promptTokens ?? raw.prompt_eval_count ?? 0) || 0;
  const completion = Number(raw.completion_tokens ?? raw.completionTokens ?? raw.eval_count ?? 0) || 0;
  const total = Number(raw.total_tokens ?? raw.totalTokens ?? 0) || prompt + completion;
  if (!prompt && !completion && !total) return null;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

function parseToolArgs(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function* openaiStream(provider, opts) {
  const body = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (opts.tools?.length && opts.toolsEnabled !== false) {
    body.tools = opts.tools;
    body.tool_choice = 'auto';
  }
  if (Number.isFinite(opts.temperature)) body.temperature = Math.max(0, Math.min(2, opts.temperature));
  if (opts.maxTokens) body.max_tokens = Math.max(16, Math.min(200000, opts.maxTokens));
  const res = await postJson(provider, '/chat/completions', body, { timeout: opts.timeout || DEFAULT_TIMEOUT });
  if (!res.body) throw new ProviderError('Provider returned no stream', 502);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = new Map();
  let usage = null;
  let emittedText = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let split;
      while ((split = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);
        for (const line of chunk.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch { continue; }
          if (json.error) throw new ProviderError(json.error.message || 'Provider error', 502);
          const choice = json.choices?.[0];
          const delta = choice?.delta || {};
          if (typeof delta.content === 'string' && delta.content) {
            emittedText = true;
            yield { type: 'text', text: delta.content };
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const part of delta.tool_calls) {
              const index = Number.isInteger(part.index) ? part.index : calls.size;
              const current = calls.get(index) || { id: '', name: '', arguments: '' };
              if (part.id) current.id = part.id;
              if (part.function?.name) current.name += part.function.name;
              if (part.function?.arguments) current.arguments += part.function.arguments;
              calls.set(index, current);
            }
          }
          const chunkUsage = normalizeUsage(json.usage);
          if (chunkUsage) usage = chunkUsage;
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  if (calls.size) {
    const list = [...calls.entries()].sort((a, b) => a[0] - b[0]).map(([index, call]) => ({
      id: call.id || `call_${Date.now()}_${index}`,
      name: call.name,
      arguments: parseToolArgs(call.arguments),
    })).filter((call) => call.name);
    if (list.length) yield { type: 'tool_calls', calls: list };
  }
  if (usage) yield { type: 'usage', usage };
  if (!emittedText && !calls.size) yield { type: 'text', text: '' };
}

async function* ollamaStream(provider, opts) {
  const body = {
    model: opts.model,
    messages: opts.messages.map((m) => {
      const message = { role: m.role, content: m.content ?? '' };
      if (m.images) message.images = m.images;
      if (m.tool_calls) message.tool_calls = m.tool_calls;
      if (m.tool_name) message.tool_name = m.tool_name;
      return message;
    }),
    stream: true,
    options: {},
  };
  if (Number.isFinite(opts.temperature)) body.options.temperature = Math.max(0, Math.min(2, opts.temperature));
  if (opts.maxTokens) body.options.num_predict = opts.maxTokens;
  if (opts.tools?.length && opts.toolsEnabled !== false) body.tools = opts.tools;
  const res = await postJson(provider, '/api/chat', body, { timeout: opts.timeout || DEFAULT_TIMEOUT });
  if (!res.body) throw new ProviderError('Ollama returned no stream', 502);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const calls = [];
  let usage = null;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let json;
        try { json = JSON.parse(line); } catch { continue; }
        if (json.error) throw new ProviderError(json.error.message || json.error, 502);
        const message = json.message || {};
        if (message.content) yield { type: 'text', text: message.content };
        if (Array.isArray(message.tool_calls)) {
          for (const call of message.tool_calls) {
            if (call.function?.name) calls.push({ id: `call_${Date.now()}_${calls.length}`, name: call.function.name, arguments: parseToolArgs(call.function.arguments) });
          }
        }
        if (json.done) {
          usage = normalizeUsage({ prompt_eval_count: json.prompt_eval_count, eval_count: json.eval_count });
        }
      }
    }
  } finally {
    reader.releaseLock?.();
  }
  if (calls.length) yield { type: 'tool_calls', calls };
  if (usage) yield { type: 'usage', usage };
}

export async function* streamChat(provider, opts) {
  if (!provider) throw new ProviderError('No AI provider is configured', 400);
  if (provider.type === 'ollama') yield* ollamaStream(provider, opts);
  else yield* openaiStream(provider, opts);
}

/* ------------------------------------------------------------------------- */
/* Images                                                                    */
/* ------------------------------------------------------------------------- */

function imageMime(buffer) {
  if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return 'image/jpeg';
  if (buffer.slice(0, 4).toString() === 'RIFF') return 'image/webp';
  return 'image/png';
}

async function bufferFromResult(entry) {
  if (entry.b64_json) return { buffer: Buffer.from(entry.b64_json, 'base64'), mime: 'image/png' };
  if (entry.url?.startsWith('data:')) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(entry.url);
    if (match) return { buffer: Buffer.from(match[2], 'base64'), mime: match[1] };
  }
  if (entry.url) {
    const res = await fetch(entry.url, { signal: timeoutSignal(60000) });
    if (!res.ok) throw new ProviderError('Could not download the generated image', 502);
    const buffer = Buffer.from(await res.arrayBuffer());
    return { buffer, mime: res.headers.get('content-type') || imageMime(buffer) };
  }
  throw new ProviderError('Provider returned no image data', 502);
}

export async function generateImages(provider, { prompt, model, size, quality, count = 1 }) {
  if (!provider) throw new ProviderError('No image provider is configured', 400);
  if (provider.type === 'ollama') throw new ProviderError('Ollama does not generate images. Configure an OpenAI-compatible image endpoint.', 400);
  const body = { model, prompt, n: Math.max(1, Math.min(4, count)), size, response_format: 'b64_json' };
  if (quality && quality !== 'auto') body.quality = quality;
  let data;
  try {
    const res = await postJson(provider, '/images/generations', body, { timeout: 180000 });
    data = await res.json();
  } catch (err) {
    // Some compatible servers reject response_format; retry without it.
    if (err?.status === 400) {
      const res = await postJson(provider, '/images/generations', { model, prompt, n: body.n, size }, { timeout: 180000 });
      data = await res.json();
    } else throw err;
  }
  const entries = Array.isArray(data.data) ? data.data : [];
  if (!entries.length) throw new ProviderError(data.error?.message || 'No images returned', 502);
  const images = [];
  for (const entry of entries) images.push(await bufferFromResult(entry));
  return images;
}

export async function editImage(provider, { prompt, model, size, image, mime, mask }) {
  if (!provider) throw new ProviderError('No image provider is configured', 400);
  if (provider.type === 'ollama') throw new ProviderError('Ollama does not edit images.', 400);
  const form = new FormData();
  form.set('model', model || 'gpt-image-1');
  form.set('prompt', prompt);
  if (size) form.set('size', size);
  form.set('image', new Blob([image], { type: mime || 'image/png' }), 'image.png');
  if (mask) form.set('mask', new Blob([mask], { type: 'image/png' }), 'mask.png');
  const res = await fetch(joinUrl(provider.baseUrl, '/images/edits'), {
    method: 'POST',
    headers: providerHeaders(provider),
    body: form,
    signal: timeoutSignal(180000),
  });
  if (!res.ok) throw await errorFromResponse(res);
  const data = await res.json();
  const entries = Array.isArray(data.data) ? data.data : [];
  if (!entries.length) throw new ProviderError('No edited image returned', 502);
  const images = [];
  for (const entry of entries) images.push(await bufferFromResult(entry));
  return images;
}

/* ------------------------------------------------------------------------- */
/* Embeddings, speech and search                                             */
/* ------------------------------------------------------------------------- */

export async function embedTexts(provider, { model, texts }) {
  if (!provider) throw new ProviderError('No embedding provider configured', 400);
  if (provider.type === 'ollama') {
    try {
      const res = await postJson(provider, '/api/embed', { model, input: texts }, { timeout: 120000 });
      const json = await res.json();
      if (Array.isArray(json.embeddings)) return json.embeddings;
    } catch { /* fall back to the single-prompt endpoint */ }
    const out = [];
    for (const text of texts) {
      const res = await postJson(provider, '/api/embeddings', { model, prompt: text }, { timeout: 120000 });
      const json = await res.json();
      if (!Array.isArray(json.embedding)) throw new ProviderError('Ollama returned no embedding', 502);
      out.push(json.embedding);
    }
    return out;
  }
  const res = await postJson(provider, '/embeddings', { model, input: texts }, { timeout: 120000 });
  const json = await res.json();
  const rows = Array.isArray(json.data) ? json.data : [];
  if (rows.length !== texts.length) throw new ProviderError('Embedding count mismatch', 502);
  return rows.sort((a, b) => (a.index || 0) - (b.index || 0)).map((row) => row.embedding);
}

export async function synthesizeSpeech(provider, { model, voice, input, format = 'mp3' }) {
  if (!provider || !resolveApiKey(provider)) throw new ProviderError('No speech provider configured', 400);
  if (provider.type === 'ollama') throw new ProviderError('Ollama has no speech endpoint.', 400);
  const res = await postJson(provider, '/audio/speech', { model, voice, input: input.slice(0, 4000), response_format: format }, { timeout: 120000 });
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = format === 'wav' ? 'audio/wav' : format === 'opus' ? 'audio/ogg' : 'audio/mpeg';
  return { buffer, mime };
}

export async function searchWeb(settings, query) {
  const config = settings?.search || {};
  if (config.provider === 'none' || !config.provider) return { provider: 'none', results: [] };
  const count = Math.max(1, Math.min(10, Number(config.results) || 5));
  if (config.provider === 'tavily') {
    const key = config.apiKey || process.env.TAVILY_API_KEY;
    if (!key) throw new ProviderError('Tavily search requires an API key', 400);
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, query, max_results: count, include_answer: false }),
      signal: timeoutSignal(30000),
    });
    if (!res.ok) throw await errorFromResponse(res);
    const json = await res.json();
    return { provider: 'tavily', results: (json.results || []).map((r) => ({ title: r.title, url: r.url, snippet: r.content })) };
  }
  if (config.provider === 'searxng') {
    if (!config.endpoint) throw new ProviderError('SearXNG endpoint is not configured', 400);
    const url = new URL(`${config.endpoint.replace(/\/+$/, '')}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('count', String(count));
    const res = await fetch(url, { signal: timeoutSignal(30000) });
    if (!res.ok) throw await errorFromResponse(res);
    const json = await res.json();
    return { provider: 'searxng', results: (json.results || []).slice(0, count).map((r) => ({ title: r.title, url: r.url, snippet: r.content })) };
  }
  return { provider: config.provider, results: [] };
}
