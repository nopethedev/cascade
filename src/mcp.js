import express from 'express';
import { nanoid } from 'nanoid';
import { Op } from 'sequelize';
import { FileRecord, DocVersion, Folder, Template, FormResponse, StudioCommand, StudioSnapshot, sequelize } from './db.js';
import { validateCommand, applyCommandToContent } from './studio.js';
import { KIND_BY_ID, TEMPLATES, buildContent } from './templates.js';
import { buildPdfTemplate } from './pdfTemplates.js';
import { recordEvent } from './analytics.js';

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const MAX_CONTENT = 12 * 1024 * 1024;
const MAX_LIMIT = 100;
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = new Set([PROTOCOL_VERSION, '2025-03-26', '2025-11-25']);
const READ_TOOLS = new Set([
  'whoami',
  'list_documents',
  'get_document',
  'list_versions',
  'get_version',
  'list_folders',
  'list_templates',
  'search_documents',
  'list_form_responses',
  'studio_list_projects',
  'studio_get_scene',
  'studio_list_commands',
]);

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
  // Editor JSON is shallow by design. Reject pathological nesting before
  // JSON.stringify or the database sees it; an iterative walk cannot blow the
  // JS stack on hostile input.
  const stack = [{ value: content, depth: 0 }];
  const seen = new WeakSet();
  while (stack.length) {
    const { value, depth } = stack.pop();
    if (depth > 100) throw new ToolError('content is too deeply nested');
    if (!value || typeof value !== 'object') continue;
    if (seen.has(value)) continue;
    seen.add(value);
    for (const child of Object.values(value)) {
      stack.push({ value: child, depth: depth + 1 });
    }
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
    starred: !!file.starred,
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
  // Creating a document already snapshots v1. Do not append the same
  // (fileId, version) again when its first edit snapshots the same revision.
  const existing = await DocVersion.findOne({
    where: { fileId: file.id, version: file.version },
    attributes: ['id'],
  });
  if (!existing) {
    await DocVersion.create({
      fileId: file.id,
      version: file.version,
      content: file.content || '{}',
      createdBy: userId || null,
    });
  }
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
  {
    name: 'list_folders',
    description: 'List folders owned by the caller, including how many documents each contains.',
    inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'create_folder',
    description: 'Create a folder for organizing the caller\'s workspace documents.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { name: { type: 'string', minLength: 1, maxLength: 80 } },
      required: ['name'],
    },
  },
  {
    name: 'update_document_metadata',
    description: 'Rename, star, move, or publish/share an owned document without replacing its content.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1, maxLength: 120 },
        folderId: { type: ['string', 'null'], maxLength: 36 },
        isPublic: { type: 'boolean' },
        starred: { type: 'boolean' },
      },
      required: ['id'],
    },
  },
  {
    name: 'restore_version',
    description: 'Restore an owned document to a saved version, creating a new current version.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        version: { type: 'integer', minimum: 1 },
      },
      required: ['id', 'version'],
    },
  },
  {
    name: 'duplicate_document',
    description: 'Copy an owned document into a new private document owned by the caller.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        name: { type: 'string', minLength: 1, maxLength: 120 },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_document',
    description: 'Permanently delete an owned document and its versions. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        confirm: { type: 'boolean' },
      },
      required: ['id', 'confirm'],
    },
  },
  {
    name: 'search_documents',
    description: 'Search the caller\'s owned document names and editor JSON, returning metadata and a plain-text snippet.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 100 },
        kind: { type: 'string', enum: [...KIND_BY_ID.keys()] },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_templates',
    description: 'List built-in and caller-owned custom templates. Use the returned id with create_document.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { kind: { type: 'string', enum: [...KIND_BY_ID.keys()] } },
    },
  },
  {
    name: 'studio_list_projects',
    description: 'List owned Roblox Studio projects with relay/session metadata. Use the returned id with studio_get_scene.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT } } },
  },
  {
    name: 'studio_get_scene',
    description: 'Read the current normalized scene snapshot of an owned Roblox project. The Studio plugin remains the authority for applying changes.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', minLength: 1 } }, required: ['id'] },
  },
  {
    name: 'studio_list_commands',
    description: 'List recent audited Studio commands for an owned project, including queued, applied and failed states.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', minLength: 1 }, limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT } }, required: ['id'] },
  },
  {
    name: 'studio_queue_command',
    description: 'Queue one supported Roblox change for the connected Studio plugin. Returns a preview when dry_run. Deletes require confirm:true. No arbitrary Luau is executed by the relay.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        kind: { type: 'string', enum: ['create', 'update', 'rename', 'reparent', 'delete', 'script', 'gui'] },
        payload: { type: 'object' },
        dry_run: { type: 'boolean' },
        confirm: { type: 'boolean' },
      },
      required: ['id', 'kind', 'payload'],
    },
  },
  {
    name: 'studio_create_snapshot',
    description: 'Create a labeled backup snapshot of an owned Roblox project before a batch of changes.',
    inputSchema: { type: 'object', additionalProperties: false, properties: { id: { type: 'string', minLength: 1 }, label: { type: 'string', maxLength: 160 } }, required: ['id'] },
  },
  {
    name: 'list_form_responses',
    description: 'Read submissions for an owned form document, including form field definitions. Response IP addresses are never returned.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', minLength: 1 },
        limit: { type: 'integer', minimum: 1, maximum: MAX_LIMIT },
        responseId: { type: 'integer', minimum: 1 },
      },
      required: ['id'],
    },
  },
];

function matchesSchemaType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

// MCP clients rely on the advertised inputSchema. Enforce it at the boundary
// instead of letting unknown properties and wrong JSON types reach handlers,
// where they could be coerced into a different operation than the caller saw.
export function validateToolInput(args, schema) {
  if (args === undefined) args = {};
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return 'arguments must be an object';
  const properties = schema?.properties || {};
  for (const required of schema?.required || []) {
    if (!(required in args)) return `missing required argument: ${required}`;
  }
  if (schema?.additionalProperties === false) {
    const unknown = Object.keys(args).find((key) => !(key in properties));
    if (unknown) return `unknown argument: ${unknown}`;
  }
  for (const [key, rule] of Object.entries(properties)) {
    if (!(key in args) || args[key] === undefined) continue;
    const value = args[key];
    const types = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
    if (types.length && !types.some((type) => matchesSchemaType(value, type))) {
      if (types.length === 1 && types[0] === 'object') return `${key} must be a JSON object`;
      const expected = types.map((type) => type === 'null' ? 'null' : `${['integer', 'object', 'array'].includes(type) ? 'an' : 'a'} ${type}`).join(' or ');
      return `${key} must be ${expected}`;
    }
    if (typeof value === 'string') {
      if (rule.minLength !== undefined && value.length < rule.minLength) return `${key} is too short`;
      if (rule.maxLength !== undefined && value.length > rule.maxLength) return `${key} is too long`;
    }
    if (typeof value === 'number') {
      if (rule.minimum !== undefined && value < rule.minimum) return `${key} is below the minimum`;
      // Upper bounds such as `limit` are deliberately clamped by the handlers
      // rather than rejected, so older clients asking for 1000 still get 100.
    }
    if (rule.enum && !rule.enum.includes(value)) return `${key} is not an allowed value`;
  }
  return null;
}

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
  const schemaError = validateToolInput(args, tool.inputSchema);
  if (schemaError) return errorResult(schemaError);
  const input = args || {};

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
        attributes: ['id', 'filename', 'kind', 'version', 'isPublic', 'starred', 'folderId', 'updatedAt', 'createdAt'],
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
        // Compare-and-swap on the version. A concurrent writer must lose its
        // stale write instead of silently replacing a newer revision.
        const expectedVersion = incomingVersion || file.version;
        const where = input.force ? { id: file.id } : { id: file.id, version: expectedVersion };
        const [affected] = await FileRecord.update(
          {
            content: serialized,
            size: Buffer.byteLength(serialized),
            version: sequelize.literal('version + 1'),
            updatedAt: new Date(),
          },
          { where },
        );
        if (!affected) {
          if (input.force) return errorResult('document not found');
          const latest = await FileRecord.findByPk(file.id, { attributes: ['version'] });
          if (!latest) return errorResult('document not found');
          return errorResult(`version conflict: current version is ${latest.version}`);
        }
        // The successful writer snapshots the previous revision. A losing
        // writer never reaches this point, so one stale update creates no
        // history entry or content change.
        await snapshot(file, ctx.user.id);
        await file.reload();
        recordEvent(ctx.req, 'edit', { fileId: file.id });
      }
      return textResult({ id: file.id, version: file.version, changed });
    }

    if (name === 'list_folders') {
      const folders = await Folder.findAll({
        where: { ownerId: ctx.user.id },
        order: [['createdAt', 'DESC']],
      });
      const counts = folders.length
        ? await FileRecord.findAll({
            where: {
              ownerId: ctx.user.id,
              kind: { [Op.ne]: 'file' },
              folderId: { [Op.in]: folders.map((folder) => folder.id) },
            },
            attributes: ['folderId', [sequelize.fn('COUNT', sequelize.col('id')), 'count']],
            group: ['folderId'],
            raw: true,
          })
        : [];
      const countByFolder = new Map(counts.map((row) => [row.folderId, Number(row.count)]));
      return textResult({
        folders: folders.map((folder) => ({
          id: folder.id,
          name: folder.name,
          documentCount: countByFolder.get(folder.id) || 0,
          createdAt: folder.createdAt,
        })),
      });
    }

    if (name === 'create_folder') {
      if (typeof input.name !== 'string') return errorResult('name must be a string');
      const folderName = input.name.trim().slice(0, 80);
      if (!folderName) return errorResult('name is required');
      const folder = await Folder.create({
        id: nanoid(12),
        name: folderName,
        ownerId: ctx.user.id,
      });
      return textResult({ folder: { id: folder.id, name: folder.name, createdAt: folder.createdAt } });
    }

    if (name === 'update_document_metadata') {
      const file = await loadDoc(input.id, ctx.user);
      const changes = {};
      if (input.name !== undefined) {
        if (typeof input.name !== 'string') return errorResult('name must be a string');
        const nextName = input.name.trim().slice(0, 120);
        if (!nextName) return errorResult('name cannot be empty');
        changes.filename = nextName;
      }
      if (input.isPublic !== undefined) {
        if (typeof input.isPublic !== 'boolean') return errorResult('isPublic must be a boolean');
        changes.isPublic = input.isPublic;
      }
      if (input.starred !== undefined) {
        if (typeof input.starred !== 'boolean') return errorResult('starred must be a boolean');
        changes.starred = input.starred;
      }
      if (input.folderId !== undefined) {
        if (input.folderId === null || input.folderId === '') {
          changes.folderId = null;
        } else {
          if (typeof input.folderId !== 'string') return errorResult('folderId must be a string or null');
          // For an admin acting on another owner's document, the destination
          // folder must still belong to that document's owner.
          const folder = await Folder.findOne({
            where: { id: input.folderId, ownerId: file.ownerId },
          });
          if (!folder) return errorResult('folder not found');
          changes.folderId = folder.id;
        }
      }
      if (!Object.keys(changes).length) return errorResult('no metadata changes');
      changes.updatedAt = new Date();
      await file.update(changes);
      recordEvent(ctx.req, 'edit', { fileId: file.id });
      return textResult({ document: docMeta(file), changed: true });
    }

    if (name === 'restore_version') {
      const file = await loadDoc(input.id, ctx.user);
      const version = Number(input.version);
      if (!Number.isInteger(version) || version < 1) return errorResult('version must be a positive integer');
      const snap = await DocVersion.findOne({
        where: { fileId: file.id, version },
        order: [['id', 'DESC']],
      });
      if (!snap) return errorResult('version not found');
      // A restore is a write like any other: do not let a concurrent update or
      // another restore be silently overwritten while this one loads history.
      const expectedVersion = file.version;
      const [affected] = await FileRecord.update(
        {
          content: snap.content,
          size: Buffer.byteLength(snap.content),
          version: sequelize.literal('version + 1'),
          updatedAt: new Date(),
        },
        { where: { id: file.id, version: expectedVersion } },
      );
      if (!affected) {
        const latest = await FileRecord.findByPk(file.id, { attributes: ['version'] });
        if (!latest) return errorResult('document not found');
        return errorResult(`version conflict: current version is ${latest.version}`);
      }
      await snapshot(file, ctx.user.id);
      await file.reload();
      recordEvent(ctx.req, 'edit', { fileId: file.id });
      return textResult({ id: file.id, restoredVersion: version, version: file.version });
    }

    if (name === 'duplicate_document') {
      const file = await loadDoc(input.id, ctx.user);
      const copyName = (String(input.name || '').trim().slice(0, 120) || `Copy of ${file.filename}`).slice(0, 120);
      const content = file.content || '{}';
      const copy = await FileRecord.create({
        id: nanoid(12),
        slug: nanoid(10),
        filename: copyName,
        mime: file.mime,
        size: Buffer.byteLength(content),
        ownerId: ctx.user.id,
        ownerName: ctx.user.username,
        isPublic: false,
        starred: false,
        replicas: [],
        content,
        kind: file.kind,
        // An admin duplicating another owner's document must not attach the
        // copy to a folder the caller cannot own.
        folderId: file.ownerId === ctx.user.id ? file.folderId : null,
        template: file.template,
        version: 1,
      });
      await snapshot(copy, ctx.user.id);
      recordEvent(ctx.req, 'create', { fileId: copy.id });
      return textResult({ document: docMeta(copy), sourceId: file.id });
    }

    if (name === 'delete_document') {
      if (input.confirm !== true) return errorResult('confirm must be true to delete a document');
      const file = await loadDoc(input.id, ctx.user);
      await sequelize.transaction(async (transaction) => {
        await DocVersion.destroy({ where: { fileId: file.id }, transaction });
        await FormResponse.destroy({ where: { fileId: file.id }, transaction });
        await file.destroy({ transaction });
      });
      return textResult({ id: file.id, deleted: true });
    }

    if (name === 'search_documents') {
      if (typeof input.query !== 'string') return errorResult('query must be a string');
      if (input.query.length > 200) return errorResult('query is too long');
      const query = input.query.trim().slice(0, 100);
      if (!query) return errorResult('query is required');
      if (input.kind && !KIND_BY_ID.has(input.kind)) return errorResult('unknown document kind');
      const where = {
        ownerId: ctx.user.id,
        kind: input.kind || { [Op.ne]: 'file' },
        [Op.or]: [
          { filename: { [Op.like]: `%${query}%` } },
          { content: { [Op.like]: `%${query}%` } },
        ],
      };
      const files = await FileRecord.findAll({
        where,
        order: [['updatedAt', 'DESC']],
        limit: clampLimit(input.limit),
        attributes: ['id', 'filename', 'kind', 'version', 'isPublic', 'starred', 'folderId', 'updatedAt', 'createdAt', 'content'],
      });
      return textResult({
        query,
        documents: files.map((file) => {
          const plain = String(file.content || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\\[nrt]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const idx = plain.toLowerCase().indexOf(query.toLowerCase());
          return {
            ...docMeta(file),
            snippet: idx >= 0 ? plain.slice(Math.max(0, idx - 60), idx + 120) : plain.slice(0, 160),
          };
        }),
      });
    }

    if (name === 'list_templates') {
      if (input.kind && !KIND_BY_ID.has(input.kind)) return errorResult('unknown document kind');
      const builtins = TEMPLATES
        .filter((template) => !input.kind || template.kind === input.kind)
        .map(({ id, name, kind, category, description }) => ({ id, name, kind, category, description, custom: false }));
      const custom = await Template.findAll({
        where: { ownerId: ctx.user.id, ...(input.kind ? { kind: input.kind } : {}) },
        order: [['createdAt', 'DESC']],
        attributes: ['id', 'name', 'kind', 'category'],
      });
      return textResult({
        templates: [
          ...builtins,
          ...custom.map((template) => ({
            id: `custom:${template.id}`,
            name: template.name,
            kind: template.kind,
            category: template.category,
            custom: true,
          })),
        ],
      });
    }

    if (name === 'studio_list_projects') {
      const rows = await FileRecord.findAll({
        where: { ownerId: ctx.user.id, kind: 'roblox' },
        order: [['updatedAt', 'DESC']],
        limit: clampLimit(input.limit),
        attributes: ['id', 'filename', 'version', 'updatedAt', 'createdAt'],
      });
      return textResult({ projects: rows.map((row) => ({ ...docMeta(row), studioUrl: `/studio/roblox/${row.id}` })) });
    }

    if (name === 'studio_get_scene') {
      const file = await loadDoc(input.id, ctx.user);
      if (file.kind !== 'roblox') return errorResult('not a Roblox project');
      const content = parseContent(file);
      return textResult({ project: docMeta(file), scene: content.scene || content, placeName: content.placeName || null });
    }

    if (name === 'studio_list_commands') {
      const file = await loadDoc(input.id, ctx.user);
      if (file.kind !== 'roblox') return errorResult('not a Roblox project');
      const commands = await StudioCommand.findAll({
        where: { fileId: file.id },
        order: [['createdAt', 'DESC']],
        limit: clampLimit(input.limit),
        attributes: ['id', 'kind', 'status', 'createdBy', 'error', 'createdAt', 'deliveredAt', 'appliedAt'],
      });
      return textResult({ commands });
    }

    if (name === 'studio_queue_command') {
      const file = await loadDoc(input.id, ctx.user);
      if (file.kind !== 'roblox') return errorResult('not a Roblox project');
      if (input.kind === 'delete' && !input.confirm) {
        return errorResult('delete requires confirm:true; call again with confirm when the deletion is intended');
      }
      let payload;
      try { payload = validateCommand(input.kind, input.payload); } catch (err) { return errorResult(err.message); }
      const preview = { kind: input.kind, payload, targetProject: file.filename };
      if (input.dry_run) return textResult({ dryRun: true, preview, queued: false });
      const command = await StudioCommand.create({
        id: nanoid(36),
        fileId: file.id,
        sessionId: null,
        kind: input.kind,
        payload,
        status: 'queued',
        createdBy: ctx.apiKey ? `mcp:${ctx.apiKey.id}` : `mcp:${ctx.user.id}`,
      });
      // Persist the previewed edit so it survives a reload before a plugin
      // connects; the next Studio snapshot remains authoritative.
      const current = parseContent(file);
      const before = JSON.stringify(current);
      const next = applyCommandToContent(current, command.kind, payload);
      const serialized = JSON.stringify(next);
      if (serialized !== before) {
        await file.update({ content: serialized, size: Buffer.byteLength(serialized), version: file.version + 1, updatedAt: new Date() });
      }
      return textResult({ queued: true, command: { id: command.id, kind: command.kind, status: command.status }, version: file.version, audit: 'The plugin is the final authority; watch studio_list_commands for apply/failure.' });
    }

    if (name === 'studio_create_snapshot') {
      const file = await loadDoc(input.id, ctx.user);
      if (file.kind !== 'roblox') return errorResult('not a Roblox project');
      const snap = await StudioSnapshot.create({ fileId: file.id, scene: file.content, label: String(input.label || 'MCP snapshot').slice(0, 160), createdBy: `mcp:${ctx.user.id}` });
      return textResult({ created: true, snapshotId: snap.id });
    }

    if (name === 'list_form_responses') {
      const file = await loadDoc(input.id, ctx.user);
      if (file.kind !== 'form') return errorResult('document is not a form');
      const form = parseContent(file);
      const fields = (form.fields || []).map(({ id, type, label, required, options, help }) => ({
        id, type, label, required: !!required, options: options || [], help: help || '',
      }));
      const attributes = ['id', 'data', 'createdAt'];
      if (input.responseId !== undefined) {
        const responseId = Number(input.responseId);
        if (!Number.isInteger(responseId) || responseId < 1) return errorResult('responseId must be a positive integer');
        const response = await FormResponse.findOne({
          where: { id: responseId, fileId: file.id },
          attributes,
        });
        if (!response) return errorResult('response not found');
        return textResult({ id: file.id, name: file.filename, fields, response });
      }
      const responses = await FormResponse.findAll({
        where: { fileId: file.id },
        order: [['id', 'DESC']],
        limit: clampLimit(input.limit),
        // Never expose the stored submitter IP through MCP.
        attributes,
      });
      return textResult({ id: file.id, name: file.filename, fields, responses });
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

function jsonRpcError(id, code, message, data) {
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
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
        serverInfo: { name: 'cascade-workspace', version: '1.1.0' },
        instructions: 'Use your Cascade API key. Start with whoami, list_folders, list_templates, and list_documents. Read a document before update_document, pass its version, use restore_version for history, and pass confirm:true only when deletion is intended. Every tool is owner-scoped; read-only keys cannot mutate.',
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
    // resources/read is a protocol operation, not a tool result. The official
    // SDK validates its result schema and rejects a tool-shaped error.
    if (method === 'resources/read' && err instanceof ToolError) {
      // Do not echo the URI or any record-derived detail here. A foreign id and
      // a missing id must produce the same bytes for the caller.
      return jsonRpcError(message.id, -32602, 'resource not found');
    }
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

// MCP 2025-11-25, Transports > Streamable HTTP > Protocol Version Header:
// a client MUST send MCP-Protocol-Version after initialization; a server MUST
// reject an invalid/unsupported value with 400. If it is absent, the revision
// says to assume 2025-03-26, which this handler also supports.
function requireMcpProtocolVersion(req, res, next) {
  const requested = req.get('mcp-protocol-version');
  if (requested && !SUPPORTED_VERSIONS.has(requested)) {
    return res.status(400).json(jsonRpcError(null, -32600, 'unsupported MCP-Protocol-Version'));
  }
  next();
}

// MCP 2025-11-25, Transports > Streamable HTTP > Security Warning:
// validate Origin on all connections. No header is normal for server-side MCP
// clients; a present but foreign Origin is rejected even for API-key requests.
function requireMcpOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  let same = false;
  try {
    const parsed = new URL(origin);
    const expectedHost = req.get('x-forwarded-host') || req.get('host');
    const expectedProto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
    same = parsed.host === expectedHost && parsed.protocol === `${expectedProto}:`;
  } catch {
    same = false;
  }
  if (!same) return res.status(403).json(jsonRpcError(null, -32000, 'cross-origin request rejected'));
  next();
}

/*
 MCP 2025-11-25, Transports > Streamable HTTP design rationale:
 - Session Management, item 1: a server MAY assign Mcp-Session-Id. This server
   intentionally does not; every request carries its own API-key/session auth.
 - Listening for Messages from the Server, item 3: a server MUST either return
   an SSE stream for GET or return 405. We return 405, so no GET stream exists.
 - Session Management, item 5: DELETE may return 405 when explicit termination
   is not supported. We do that because there is no session to terminate.
 - Sending Messages to the Server, item 5: JSON responses are an allowed
   alternative to SSE for a POST request, and the official SDK accepts them.
*/
export function createMcpRouter() {
  const router = express.Router();

  router.use(requireMcpOrigin);
  router.use(requireMcpProtocolVersion);

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
