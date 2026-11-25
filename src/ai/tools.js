/* Tool layer for Cascade AI.
 *
 * The built-in tools are the same implementations served at /mcp, so assistants
 * can create and edit every Cascade document type. External MCP servers are
 * discovered over Streamable HTTP and exposed with a `server__tool` prefix.
 * Destructive tools are never executed without an explicit confirmation. */
import { invokeMcpTool, mcpTools } from '../mcp.js';
import { findProvider } from './config.js';
import { generateImages } from './providers.js';
import { saveGeneratedFile, fileJson } from './files.js';

export const DESTRUCTIVE_TOOLS = new Set(['delete_document', 'studio_queue_command']);
const externalCache = new Map();
const EXTERNAL_TTL = 60000;

function slug(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'mcp';
}

function aiOnlySpecs() {
  return [
    {
      type: 'function',
      function: {
        name: 'cascade_generate_image',
        description: 'Generate an image with the configured image provider and save it into Cascade Files. Returns file URLs. Use this when the user asks to create, draw or illustrate an image.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'Detailed image prompt' },
            size: { type: 'string', description: 'WxH, e.g. 1024x1024, 1536x1024, 1024x1536' },
            count: { type: 'integer', minimum: 1, maximum: 4 },
          },
          required: ['prompt'],
          additionalProperties: false,
        },
      },
    },
  ];
}

export function builtinToolSpecs() {
  return [
    ...mcpTools.map((tool) => ({
      type: 'function',
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    })),
    ...aiOnlySpecs(),
  ];
}

/* ------------------------------------------------------------------------- */
/* External MCP servers                                                      */
/* ------------------------------------------------------------------------- */

function serverHeaders(server) {
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' };
  if (server.token) headers.authorization = `Bearer ${server.token}`;
  return headers;
}

function parseRpcResponse(text, id) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  try {
    const json = JSON.parse(trimmed);
    if (Array.isArray(json)) return json.find((item) => item.id === id) || json[0];
    return json;
  } catch { /* SSE below */ }
  const messages = [];
  for (const line of trimmed.split('\n')) {
    const value = line.trim();
    if (!value.startsWith('data:')) continue;
    try { messages.push(JSON.parse(value.slice(5).trim())); } catch { /* ignore */ }
  }
  return messages.find((item) => item.id === id) || messages[messages.length - 1] || null;
}

async function rpc(server, method, params, id = 1) {
  const res = await fetch(server.url, {
    method: 'POST',
    headers: serverHeaders(server),
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`MCP ${server.name} responded ${res.status}`);
  const text = await res.text();
  const json = parseRpcResponse(text, id);
  if (!json) throw new Error(`MCP ${server.name} returned no response`);
  if (json.error) throw new Error(json.error.message || `MCP ${server.name} error`);
  return json.result;
}

async function notify(server, method, params) {
  try {
    await fetch(server.url, {
      method: 'POST',
      headers: serverHeaders(server),
      body: JSON.stringify({ jsonrpc: '2.0', method, params }),
      signal: AbortSignal.timeout(10000),
    });
  } catch { /* notifications are best effort */ }
}

export async function listExternalTools(server) {
  const cached = externalCache.get(server.url);
  if (cached && Date.now() - cached.at < EXTERNAL_TTL) return cached.tools;
  const init = await rpc(server, 'initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'cascade-ai', version: '1.0.0' },
  }, 1);
  await notify(server, 'notifications/initialized', {});
  const list = await rpc(server, 'tools/list', {}, 2);
  const prefix = slug(server.name || server.id);
  const tools = (list?.tools || []).map((tool) => ({
    name: `${prefix}__${tool.name}`,
    description: tool.description || '',
    inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    serverId: server.id,
    originalName: tool.name,
    external: true,
    version: init?.serverInfo?.version || '',
  }));
  externalCache.set(server.url, { tools, at: Date.now() });
  return tools;
}

export async function allToolSpecs(settings) {
  const specs = builtinToolSpecs();
  const failures = [];
  for (const server of settings.mcpServers || []) {
    if (!server.enabled) continue;
    try {
      const tools = await listExternalTools(server);
      for (const tool of tools) {
        specs.push({
          type: 'function',
          function: { name: tool.name, description: `[${server.name}] ${tool.description}`.slice(0, 1000), parameters: tool.inputSchema },
        });
      }
    } catch (err) {
      failures.push(`${server.name}: ${err.message}`);
    }
  }
  return { specs, failures };
}

function findExternal(settings, name) {
  const index = name.indexOf('__');
  if (index < 0) return null;
  const prefix = name.slice(0, index);
  const original = name.slice(index + 2);
  for (const server of settings.mcpServers || []) {
    if (slug(server.name || server.id) === prefix && server.enabled) return { server, original };
  }
  return null;
}

/* ------------------------------------------------------------------------- */
/* Execution                                                                 */
/* ------------------------------------------------------------------------- */

function normalizeToolResult(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') || '';
  let data = null;
  try { data = JSON.parse(text); } catch { /* plain text result */ }
  return { text, data, isError: !!result?.isError };
}

export function isDestructiveTool(name) {
  if (DESTRUCTIVE_TOOLS.has(name)) return true;
  return false;
}

export async function executeTool(settings, user, name, args, req = null) {
  if (name === 'cascade_generate_image') {
    return executeImageTool(settings, user, args);
  }
  const external = findExternal(settings, name);
  if (external) {
    const result = await rpc(external.server, 'tools/call', { name: external.original, arguments: args || {} }, 3);
    return { ...normalizeToolResult(result), server: external.server.name };
  }
  const result = await invokeMcpTool(name, args || {}, user, 'full', req);
  return { ...normalizeToolResult(result), server: 'Cascade' };
}

async function executeImageTool(settings, user, args) {
  const providerId = settings.image?.providerId || settings.defaultProviderId;
  const provider = findProvider(settings, providerId);
  if (!provider) return { text: 'No image provider is configured.', data: null, isError: true, server: 'Cascade' };
  const model = settings.image?.model || (provider.models || []).find((m) => m.image)?.id;
  if (!model) return { text: 'No image model is configured. Add one in Admin → Cascade AI.', data: null, isError: true, server: 'Cascade' };
  const images = await generateImages(provider, {
    prompt: String(args.prompt || '').slice(0, 2000),
    model,
    size: String(args.size || settings.image.size || '1024x1024'),
    quality: settings.image.quality,
    count: Math.max(1, Math.min(4, Number(args.count) || 1)),
  });
  const saved = [];
  for (let i = 0; i < images.length; i += 1) {
    const ext = images[i].mime === 'image/jpeg' ? 'jpg' : images[i].mime === 'image/webp' ? 'webp' : 'png';
    const record = await saveGeneratedFile(user, images[i].buffer, {
      filename: `cascade-ai-${Date.now()}-${i + 1}.${ext}`,
      mime: images[i].mime,
      source: 'cascade-ai-image',
    });
    saved.push(fileJson(record));
  }
  return {
    text: `Generated ${saved.length} image${saved.length === 1 ? '' : 's'} and saved them to Cascade Files.`,
    data: { images: saved },
    isError: false,
    server: 'Cascade',
  };
}
