/* Cascade AI HTTP surface: the workspace page, conversations, streaming chat,
 * branching, images, speech, knowledge bases, assistants, usage and MCP.
 *
 * All data is owner-scoped. Provider keys stay in this process; the browser
 * receives `publicAiSettings()` only. */
import express from 'express';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { Op } from 'sequelize';
import { AiAssistant, AiConversation, AiFolder, AiKnowledge, AiKnowledgeDoc, AiMessage, AiUsage } from './models.js';
import { getSettings, User } from '../db.js';
import { findProvider, publicAiSettings, resolveApiKey } from './config.js';
import { discoverModels, editImage, generateImages, searchWeb, streamChat, synthesizeSpeech } from './providers.js';
import { allToolSpecs, executeTool, isDestructiveTool, listExternalTools } from './tools.js';
import { attachmentParts, extractAttachmentText, loadAttachment, partsToContent } from './attachments.js';
import { chunkText, embedDocuments, knowledgePrompt, searchKnowledge } from './knowledge.js';
import { fileJson, saveGeneratedFile } from './files.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 4 } });
const modelCache = new Map();
const MODEL_TTL = 5 * 60 * 1000;

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'login required' });
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'administrator access required' });
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}

async function ownConversation(id, userId, res) {
  const conversation = await AiConversation.findOne({ where: { id: String(id), ownerId: userId } });
  if (!conversation) {
    res.status(404).json({ error: 'conversation not found' });
    return null;
  }
  return conversation;
}

async function conversationTree(conversation) {
  const messages = await AiMessage.findAll({
    where: { conversationId: conversation.id },
    order: [['createdAt', 'ASC'], ['id', 'ASC']],
  });
  const byId = new Map(messages.map((m) => [m.id, m]));
  let leaf = conversation.activeLeafId ? byId.get(conversation.activeLeafId) : null;
  if (!leaf) leaf = messages[messages.length - 1] || null;
  const path = [];
  const seen = new Set();
  let cursor = leaf;
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  const children = new Map();
  for (const message of messages) {
    const key = message.parentId || 'root';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(message.id);
  }
  return { messages, path, byId, children, leaf };
}

function messageJson(message, siblings = []) {
  return {
    id: message.id,
    conversationId: message.conversationId,
    parentId: message.parentId,
    role: message.role,
    content: message.content,
    attachments: message.attachments || [],
    toolCalls: message.toolCalls || [],
    status: message.status,
    error: message.error,
    providerId: message.providerId,
    model: message.model,
    usage: message.usage || {},
    createdAt: message.createdAt,
    branch: { index: Math.max(0, siblings.indexOf(message.id)), count: siblings.length, ids: siblings.slice(0, 60) },
  };
}

function treeJson(tree) {
  const out = [];
  for (const message of tree.path) {
    const siblings = tree.children.get(message.parentId || 'root') || [message.id];
    out.push(messageJson(message, siblings));
  }
  return out;
}

function conversationJson(conversation, extra = {}) {
  return {
    id: conversation.id,
    title: conversation.title,
    folderId: conversation.folderId,
    assistantId: conversation.assistantId,
    providerId: conversation.providerId,
    model: conversation.model,
    pinned: conversation.pinned,
    archived: conversation.archived,
    activeLeafId: conversation.activeLeafId,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    ...extra,
  };
}

async function todayUsage(userId) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const [row] = await AiUsage.findAll({
    where: { userId, createdAt: { [Op.gte]: start } },
    attributes: [[AiUsage.sequelize.fn('SUM', AiUsage.sequelize.col('totalTokens')), 'total']],
    raw: true,
  });
  return Number(row?.total) || 0;
}

async function recordUsage({ userId, conversationId, messageId, providerId, model, kind = 'chat', usage }) {
  const promptTokens = Number(usage?.promptTokens) || 0;
  const completionTokens = Number(usage?.completionTokens) || 0;
  const totalTokens = Number(usage?.totalTokens) || promptTokens + completionTokens;
  await AiUsage.create({ userId, conversationId, messageId, providerId, model, kind, promptTokens, completionTokens, totalTokens });
}

async function resolvedProvider(settings, requestedId) {
  const provider = findProvider(settings, requestedId);
  if (!provider) return null;
  return provider;
}

async function modelsFor(provider) {
  if (!provider) return [];
  const cached = modelCache.get(provider.id);
  if (cached && Date.now() - cached.at < MODEL_TTL) return cached.models;
  if (provider.discovery && (provider.type === 'ollama' || resolveApiKey(provider))) {
    try {
      const models = await discoverModels(provider);
      modelCache.set(provider.id, { models, at: Date.now() });
      return models;
    } catch { /* fall back to the configured list */ }
  }
  return provider.models || [];
}

function pickModel(provider, requested, fallback) {
  if (requested) return requested;
  if (fallback) return fallback;
  if (provider?.models?.length) return provider.models[0].id;
  return '';
}

/* ------------------------------------------------------------------------- */
/* Chat generation                                                           */
/* ------------------------------------------------------------------------- */

function sse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
  let closed = false;
  res.on('close', () => { closed = true; });
  return {
    send(payload) { if (!closed) res.write(`data: ${JSON.stringify(payload)}\n\n`); },
    end() { if (!closed) { res.write('data: [DONE]\n\n'); res.end(); } },
    get closed() { return closed; },
  };
}

function systemPromptFor(settings, conversation, assistant) {
  return (assistant?.systemPrompt || conversation?.systemPrompt || settings?.systemPrompt || '').trim();
}

async function buildHistory(conversation, parentId) {
  const messages = await AiMessage.findAll({ where: { conversationId: conversation.id }, order: [['createdAt', 'ASC']] });
  const byId = new Map(messages.map((m) => [m.id, m]));
  const path = [];
  let cursor = parentId ? byId.get(parentId) : null;
  const seen = new Set();
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    path.unshift(cursor);
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
  }
  const out = [];
  for (const message of path) {
    if (message.status === 'error' || message.status === 'pending') continue;
    if (message.role === 'user') {
      const attachmentText = message.meta?.attachmentText || '';
      out.push({ role: 'user', content: attachmentText ? `${message.content}\n\n${attachmentText}` : message.content });
    } else if (message.role === 'assistant') {
      const calls = (message.toolCalls || []).filter((call) => call.result !== undefined);
      if (calls.length) {
        out.push({
          role: 'assistant',
          content: message.content || '',
          tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } })),
        });
        for (const call of calls) out.push({ role: 'tool', tool_call_id: call.id, content: String(call.result ?? '').slice(0, 12000) });
      } else if (message.content) {
        out.push({ role: 'assistant', content: message.content });
      }
    }
  }
  return out;
}

async function streamAssistant({ response, req, user, conversation, assistant, provider, model, messages, tools, temperature, maxTokens, settings, message, approvals = new Set(), carriedCalls = [] }) {
  const send = response.send;
  // Keep calls that were already resolved (for example a declined destructive
  // tool) so the transcript still shows what the user decided.
  const usedCalls = carriedCalls.filter((call) => !call.pending).map((call) => ({ ...call }));
  const usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  let iterations = 0;
  let textAll = message.content || '';
  let lastSave = 0;
  const maxIterations = settings.ai.limits.maxToolIterations;

  const persist = async (patch = {}) => {
    Object.assign(message, patch);
    message.toolCalls = usedCalls;
    message.usage = usage;
    await message.save();
  };

  while (iterations < maxIterations) {
    iterations += 1;
    const iterator = streamChat(provider, {
      model,
      messages,
      tools: tools?.length ? tools : null,
      temperature,
      maxTokens: maxTokens || settings.ai.limits.maxTokens,
    });
    let turnText = '';
    const calls = [];
    for await (const event of iterator) {
      if (event.type === 'text') {
        turnText += event.text;
        textAll += event.text;
        message.content = textAll;
        send({ type: 'delta', text: event.text });
        const now = Date.now();
        if (now - lastSave > 750) { lastSave = now; await persist({ content: textAll, status: 'streaming' }); }
      } else if (event.type === 'tool_calls') {
        calls.push(...event.calls);
      } else if (event.type === 'usage') {
        usage.promptTokens += event.usage.promptTokens;
        usage.completionTokens += event.usage.completionTokens;
        usage.totalTokens += event.usage.totalTokens;
      }
    }
    if (!calls.length) break;

    messages.push({
      role: 'assistant',
      content: turnText,
      tool_calls: calls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } })),
    });

    const pending = calls.filter((call) => isDestructiveTool(call.name) && settings.ai.confirmDestructive && !approvals.has(call.id));
    if (pending.length) {
      for (const call of pending) usedCalls.push({ id: call.id, name: call.name, arguments: call.arguments, pending: true });
      const rest = calls.filter((call) => !pending.includes(call));
      for (const call of rest) usedCalls.push({ id: call.id, name: call.name, arguments: call.arguments, pending: false, result: 'Skipped until the pending confirmation is resolved.', isError: true });
      await persist({ content: textAll, status: 'pending', usage });
      send({ type: 'confirmation_required', messageId: message.id, calls: pending.map((call) => ({ id: call.id, name: call.name, arguments: call.arguments })) });
      return { usage, pending: true };
    }

    for (const call of calls) {
      send({ type: 'tool_start', id: call.id, name: call.name, arguments: call.arguments });
      let result;
      try {
        result = await executeTool(settings.ai, user, call.name, call.arguments, req);
      } catch (err) {
        result = { text: `Tool failed: ${err.message}`, data: null, isError: true, server: '' };
      }
      const entry = { id: call.id, name: call.name, arguments: call.arguments, result: String(result.text || '').slice(0, 24000), data: result.data || null, isError: !!result.isError, server: result.server || '' };
      const existing = usedCalls.findIndex((item) => item.id === entry.id);
      if (existing >= 0) usedCalls[existing] = entry;
      else usedCalls.push(entry);
      messages.push({ role: 'tool', tool_call_id: call.id, content: entry.result || (entry.isError ? 'Tool failed' : 'Done') });
      send({ type: 'tool_result', id: call.id, name: call.name, result: entry.result, isError: entry.isError, data: entry.data });
      await persist({ content: textAll, status: 'streaming', usage });
    }
  }

  await persist({ content: textAll, status: 'complete', usage, error: null });
  if (usage.totalTokens) {
    await recordUsage({
      userId: user.id, conversationId: conversation.id, messageId: message.id,
      providerId: provider.id, model, kind: 'chat', usage,
    });
  }
  send({ type: 'usage', usage });
  return { usage, pending: false };
}

/* ------------------------------------------------------------------------- */
/* Router                                                                    */
/* ------------------------------------------------------------------------- */

export function createAiRouter() {
  const router = express.Router();

  router.get('/ai', wrap(async (req, res) => {
    if (!req.user) return res.redirect('/login');
    const settings = await getSettings();
    const [conversations, folders, assistants, knowledge] = await Promise.all([
      AiConversation.findAll({ where: { ownerId: req.user.id, archived: false }, order: [['pinned', 'DESC'], ['lastMessageAt', 'DESC'], ['updatedAt', 'DESC']], limit: 80 }),
      AiFolder.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
      AiAssistant.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
      AiKnowledge.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
    ]);
    res.render('ai', {
      ai: publicAiSettings(settings.ai),
      conversations: conversations.map((c) => conversationJson(c)),
      folders,
      assistants,
      knowledge,
      activeId: null,
      dailyTokens: await todayUsage(req.user.id),
    });
  }));

  router.get('/ai/:id', wrap(async (req, res) => {
    if (!req.user) return res.redirect('/login');
    const conversation = await AiConversation.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
    if (!conversation) return res.status(404).render('error', { message: 'Conversation not found.', status: 404 });
    const settings = await getSettings();
    const [conversations, folders, assistants, knowledge] = await Promise.all([
      AiConversation.findAll({ where: { ownerId: req.user.id, archived: false }, order: [['pinned', 'DESC'], ['lastMessageAt', 'DESC'], ['updatedAt', 'DESC']], limit: 80 }),
      AiFolder.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
      AiAssistant.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
      AiKnowledge.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
    ]);
    res.render('ai', {
      ai: publicAiSettings(settings.ai),
      conversations: conversations.map((c) => conversationJson(c)),
      folders,
      assistants,
      knowledge,
      activeId: conversation.id,
      dailyTokens: await todayUsage(req.user.id),
    });
  }));

  /* ------------------------------- bootstrap ----------------------------- */

  router.get('/api/ai/bootstrap', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const [folders, assistants, knowledge, conversations] = await Promise.all([
      AiFolder.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
      AiAssistant.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
      AiKnowledge.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] }),
      AiConversation.findAll({ where: { ownerId: req.user.id, archived: false }, order: [['pinned', 'DESC'], ['lastMessageAt', 'DESC'], ['updatedAt', 'DESC']], limit: 200 }),
    ]);
    res.json({
      ai: publicAiSettings(settings.ai),
      folders,
      assistants,
      knowledge,
      conversations: conversations.map((c) => conversationJson(c)),
      usage: { today: await todayUsage(req.user.id), limit: settings.ai.limits.dailyTokens },
    });
  }));

  router.get('/api/ai/models', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const provider = await resolvedProvider(settings.ai, req.query.providerId);
    if (!provider) return res.status(400).json({ error: 'no provider configured' });
    const models = await modelsFor(provider);
    res.json({ providerId: provider.id, models });
  }));

  /* ------------------------------ conversations -------------------------- */

  router.get('/api/ai/conversations', requireUser, wrap(async (req, res) => {
    const where = { ownerId: req.user.id };
    if (req.query.q) where.title = { [Op.like]: `%${String(req.query.q).slice(0, 80)}%` };
    if (req.query.folderId) where.folderId = String(req.query.folderId);
    if (req.query.archived === '1') where.archived = true;
    const rows = await AiConversation.findAll({ where, order: [['pinned', 'DESC'], ['lastMessageAt', 'DESC'], ['updatedAt', 'DESC']], limit: 200 });
    res.json({ conversations: rows.map((c) => conversationJson(c)) });
  }));

  router.post('/api/ai/conversations', requireUser, wrap(async (req, res) => {
    const body = req.body || {};
    const conversation = await AiConversation.create({
      id: nanoid(12),
      ownerId: req.user.id,
      title: String(body.title || 'New conversation').slice(0, 180),
      folderId: body.folderId ? String(body.folderId) : null,
      assistantId: body.assistantId ? String(body.assistantId) : null,
      providerId: body.providerId ? String(body.providerId) : null,
      model: body.model ? String(body.model) : null,
      lastMessageAt: new Date(),
    });
    res.status(201).json({ conversation: conversationJson(conversation) });
  }));

  router.get('/api/ai/conversations/:id', requireUser, wrap(async (req, res) => {
    const conversation = await ownConversation(req.params.id, req.user.id, res);
    if (!conversation) return;
    if (req.query.leaf) {
      const leaf = await AiMessage.findOne({ where: { id: String(req.query.leaf), conversationId: conversation.id } });
      if (leaf) { conversation.activeLeafId = leaf.id; await conversation.save(); }
    }
    const tree = await conversationTree(conversation);
    res.json({ conversation: conversationJson(conversation), messages: treeJson(tree), leafId: tree.leaf?.id || null });
  }));

  router.patch('/api/ai/conversations/:id', requireUser, wrap(async (req, res) => {
    const conversation = await ownConversation(req.params.id, req.user.id, res);
    if (!conversation) return;
    const body = req.body || {};
    const patch = {};
    if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim().slice(0, 180);
    if ('folderId' in body) patch.folderId = body.folderId ? String(body.folderId) : null;
    if ('pinned' in body) patch.pinned = !!body.pinned;
    if ('archived' in body) patch.archived = !!body.archived;
    if ('assistantId' in body) patch.assistantId = body.assistantId ? String(body.assistantId) : null;
    if ('providerId' in body) patch.providerId = body.providerId ? String(body.providerId) : null;
    if ('model' in body) patch.model = body.model ? String(body.model) : null;
    await conversation.update(patch);
    res.json({ conversation: conversationJson(conversation) });
  }));

  router.delete('/api/ai/conversations/:id', requireUser, wrap(async (req, res) => {
    const conversation = await ownConversation(req.params.id, req.user.id, res);
    if (!conversation) return;
    await AiMessage.destroy({ where: { conversationId: conversation.id } });
    await conversation.destroy();
    res.json({ deleted: true });
  }));

  router.post('/api/ai/messages/:id/leaf', requireUser, wrap(async (req, res) => {
    const message = await AiMessage.findByPk(req.params.id);
    if (!message) return res.status(404).json({ error: 'message not found' });
    const conversation = await ownConversation(message.conversationId, req.user.id, res);
    if (!conversation) return;
    conversation.activeLeafId = message.id;
    await conversation.save();
    const tree = await conversationTree(conversation);
    res.json({ conversation: conversationJson(conversation), messages: treeJson(tree), leafId: tree.leaf?.id || null });
  }));

  router.delete('/api/ai/messages/:id', requireUser, wrap(async (req, res) => {
    const message = await AiMessage.findByPk(req.params.id);
    if (!message) return res.status(404).json({ error: 'message not found' });
    const conversation = await ownConversation(message.conversationId, req.user.id, res);
    if (!conversation) return;
    const descendants = [];
    let frontier = [message.id];
    for (let depth = 0; depth < 50 && frontier.length; depth += 1) {
      const rows = await AiMessage.findAll({ where: { conversationId: conversation.id, parentId: frontier } });
      frontier = rows.map((row) => row.id);
      descendants.push(...frontier);
    }
    await AiMessage.destroy({ where: { id: { [Op.in]: [message.id, ...descendants] } } });
    if (conversation.activeLeafId === message.id || descendants.includes(conversation.activeLeafId)) {
      conversation.activeLeafId = message.parentId || null;
      await conversation.save();
    }
    res.json({ deleted: true, removed: 1 + descendants.length });
  }));

  /* --------------------------------- chat -------------------------------- */

  router.post('/api/ai/chat', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    if (!settings.ai.enabled) return res.status(403).json({ error: 'Cascade AI is disabled by an administrator' });
    const body = req.body || {};
    const conversation = body.conversationId ? await ownConversation(body.conversationId, req.user.id, res) : null;
    if (body.conversationId && !conversation) return;

    const requestedProvider = await resolvedProvider(settings.ai, body.providerId || conversation?.providerId);
    if (!requestedProvider) return res.status(400).json({ error: 'No AI provider is configured. An administrator can add one in Admin → Cascade AI.' });
    if (!resolveApiKey(requestedProvider) && requestedProvider.type !== 'ollama') {
      return res.status(400).json({ error: `${requestedProvider.name} has no API key configured.` });
    }
    const assistant = body.assistantId
      ? await AiAssistant.findOne({ where: { id: String(body.assistantId), ownerId: req.user.id } })
      : conversation?.assistantId ? await AiAssistant.findOne({ where: { id: conversation.assistantId, ownerId: req.user.id } }) : null;
    const model = pickModel(requestedProvider, body.model || conversation?.model, settings.ai.defaultModel || assistant?.model);
    if (!model) return res.status(400).json({ error: 'Select a model first (refresh model discovery in Admin → Cascade AI).' });

    if (settings.ai.limits.dailyTokens > 0) {
      const used = await todayUsage(req.user.id);
      if (used >= settings.ai.limits.dailyTokens) return res.status(429).json({ error: 'Daily token limit reached. An administrator can raise it in Admin → Cascade AI.' });
    }

    const isRegenerate = !!body.regenerateOf;
    let target = null;
    let parentId = body.parentId ? String(body.parentId) : null;
    let text = String(body.message || '').trim();
    let attachmentIds = Array.isArray(body.attachments) ? body.attachments.map(String).slice(0, 12) : [];
    let attachmentText = '';
    let parts = [];

    if (isRegenerate) {
      target = await AiMessage.findOne({ where: { id: String(body.regenerateOf), conversationId: conversation?.id } });
      if (!target || target.role !== 'assistant') return res.status(400).json({ error: 'Only an assistant message can be regenerated' });
      parentId = target.parentId;
      text = '';
      attachmentIds = [];
    } else if (!text && !attachmentIds.length) {
      return res.status(400).json({ error: 'Message is empty' });
    }

    if (parentId) {
      const parent = await AiMessage.findOne({ where: { id: parentId, conversationId: conversation?.id || '__none' } });
      if (!parent && !isRegenerate) return res.status(400).json({ error: 'parent message not found' });
    }

    if (attachmentIds.length) {
      const extracted = await attachmentParts(attachmentIds.map((id) => ({ id })), req.user.id, settings.ai.limits);
      parts = extracted.parts;
      attachmentText = extracted.notes.concat(parts.filter((p) => p.type === 'text').map((p) => p.text)).join('\n\n');
    }

    let activeConversation = conversation;
    if (!activeConversation) {
      const title = (text || 'New conversation').replace(/\s+/g, ' ').slice(0, 70);
      activeConversation = await AiConversation.create({
        id: nanoid(12),
        ownerId: req.user.id,
        title,
        assistantId: assistant?.id || null,
        providerId: requestedProvider.id,
        model,
        lastMessageAt: new Date(),
      });
    }
    const messageCount = await AiMessage.count({ where: { conversationId: activeConversation.id } });
    if (messageCount >= settings.ai.limits.maxMessagesPerConversation) {
      return res.status(400).json({ error: 'This conversation is full. Start a new one to keep going.' });
    }

    const response = sse(res);
    response.send({ type: 'meta', conversationId: activeConversation.id, providerId: requestedProvider.id, model });

    try {
      let userMessage = null;
      if (!isRegenerate) {
        userMessage = await AiMessage.create({
          id: nanoid(12),
          conversationId: activeConversation.id,
          parentId: parentId || activeConversation.activeLeafId || null,
          role: 'user',
          content: text,
          attachments: attachmentIds.map((id) => {
            const part = parts.find((p) => p.fileId === id);
            return { id, filename: part?.filename || 'attachment', type: part?.type || 'file' };
          }),
          meta: { attachmentText: attachmentText.slice(0, 60000) },
          status: 'complete',
        });
        parentId = userMessage.id;
        activeConversation.activeLeafId = userMessage.id;
        activeConversation.lastMessageAt = new Date();
        if (activeConversation.title === 'New conversation' && text) activeConversation.title = text.replace(/\s+/g, ' ').slice(0, 70);
        await activeConversation.save();
        response.send({ type: 'user', message: messageJson(userMessage) });
      }

      const history = await buildHistory(activeConversation, isRegenerate ? parentId : userMessage?.parentId || null);
      const system = systemPromptFor(settings.ai, activeConversation, assistant);
      const systemParts = [system];
      const knowledgeIds = Array.isArray(body.knowledgeIds) && body.knowledgeIds.length
        ? body.knowledgeIds.map(String)
        : (assistant?.knowledgeIds || []);
      if (knowledgeIds.length) {
        try {
          const query = text || (history.filter((m) => m.role === 'user').pop()?.content || '');
          const found = await searchKnowledge({ ownerId: req.user.id, knowledgeIds, query, settings: settings.ai });
          const block = knowledgePrompt(found.hits);
          if (block) systemParts.push(block);
        } catch (err) {
          systemParts.push(`Knowledge retrieval failed: ${err.message}`);
        }
      }
      if (body.useWeb) {
        try {
          const query = text || (history.filter((m) => m.role === 'user').pop()?.content || '');
          const search = await searchWeb(settings.ai, query);
          if (search.results.length) {
            systemParts.push(`Web search results (${search.provider}):\n${search.results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${String(r.snippet || '').slice(0, 500)}`).join('\n\n')}`);
            response.send({ type: 'search', provider: search.provider, results: search.results });
          }
        } catch (err) {
          response.send({ type: 'notice', message: `Web search failed: ${err.message}` });
        }
      }

      const modelMessages = [{ role: 'system', content: systemParts.filter(Boolean).join('\n\n') }, ...history];
      if (!isRegenerate && (text || parts.length)) {
        modelMessages.push({ role: 'user', content: partsToContent(text, parts) });
      }

      let tools = null;
      if (settings.ai.mcpServers?.length && body.useTools !== false) {
        const resolved = await allToolSpecs(settings.ai);
        tools = resolved.specs;
        if (resolved.failures.length) response.send({ type: 'notice', message: `MCP: ${resolved.failures.join('; ')}` });
      } else if (body.useTools !== false) {
        tools = (await allToolSpecs({ ...settings.ai, mcpServers: [] })).specs;
      }

      const assistantMessage = await AiMessage.create({
        id: nanoid(12),
        conversationId: activeConversation.id,
        parentId,
        role: 'assistant',
        content: '',
        providerId: requestedProvider.id,
        model,
        status: 'streaming',
        meta: { knowledgeIds, useWeb: !!body.useWeb },
      });
      activeConversation.activeLeafId = assistantMessage.id;
      activeConversation.lastMessageAt = new Date();
      await activeConversation.save();
      response.send({ type: 'assistant_start', message: messageJson(assistantMessage), conversation: conversationJson(activeConversation) });

      const result = await streamAssistant({
        response,
        req,
        user: req.user,
        conversation: activeConversation,
        assistant,
        provider: requestedProvider,
        model,
        messages: modelMessages,
        tools,
        temperature: assistant?.temperature,
        maxTokens: settings.ai.limits.maxTokens,
        settings,
        message: assistantMessage,
      });
      response.send({
        type: 'done',
        pending: result.pending,
        message: messageJson(assistantMessage),
        conversation: conversationJson(activeConversation),
      });
    } catch (err) {
      response.send({ type: 'error', message: err.message || 'Generation failed' });
    } finally {
      response.end();
    }
  }));

  router.post('/api/ai/tool-confirm', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const body = req.body || {};
    const message = await AiMessage.findByPk(String(body.messageId || ''));
    if (!message || message.role !== 'assistant' || message.status !== 'pending') return res.status(400).json({ error: 'no pending tool confirmation' });
    const conversation = await ownConversation(message.conversationId, req.user.id, res);
    if (!conversation) return;
    const approvals = new Set((body.approvals || []).map(String));
    const calls = message.toolCalls || [];
    const provider = await resolvedProvider(settings.ai, message.providerId || conversation.providerId);
    if (!provider) return res.status(400).json({ error: 'provider is no longer configured' });

    const response = sse(res);
    response.send({ type: 'meta', messageId: message.id, conversationId: conversation.id });
    try {
      const history = await buildHistory(conversation, message.parentId);
      const modelMessages = [
        { role: 'system', content: systemPromptFor(settings.ai, conversation, null) },
        ...history,
        {
          role: 'assistant',
          content: message.content || '',
          tool_calls: calls.filter((call) => call.pending).map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } })),
        },
      ];
      for (const call of calls.filter((c) => c.pending)) {
        if (approvals.has(call.id)) {
          response.send({ type: 'tool_start', id: call.id, name: call.name, arguments: call.arguments });
          let result;
          try {
            result = await executeTool(settings.ai, req.user, call.name, call.arguments, req);
          } catch (err) {
            result = { text: `Tool failed: ${err.message}`, data: null, isError: true, server: '' };
          }
          call.pending = false;
          call.result = String(result.text || '').slice(0, 24000);
          call.data = result.data || null;
          call.isError = !!result.isError;
          modelMessages.push({ role: 'tool', tool_call_id: call.id, content: call.result });
          response.send({ type: 'tool_result', id: call.id, name: call.name, result: call.result, isError: call.isError, data: call.data });
        } else {
          call.pending = false;
          call.result = 'The user declined to run this tool.';
          call.isError = true;
          modelMessages.push({ role: 'tool', tool_call_id: call.id, content: call.result });
        }
      }
      await message.update({ toolCalls: calls, status: 'streaming' });
      const tools = (await allToolSpecs(settings.ai)).specs;
      const result = await streamAssistant({
        response,
        req,
        user: req.user,
        conversation,
        assistant: null,
        provider,
        model: message.model || conversation.model,
        messages: modelMessages,
        tools,
        maxTokens: settings.ai.limits.maxTokens,
        settings,
        message,
        approvals,
        carriedCalls: calls,
      });
      response.send({ type: 'done', pending: result.pending, message: messageJson(message), conversation: conversationJson(conversation) });
    } catch (err) {
      await message.update({ status: 'error', error: err.message });
      response.send({ type: 'error', message: err.message });
    } finally {
      response.end();
    }
  }));

  /* --------------------------------- images ------------------------------ */

  router.post('/api/ai/images/generate', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const body = req.body || {};
    const provider = await resolvedProvider(settings.ai, body.providerId || settings.ai.image.providerId);
    if (!provider) return res.status(400).json({ error: 'No image provider is configured' });
    const model = body.model || settings.ai.image.model || (provider.models || []).find((m) => m.image)?.id;
    if (!model) return res.status(400).json({ error: 'No image model configured' });
    const images = await generateImages(provider, {
      prompt: String(body.prompt || '').slice(0, 2000),
      model,
      size: body.size || settings.ai.image.size,
      quality: body.quality || settings.ai.image.quality,
      count: Number(body.count) || settings.ai.image.count,
    });
    const saved = [];
    for (let i = 0; i < images.length; i += 1) {
      const ext = images[i].mime === 'image/jpeg' ? 'jpg' : images[i].mime === 'image/webp' ? 'webp' : 'png';
      const record = await saveGeneratedFile(req.user, images[i].buffer, {
        filename: `cascade-ai-${Date.now()}-${i + 1}.${ext}`,
        mime: images[i].mime,
        source: 'cascade-ai-image',
      });
      saved.push({ ...fileJson(record), dataUrl: `data:${record.mime};base64,${images[i].buffer.toString('base64')}` });
    }
    await recordUsage({ userId: req.user.id, providerId: provider.id, model, kind: 'image', usage: { totalTokens: 0 } });
    res.json({ images: saved });
  }));

  router.post('/api/ai/images/edit', requireUser, upload.single('image'), wrap(async (req, res) => {
    const settings = await getSettings();
    const provider = await resolvedProvider(settings.ai, req.body.providerId || settings.ai.image.providerId);
    if (!provider) return res.status(400).json({ error: 'No image provider is configured' });
    let buffer = req.file?.buffer;
    let mime = req.file?.mimetype || 'image/png';
    if (!buffer && req.body.fileId) {
      const loaded = await loadAttachment(req.body.fileId, req.user.id);
      buffer = loaded.buffer;
      mime = loaded.file.mime || mime;
    }
    if (!buffer) return res.status(400).json({ error: 'Upload an image or pass a Cascade file id' });
    const model = req.body.model || settings.ai.image.editModel || settings.ai.image.model;
    if (!model) return res.status(400).json({ error: 'No image editing model configured' });
    const images = await editImage(provider, { prompt: String(req.body.prompt || '').slice(0, 2000), model, size: req.body.size, image: buffer, mime });
    const saved = [];
    for (let i = 0; i < images.length; i += 1) {
      const ext = images[i].mime === 'image/jpeg' ? 'jpg' : images[i].mime === 'image/webp' ? 'webp' : 'png';
      const record = await saveGeneratedFile(req.user, images[i].buffer, {
        filename: `cascade-ai-edit-${Date.now()}-${i + 1}.${ext}`,
        mime: images[i].mime,
        source: 'cascade-ai-image',
      });
      saved.push({ ...fileJson(record), dataUrl: `data:${record.mime};base64,${images[i].buffer.toString('base64')}` });
    }
    res.json({ images: saved });
  }));

  /* --------------------------------- speech ------------------------------ */

  router.post('/api/ai/speech', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const body = req.body || {};
    const provider = await resolvedProvider(settings.ai, body.providerId || settings.ai.speech.providerId);
    const input = String(body.text || '').slice(0, 4000);
    if (!input) return res.status(400).json({ error: 'text is required' });
    if (!provider || !resolveApiKey(provider)) return res.status(501).json({ error: 'No server speech provider configured', fallback: 'browser' });
    try {
      const audio = await synthesizeSpeech(provider, {
        model: settings.ai.speech.model,
        voice: body.voice || settings.ai.speech.voice,
        input,
        format: settings.ai.speech.format,
      });
      res.setHeader('Content-Type', audio.mime);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(audio.buffer);
    } catch (err) {
      res.status(502).json({ error: err.message, fallback: 'browser' });
    }
  }));

  router.post('/api/ai/web-search', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const query = String(req.body?.query || '').slice(0, 400);
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = await searchWeb(settings.ai, query);
    res.json(result);
  }));

  /* ------------------------------- assistants ---------------------------- */

  router.get('/api/ai/assistants', requireUser, wrap(async (req, res) => {
    const rows = await AiAssistant.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] });
    res.json({ assistants: rows });
  }));

  router.post('/api/ai/assistants', requireUser, wrap(async (req, res) => {
    const body = req.body || {};
    if (!String(body.name || '').trim()) return res.status(400).json({ error: 'name is required' });
    const assistant = await AiAssistant.create({
      id: nanoid(12),
      ownerId: req.user.id,
      name: String(body.name).trim().slice(0, 80),
      description: String(body.description || '').slice(0, 240),
      systemPrompt: String(body.systemPrompt || '').slice(0, 20000),
      providerId: body.providerId ? String(body.providerId) : null,
      model: body.model ? String(body.model) : null,
      icon: String(body.icon || '✦').slice(0, 4),
      temperature: Number.isFinite(Number(body.temperature)) ? Math.max(0, Math.min(2, Number(body.temperature))) : null,
      toolsEnabled: body.toolsEnabled !== false,
      knowledgeIds: Array.isArray(body.knowledgeIds) ? body.knowledgeIds.map(String) : [],
    });
    res.status(201).json({ assistant });
  }));

  router.patch('/api/ai/assistants/:id', requireUser, wrap(async (req, res) => {
    const assistant = await AiAssistant.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
    if (!assistant) return res.status(404).json({ error: 'assistant not found' });
    const body = req.body || {};
    const patch = {};
    if (body.name) patch.name = String(body.name).slice(0, 80);
    if ('description' in body) patch.description = String(body.description || '').slice(0, 240);
    if ('systemPrompt' in body) patch.systemPrompt = String(body.systemPrompt || '').slice(0, 20000);
    if ('model' in body) patch.model = body.model ? String(body.model) : null;
    if ('providerId' in body) patch.providerId = body.providerId ? String(body.providerId) : null;
    if ('toolsEnabled' in body) patch.toolsEnabled = !!body.toolsEnabled;
    if ('knowledgeIds' in body) patch.knowledgeIds = Array.isArray(body.knowledgeIds) ? body.knowledgeIds.map(String) : [];
    if (Number.isFinite(Number(body.temperature))) patch.temperature = Math.max(0, Math.min(2, Number(body.temperature)));
    await assistant.update(patch);
    res.json({ assistant });
  }));

  router.delete('/api/ai/assistants/:id', requireUser, wrap(async (req, res) => {
    await AiAssistant.destroy({ where: { id: req.params.id, ownerId: req.user.id } });
    res.json({ deleted: true });
  }));

  /* ------------------------------- knowledge ----------------------------- */

  router.get('/api/ai/knowledge', requireUser, wrap(async (req, res) => {
    const bases = await AiKnowledge.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] });
    const docs = await AiKnowledgeDoc.findAll({
      where: { ownerId: req.user.id },
      attributes: ['id', 'knowledgeId', 'filename', 'mime', 'size', 'status', 'createdAt'],
      order: [['createdAt', 'DESC']],
      limit: 500,
    });
    res.json({ knowledge: bases, documents: docs });
  }));

  router.post('/api/ai/knowledge', requireUser, wrap(async (req, res) => {
    const body = req.body || {};
    if (!String(body.name || '').trim()) return res.status(400).json({ error: 'name is required' });
    const settings = await getSettings();
    const knowledge = await AiKnowledge.create({
      id: nanoid(12),
      ownerId: req.user.id,
      name: String(body.name).trim().slice(0, 120),
      description: String(body.description || '').slice(0, 300),
      embeddingProviderId: body.embeddingProviderId || settings.ai.embedding.providerId || null,
      embeddingModel: body.embeddingModel || settings.ai.embedding.model || null,
      dimensions: settings.ai.embedding.localDimensions,
    });
    res.status(201).json({ knowledge });
  }));

  router.delete('/api/ai/knowledge/:id', requireUser, wrap(async (req, res) => {
    const knowledge = await AiKnowledge.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
    if (!knowledge) return res.status(404).json({ error: 'knowledge base not found' });
    await AiKnowledgeDoc.destroy({ where: { knowledgeId: knowledge.id } });
    await knowledge.destroy();
    res.json({ deleted: true });
  }));

  router.post('/api/ai/knowledge/:id/docs', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const knowledge = await AiKnowledge.findOne({ where: { id: req.params.id, ownerId: req.user.id } });
    if (!knowledge) return res.status(404).json({ error: 'knowledge base not found' });
    const count = await AiKnowledgeDoc.count({ where: { knowledgeId: knowledge.id } });
    if (count >= settings.ai.limits.maxKnowledgeDocuments) return res.status(400).json({ error: 'knowledge base document limit reached' });
    const body = req.body || {};
    let filename = String(body.filename || 'note.txt').slice(0, 200);
    let mime = String(body.mime || 'text/plain').slice(0, 120);
    let text = '';
    let size = 0;
    if (body.fileId) {
      const { file, buffer } = await loadAttachment(body.fileId, req.user.id);
      if (buffer.length > settings.ai.limits.maxKnowledgeDocumentBytes) return res.status(400).json({ error: 'file is larger than the knowledge base limit' });
      filename = file.filename;
      mime = file.mime || mime;
      size = buffer.length;
      text = await extractAttachmentText(file, buffer);
    } else {
      text = String(body.text || '');
      size = Buffer.byteLength(text);
      if (size > settings.ai.limits.maxKnowledgeDocumentBytes) return res.status(400).json({ error: 'document is larger than the knowledge base limit' });
    }
    if (!text.trim()) return res.status(400).json({ error: 'no readable text in that document' });
    const chunks = chunkText(text);
    if (!chunks.length) return res.status(400).json({ error: 'document has too little text to index' });
    const embedded = await embedDocuments(settings.ai, knowledge, chunks);
    const doc = await AiKnowledgeDoc.create({
      id: nanoid(12),
      knowledgeId: knowledge.id,
      ownerId: req.user.id,
      filename,
      mime,
      size,
      text: text.slice(0, 400000),
      chunks: chunks.map((chunk, index) => ({ text: chunk, embedding: embedded.vectors[index] })),
      status: 'ready',
    });
    await knowledge.update({
      documentCount: count + 1,
      embeddingProviderId: embedded.providerId,
      embeddingModel: embedded.model,
      dimensions: embedded.dimensions,
    });
    res.status(201).json({ document: { id: doc.id, filename: doc.filename, chunks: doc.chunks.length }, warning: embedded.warning || null });
  }));

  router.delete('/api/ai/knowledge/:id/docs/:docId', requireUser, wrap(async (req, res) => {
    const doc = await AiKnowledgeDoc.findOne({ where: { id: req.params.docId, knowledgeId: req.params.id, ownerId: req.user.id } });
    if (!doc) return res.status(404).json({ error: 'document not found' });
    await doc.destroy();
    const count = await AiKnowledgeDoc.count({ where: { knowledgeId: req.params.id } });
    await AiKnowledge.update({ documentCount: count }, { where: { id: req.params.id, ownerId: req.user.id } });
    res.json({ deleted: true });
  }));

  router.post('/api/ai/knowledge/:id/search', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const query = String(req.body?.query || '').slice(0, 500);
    if (!query) return res.status(400).json({ error: 'query is required' });
    const result = await searchKnowledge({ ownerId: req.user.id, knowledgeIds: [req.params.id], query, settings: settings.ai });
    res.json(result);
  }));

  /* --------------------------------- folders ----------------------------- */

  router.get('/api/ai/folders', requireUser, wrap(async (req, res) => {
    const folders = await AiFolder.findAll({ where: { ownerId: req.user.id }, order: [['createdAt', 'ASC']] });
    res.json({ folders });
  }));

  router.post('/api/ai/folders', requireUser, wrap(async (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: 'name is required' });
    const folder = await AiFolder.create({ id: nanoid(12), ownerId: req.user.id, name });
    res.status(201).json({ folder });
  }));

  router.delete('/api/ai/folders/:id', requireUser, wrap(async (req, res) => {
    await AiFolder.destroy({ where: { id: req.params.id, ownerId: req.user.id } });
    await AiConversation.update({ folderId: null }, { where: { folderId: req.params.id, ownerId: req.user.id } });
    res.json({ deleted: true });
  }));

  /* --------------------------------- usage ------------------------------- */

  router.get('/api/ai/usage', requireUser, wrap(async (req, res) => {
    const settings = await getSettings();
    const [total] = await AiUsage.findAll({
      where: { userId: req.user.id },
      attributes: [[AiUsage.sequelize.fn('SUM', AiUsage.sequelize.col('totalTokens')), 'tokens'], [AiUsage.sequelize.fn('COUNT', AiUsage.sequelize.col('id')), 'calls']],
      raw: true,
    });
    const recent = await AiUsage.findAll({ where: { userId: req.user.id }, order: [['createdAt', 'DESC']], limit: 30 });
    res.json({
      today: await todayUsage(req.user.id),
      limit: settings.ai.limits.dailyTokens,
      totalTokens: Number(total?.tokens) || 0,
      totalCalls: Number(total?.calls) || 0,
      recent,
    });
  }));

  /* ------------------------------ admin APIs ----------------------------- */

  router.get('/api/ai/admin/settings', requireAdmin, wrap(async (req, res) => {
    const settings = await getSettings();
    res.json({
      ai: {
        ...settings.ai,
        providers: settings.ai.providers.map((p) => ({ ...p, apiKey: '', hasKey: !!resolveApiKey(p) })),
      },
      public: publicAiSettings(settings.ai),
    });
  }));

  router.post('/api/ai/admin/refresh-models', requireAdmin, wrap(async (req, res) => {
    const settings = await getSettings();
    const provider = settings.ai.providers.find((p) => p.id === req.body?.providerId);
    if (!provider) return res.status(404).json({ error: 'provider not found' });
    const models = await discoverModels(provider);
    const providers = settings.ai.providers.map((p) => (p.id === provider.id ? { ...p, models } : p));
    await (await import('../db.js')).saveSettings({ ai: { providers } });
    modelCache.set(provider.id, { models, at: Date.now() });
    res.json({ providerId: provider.id, models });
  }));

  router.post('/api/ai/admin/test-mcp', requireAdmin, wrap(async (req, res) => {
    const settings = await getSettings();
    const server = settings.ai.mcpServers.find((s) => s.id === req.body?.id);
    if (!server) return res.status(404).json({ error: 'MCP server not found' });
    try {
      const tools = await listExternalTools(server);
      res.json({ server: server.name, tools: tools.map((t) => ({ name: t.name, description: t.description })) });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }));

  router.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: err.message || 'AI request failed' });
  });

  return router;
}
