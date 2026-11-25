/* Cascade AI configuration.
 *
 * Provider credentials live only in this settings object (SQLite, server side)
 * or in environment variables. `publicAiSettings()` is the only shape that is
 * ever sent to a browser: it strips keys and reports `hasKey` instead. */

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OLLAMA_BASE = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';

const PROVIDER_TYPES = new Set(['openai', 'compatible', 'ollama']);
const SEARCH_PROVIDERS = new Set(['none', 'searxng', 'tavily']);
export const THINKING_MODES = new Set(['auto', 'on', 'off']);
export const EFFORT_LEVELS = new Set(['auto', 'low', 'medium', 'high']);

function text(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

export function normalizeBaseUrl(value) {
  const raw = text(value, 500).replace(/\/+$/, '');
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

function normalizeModel(model) {
  if (!model) return null;
  if (typeof model === 'string') {
    const id = text(model, 160);
    return id ? { id, label: id, vision: false, tools: true, image: false } : null;
  }
  const id = text(model.id, 160);
  if (!id) return null;
  return {
    id,
    label: text(model.label || id, 160),
    contextWindow: Math.max(0, Number(model.contextWindow) || 0),
    vision: !!model.vision,
    tools: model.tools !== false,
    image: !!model.image,
  };
}

function normalizeProvider(provider, index) {
  if (!provider || typeof provider !== 'object') return null;
  const id = text(provider.id, 48).toLowerCase().replace(/[^a-z0-9_-]/g, '-') || `provider-${index + 1}`;
  const type = PROVIDER_TYPES.has(provider.type) ? provider.type : 'compatible';
  const models = Array.isArray(provider.models) ? provider.models.map(normalizeModel).filter(Boolean).slice(0, 200) : [];
  return {
    id,
    name: text(provider.name || id, 80) || id,
    type,
    baseUrl: normalizeBaseUrl(provider.baseUrl) || (type === 'ollama' ? OLLAMA_BASE : OPENAI_BASE),
    apiKey: text(provider.apiKey, 400),
    apiKeyEnv: text(provider.apiKeyEnv, 80),
    headers: provider.headers && typeof provider.headers === 'object' && !Array.isArray(provider.headers)
      ? Object.fromEntries(Object.entries(provider.headers).slice(0, 20).map(([k, v]) => [text(k, 80), text(v, 500)]).filter(([k]) => k))
      : {},
    enabled: provider.enabled !== false,
    discovery: provider.discovery !== false,
    models,
  };
}

export function normalizeThinking(value) {
  const mode = text(value, 8).toLowerCase();
  return THINKING_MODES.has(mode) ? mode : 'auto';
}

export function normalizeEffort(value) {
  const level = text(value, 8).toLowerCase();
  return EFFORT_LEVELS.has(level) ? level : 'auto';
}

/* MCP servers are configured globally by an administrator and, separately, by
 * each user. Keeping one normalizer means personal tokens obey the same URL and
 * length limits as the shared configuration. */
export function normalizeMcpServers(raw, limit = 8) {
  return (Array.isArray(raw) ? raw : [])
    .map((server, index) => {
      if (!server || typeof server !== 'object') return null;
      const url = normalizeBaseUrl(server.url);
      if (!url) return null;
      return {
        id: text(server.id, 48) || `mcp-${index + 1}`,
        name: text(server.name || `MCP ${index + 1}`, 80),
        url,
        token: text(server.token, 500),
        enabled: server.enabled !== false,
      };
    })
    .filter(Boolean)
    .slice(0, Math.max(1, limit));
}

export function publicUserConfig(config) {
  return {
    thinking: normalizeThinking(config?.thinking),
    effort: normalizeEffort(config?.effort),
    mcpServers: (config?.mcpServers || []).map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      enabled: server.enabled !== false,
      hasToken: !!server.token,
      scope: 'personal',
    })),
  };
}

export function defaultAiSettings() {
  return {
    enabled: true,
    systemPrompt: [
      'You are Cascade AI, the assistant built into this Cascade workspace.',
      'Be concise and concrete. Use Markdown; use fenced code blocks with a language tag.',
      'When the user asks for a document, deck, sheet, website, game, flow or video project, call the matching Cascade tool instead of pasting the whole file into chat, then tell the user which editor it opened in.',
      'Never invent tool results. If no provider key is configured, explain that an administrator must add one.',
    ].join(' '),
    providers: [
      {
        id: 'openai',
        name: 'OpenAI',
        type: 'openai',
        baseUrl: OPENAI_BASE,
        apiKey: '',
        apiKeyEnv: 'OPENAI_API_KEY',
        headers: {},
        enabled: !!process.env.OPENAI_API_KEY,
        discovery: true,
        models: [],
      },
      {
        id: 'ollama',
        name: 'Ollama',
        type: 'ollama',
        baseUrl: OLLAMA_BASE,
        apiKey: '',
        apiKeyEnv: '',
        headers: {},
        enabled: false,
        discovery: true,
        models: [],
      },
    ],
    defaultProviderId: process.env.OPENAI_API_KEY ? 'openai' : '',
    defaultModel: process.env.AI_DEFAULT_MODEL || '',
    image: { providerId: '', model: '', size: '1024x1024', quality: 'auto', count: 1, editModel: '' },
    speech: { providerId: '', model: 'tts-1', voice: 'alloy', format: 'mp3' },
    search: { provider: 'none', endpoint: '', apiKey: '', results: 5 },
    embedding: { providerId: '', model: '', localDimensions: 256 },
    limits: {
      maxTokens: 4096,
      dailyTokens: 250000,
      maxMessagesPerConversation: 400,
      maxAttachmentBytes: 20 * 1024 * 1024,
      maxKnowledgeDocumentBytes: 5 * 1024 * 1024,
      maxKnowledgeDocuments: 200,
      maxToolIterations: 6,
    },
    mcpServers: [],
    confirmDestructive: true,
  };
}

export function normalizeAiSettings(raw) {
  const base = defaultAiSettings();
  // SQLite stores JSON columns as TEXT; tolerate either a parsed object or a
  // JSON string so settings survive a restart without silently resetting.
  let source = raw;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = {}; }
  }
  const input = source && typeof source === 'object' && !Array.isArray(source) ? source : {};
  const providers = (Array.isArray(input.providers) ? input.providers : base.providers)
    .map(normalizeProvider)
    .filter(Boolean)
    .slice(0, 12);
  if (!providers.length) providers.push(...defaultAiSettings().providers);
  const limits = { ...base.limits, ...(input.limits || {}) };
  const int = (value, fallback, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  };
  const image = { ...base.image, ...(input.image || {}) };
  const speech = { ...base.speech, ...(input.speech || {}) };
  const search = { ...base.search, ...(input.search || {}) };
  const embedding = { ...base.embedding, ...(input.embedding || {}) };
  return {
    enabled: input.enabled !== false,
    systemPrompt: text(input.systemPrompt || base.systemPrompt, 6000) || base.systemPrompt,
    providers,
    defaultProviderId: text(input.defaultProviderId, 48),
    defaultModel: text(input.defaultModel, 160),
    image: {
      providerId: text(image.providerId, 48),
      model: text(image.model, 160),
      size: text(image.size, 32) || '1024x1024',
      quality: text(image.quality, 24) || 'auto',
      count: int(image.count, 1, 1, 4),
      editModel: text(image.editModel, 160),
    },
    speech: {
      providerId: text(speech.providerId, 48),
      model: text(speech.model, 160) || 'tts-1',
      voice: text(speech.voice, 80) || 'alloy',
      format: text(speech.format, 16) || 'mp3',
    },
    search: {
      provider: SEARCH_PROVIDERS.has(search.provider) ? search.provider : 'none',
      endpoint: normalizeBaseUrl(search.endpoint),
      apiKey: text(search.apiKey, 300),
      results: int(search.results, 5, 1, 10),
    },
    embedding: {
      providerId: text(embedding.providerId, 48),
      model: text(embedding.model, 160),
      localDimensions: int(embedding.localDimensions, 256, 32, 1024),
    },
    limits: {
      maxTokens: int(limits.maxTokens, 4096, 64, 200000),
      dailyTokens: int(limits.dailyTokens, 250000, 0, 100000000),
      maxMessagesPerConversation: int(limits.maxMessagesPerConversation, 400, 2, 5000),
      maxAttachmentBytes: int(limits.maxAttachmentBytes, 20 * 1024 * 1024, 64 * 1024, 100 * 1024 * 1024),
      maxKnowledgeDocumentBytes: int(limits.maxKnowledgeDocumentBytes, 5 * 1024 * 1024, 4096, 50 * 1024 * 1024),
      maxKnowledgeDocuments: int(limits.maxKnowledgeDocuments, 200, 1, 5000),
      maxToolIterations: int(limits.maxToolIterations, 6, 1, 12),
    },
    mcpServers: normalizeMcpServers(input.mcpServers, 8),
    confirmDestructive: input.confirmDestructive !== false,
  };
}

export function publicAiSettings(settings) {
  const s = settings || defaultAiSettings();
  return {
    enabled: s.enabled,
    defaultProviderId: s.defaultProviderId,
    defaultModel: s.defaultModel,
    providers: s.providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      enabled: p.enabled,
      hasKey: !!resolveApiKey(p),
      models: p.models,
      discovery: p.discovery,
    })),
    image: { ...s.image, hasProvider: !!(s.image.providerId || s.providers.some((p) => p.enabled && resolveApiKey(p))) },
    speech: { ...s.speech },
    search: { provider: s.search.provider, results: s.search.results },
    limits: s.limits,
    confirmDestructive: s.confirmDestructive,
    mcpServers: s.mcpServers.map((m) => ({ id: m.id, name: m.name, enabled: m.enabled })),
  };
}

export function resolveApiKey(provider) {
  if (!provider) return '';
  if (provider.apiKey) return provider.apiKey;
  if (provider.apiKeyEnv && process.env[provider.apiKeyEnv]) return process.env[provider.apiKeyEnv];
  if (provider.type === 'openai' && process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  return '';
}

export function findProvider(settings, providerId) {
  const list = settings.providers || [];
  return list.find((p) => p.id === providerId) || list.find((p) => p.enabled && resolveApiKey(p)) || list.find((p) => p.enabled) || null;
}

export function providerHeaders(provider, extra = {}) {
  const headers = { ...(provider.headers || {}), ...extra };
  const key = resolveApiKey(provider);
  if (key && !headers.authorization && !headers.Authorization) headers.authorization = `Bearer ${key}`;
  return headers;
}
