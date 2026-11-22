import express from 'express';
import { nanoid } from 'nanoid';
import { Op } from 'sequelize';
import { FileRecord, DocVersion, Folder, Template } from './db.js';
import { KIND_BY_ID, buildContent } from './templates.js';
import { buildPdfTemplate } from './pdfTemplates.js';
import { recordEvent } from './analytics.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_CONTENT = 12 * 1024 * 1024;
const MAX_LIMIT = 100;
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = new Set([PROTOCOL_VERSION, '2025-03-26', '2025-11-25']);
const READ_TOOLS = new Set(['whoami', 'list_documents', 'get_document', 'list_versions', 'get_version']);

class ToolError extends Error {}
class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function canAccess(file, user) {
  return !!user && (user.role === 'admin' || file.ownerId === user.id);
}

function parseContent(file) {
  try {
    return JSON.parse(file.content || '{}');
  } catch {
    return {};
  }
}

function defaultName(kind) {
  const label = KIND_BY_ID.get(kind)?.label || 'Document';
  return `${label} ${new Date().toISOString().slice(0, 10)}`;
}

function assertContentObject(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new ToolError('content must be a JSON object');
  }
}

function serializedSize(content) {
  assertContentObject(content);
  let serialized;
  try {
    serialized = JSON.stringify(content);
  } catch {
    throw new ToolError('content must be JSON serializable');
  }
  if (Buffer.byteLength(serialized) > MAX_CONTENT) throw new ToolError('document content is too large');
  return serialized;
}

function parseTemplateContent(tpl) {
  try {
    const content = JSON.parse(tpl.content);
    assertContentObject(content);
    return content;
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError('template content is invalid');
  }
}

function docMeta(file) {
  return {
    id: file.id,
    filename: file.filename,
    kind: file.kind,
    version: Number(file.version) || 0,
    isPublic: !!file.isPublic,
    folderId: file.folderId || null,
    updatedAt: file.updatedAt,
    createdAt: file.createdAt,
    url: `/edit/${file.id}`,
    exportUrl: `/export/${file.id}`,
  };
}

async function loadDoc(id, user) {
  if (typeof id !== 'string' || !id.trim()) throw new ToolError('id is required');
  const file = await FileRecord.findByPk(id.trim());
  // A foreign id and a nonexistent id intentionally have the same result.
  if (!file || file.kind === 'file' || !canAccess(file, user)) throw new ToolError('document not found');
  return file;
}

async function snapshot(file, userId) {
  await DocVersion.create({
    fileId: file.id,
    version: file.version,
    content: file.content || '{}',
    createdBy: userId || null,
  });
  const old = await DocVersion.findAll({
    where: { fileId: file.id },
    order: [['id', 'DESC']],
    offset: 25,
    attributes: ['id'],
  });
  if (old.length) await DocVersion.destroy({ where: { id: { [Op.in]: old.map((o) => o.id) } } });
}

function clampLimit(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : 50;
}

function contentFor(kind, templateId) {
  if (templateId) {
    if (String(templateId).startsWith('custom:')) return null;
    return kind === 'pdf' ? buildPdfTemplate(String(templateId)) : buildContent(String(templateId), kind);
  }
  return kind === 'pdf' ? buildPdfTemplate('pdf-blank') : buildContent(null, kind);
}

const tools = [
  {
    name: 'whoami',
    description: 'Return the authenticated Cascade user and API-key scope. Never returns key material.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'list_documents',
    description: 'List workspace documents owned by the authenticated user. Does not return blobs.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: [...KIND_BY_ID.keys()] },
        folderId: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
      },
    },
  },
  {
    name: 'get_document',
    description: 'Read a workspace document and its editor JSON. Only the owner (or an admin) can read it.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
    },
  },
  {
    name: 'list_versions',
    description: 'List saved versions of an owned workspace document.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1 } },
      required: ['id'],
    },
  },
  {
    name: 'get_version',
    description: 'Read one saved version of an owned workspace document.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'string', minLength: 1 }, version: { type: 'integer', minimum: 1 } },
      required: ['id', 'version'],
    },
  },
  {
    name: 'create_document',
    description: 'Create a doc, sheet, deck, pdf, board, form, or code workspace document owned by the caller.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        kind: { type: 'string', enum: [...KIND_BY_ID.keys()] },
        name: { type: 'string', maxLength: 120 },
        templateId: { type: 'string' },
        folderId: { type: 'string' },
        isPublic: { type: 'boolean' },
        content: { type: 'object' },
      },
      required: ['kind'],
    },
  },
  {
    name: 'update_document',
    description: 'Replace an owned document editor JSON with optimistic version checking and version history.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        content: { type: 'object' },
        version: { type: 'integer', minimum: 1 },
        force: { type: 'boolean' },
      },
      required: ['id', 'content'],
    },
  },
];

const toolByName = new Map(tools.map((tool) => [tool.name, tool]));

function textResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  };
}

function errorResult(message) {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  };
}

async function callTool(name, args, ctx) {
  const tool = toolByName.get(name);
  if (!tool) throw new ProtocolError(-32602, 'unknown tool');
  if (ctx.apiKey?.scope === 'read' && !READ_TOOLS.has(name)) {
    return errorResult('API key scope is read-only');
  }
  const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
  if (tool.inputSchema.required && !tool.inputSchema.required.every((key) => key in input)) {
    return errorResult(`missing required argument: ${tool.inputSchema.required.find((key) => !(key in input))}`);
  }

  try {
    if (name === 'whoami') {
      return textResult({
        user: ctx.user,
        auth: ctx.apiKey ? 'api-key' : 'session',
        scope: ctx.apiKey?.scope || 'full',
      });
    }

    if (name === 'list_documents') {
      if (input.kind && !KIND_BY_ID.has(input.kind)) return errorResult('unknown document kind');
      if (input.folderId) {
        const folder = await Folder.findOne({ where: { id: String(input.folderId), ownerId: ctx.user.id } });
        if (!folder) return errorResult('folder not found');
      }
      const where = { ownerId: ctx.user.id, kind: { [Op.ne]: 'file' } };
      if (input.kind) where.kind = input.kind;
      if (input.folderId) where.folderId = String(input.folderId);
      const files = await FileRecord.findAll({
        where,
        order: [['updatedAt', 'DESC']],
        limit: clampLimit(input.limit),
        attributes: ['id', 'filename', 'kind', 'version', 'isPublic', 'folderId', 'updatedAt', 'createdAt'],
      });
      return textResult({ documents: files.map(docMeta) });
    }

    if (name === 'get_document') {
      const file = await loadDoc(input.id, ctx.user);
      return textResult({ document: { ...docMeta(file), content: parseContent(file) } });
    }

    if (name === 'list_versions') {
      const file = await loadDoc(input.id, ctx.user);
      const versions = await DocVersion.findAll({
        where: { fileId: file.id },
        order: [['id', 'DESC']],
        limit: 25,
        attributes: ['version', 'createdAt', 'createdBy'],
      });
      return textResult({ id: file.id, current: file.version, versions });
    }

    if (name === 'get_version') {
      const file = await loadDoc(input.id, ctx.user);
      const version = Number(input.version);
      if (!Number.isInteger(version) || version < 1) return errorResult('version must be a positive integer');
      const snap = await DocVersion.findOne({
        where: { fileId: file.id, version },
        order: [['id', 'DESC']],
      });
      if (!snap) return errorResult('version not found');
      let content;
      try {
        content = JSON.parse(snap.content);
      } catch {
        return errorResult('version is not valid JSON');
      }
      return textResult({ id: file.id, version: snap.version, content });
    }

    if (name === 'create_document') {
      const kind = String(input.kind || '');
      if (!KIND_BY_ID.has(kind)) return errorResult('unknown document kind');
      if (input.isPublic !== undefined && typeof input.isPublic !== 'boolean') return errorResult('isPublic must be a boolean');
      let folder = null;
      if (input.folderId) {
        folder = await Folder.findOne({ where: { id: String(input.folderId), ownerId: ctx.user.id } });
        if (!folder) return errorResult('folder not found');
      }
      let content;
      if (input.content !== undefined) {
        content = input.content;
        serializedSize(content);
      } else if (input.templateId && String(input.templateId).startsWith('custom:')) {
        const tpl = await Template.findByPk(String(input.templateId).slice(7));
        if (!tpl || tpl.ownerId !== ctx.user.id || tpl.kind !== kind) return errorResult('template not found');
        content = parseTemplateContent(tpl);
      } else {
        content = await contentFor(kind, input.templateId);
      }
      if (!content) content = kind === 'pdf' ? await buildPdfTemplate('pdf-blank') : buildContent(null, kind);
      const serialized = serializedSize(content);
      const name = String(input.name || '').trim().slice(0, 120) || defaultName(kind);
      const file = await FileRecord.create({
        id: nanoid(12),
        slug: nanoid(10),
        filename: name,
        mime: `application/x-cascade-${kind}`,
        size: Buffer.byteLength(serialized),
        ownerId: ctx.user.id,
        ownerName: ctx.user.username,
        isPublic: input.isPublic === true,
        replicas: [],
        content: serialized,
        kind,
        folderId: folder ? folder.id : null,
        template: input.templateId ? String(input.templateId) : null,
        version: 1,
      });
      await snapshot(file, ctx.user.id);
      recordEvent(ctx.req, 'create', { fileId: file.id });
      return textResult({ document: docMeta(file) });
    }

    if (name === 'update_document') {
      const file = await loadDoc(input.id, ctx.user);
      assertContentObject(input.content);
      const serialized = serializedSize(input.content);
      const incomingVersion = Number(input.version) || 0;
      if (!input.force && incomingVersion && incomingVersion !== file.version) {
        return errorResult(`version conflict: current version is ${file.version}`);
      }
      const changed = serialized !== (file.content || '');
      if (changed) {
        await snapshot(file, ctx.user.id);
        await file.update({
          content: serialized,
          size: Buffer.byteLength(serialized),
          version: file.version + 1,
          updatedAt: new Date(),
        });
        recordEvent(ctx.req, 'edit', { fileId: file.id });
      }
      return textResult({ id: file.id, version: file.version, changed });
    }

    return errorResult('tool not implemented');
  } catch (err) {
    if (err instanceof ToolError) return errorResult(err.message);
    console.error('[cascade-mcp] tool failure:', err?.message || 'unknown error');
    return errorResult('tool failed');
  }
}

function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

async function handleMessage(message, ctx) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return jsonRpcError(message?.id, -32600, 'invalid JSON-RPC request');
  }

  const isNotification = message.id === undefined;
  const { method } = message;
  const params = message.params && typeof message.params === 'object' && !Array.isArray(message.params) ? message.params : {};

  if (isNotification) {
    // `notifications/initialized` and cancellation notifications have no response.
    return null;
  }

  try {
    if (method === 'initialize') {
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
      return jsonRpcResult(message.id, {
        protocolVersion: SUPPORTED_VERSIONS.has(requested) ? requested : PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: { name: 'cascade-workspace', version: '1.0.0' },
        instructions: 'Use your Cascade API key. Every tool is scoped to the key owner; use list_documents before get_document or update_document.',
      });
    }

    if (method === 'ping') return jsonRpcResult(message.id, {});

    if (method === 'tools/list') {
      const visible = tools.filter((tool) => !ctx.apiKey || ctx.apiKey.scope !== 'read' || READ_TOOLS.has(tool.name));
      return jsonRpcResult(message.id, { tools: visible });
    }

    if (method === 'tools/call') {
      const name = String(params.name || '');
      if (!name) return jsonRpcError(message.id, -32602, 'tool name is required');
      const result = await callTool(name, params.arguments, ctx);
      return jsonRpcResult(message.id, result);
    }

    if (method === 'resources/list') {
      const files = await FileRecord.findAll({
        where: { ownerId: ctx.user.id, kind: { [Op.ne]: 'file' } },
        order: [['updatedAt', 'DESC']],
        limit: 50,
        attributes: ['id', 'filename', 'kind', 'version', 'updatedAt'],
      });
      return jsonRpcResult(message.id, {
        resources: files.map((file) => ({
          uri: `cascade://documents/${file.id}`,
          name: file.filename,
          description: `${file.kind} document, version ${file.version}`,
          mimeType: 'application/json',
        })),
      });
    }

    if (method === 'resources/read') {
      const uri = String(params.uri || '');
      const match = /^cascade:\/\/documents\/([A-Za-z0-9_-]+)$/.exec(uri);
      if (!match) return jsonRpcError(message.id, -32602, 'unsupported resource URI');
      const file = await loadDoc(match[1], ctx.user);
      const text = JSON.stringify({ ...docMeta(file), content: parseContent(file) }, null, 2);
      return jsonRpcResult(message.id, {
        contents: [{ uri, mimeType: 'application/json', text }],
      });
    }

    return jsonRpcError(message.id, -32601, 'method not found');
  } catch (err) {
    if (err instanceof ProtocolError) return jsonRpcError(message.id, err.code, err.message);
    if (err instanceof ToolError) return jsonRpcResult(message.id, errorResult(err.message));
    console.error('[cascade-mcp] request failure:', err?.message || 'unknown error');
    return jsonRpcError(message.id, -32603, 'internal error');
  }
}

function requireMcpAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'login required' });
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

export function createMcpRouter() {
  const router = express.Router();

  router.get('/', requireMcpAuth, (req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'MCP uses Streamable HTTP POST requests' });
  });

  router.post('/', requireMcpAuth, wrap(async (req, res) => {
    const body = req.body;
    if (body === undefined || body === null) {
      return res.status(400).json(jsonRpcError(null, -32700, 'parse error'));
    }
    const ctx = { user: req.user, apiKey: req.apiKey, req };
    const messages = Array.isArray(body) ? body : [body];
    try {
      const responses = [];
      for (const message of messages) {
        const response = await handleMessage(message, ctx);
        if (response) responses.push(response);
      }
      if (!responses.length) return res.status(202).end();
      return res.status(200).json(Array.isArray(body) ? responses : responses[0]);
    } catch (err) {
      console.error('[cascade-mcp] transport failure:', err?.message || 'unknown error');
      return res.status(500).json(jsonRpcError(null, -32603, 'internal error'));
    }
  }));

  router.delete('/', requireMcpAuth, (req, res) => {
    res.setHeader('Allow', 'POST');
    res.status(405).json({ error: 'MCP is stateless; there is no session to delete' });
  });

  return router;
}
