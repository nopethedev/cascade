import { DataTypes } from 'sequelize';
import { sequelize } from '../db.js';

/* Conversations are a message tree. `parentId` links each message to the one it
 * replied to, which is what makes branching and regeneration cheap: a branch is
 * simply a different child, and the active path is resolved from the leaf. */
export const AiConversation = sequelize.define(
  'aiConversation',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    ownerId: { type: DataTypes.STRING(36), allowNull: false },
    title: { type: DataTypes.STRING(180), allowNull: false, defaultValue: 'New conversation' },
    folderId: { type: DataTypes.STRING(36), allowNull: true },
    assistantId: { type: DataTypes.STRING(36), allowNull: true },
    providerId: { type: DataTypes.STRING(48), allowNull: true },
    model: { type: DataTypes.STRING(160), allowNull: true },
    systemPrompt: { type: DataTypes.TEXT, allowNull: true },
    pinned: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    archived: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    activeLeafId: { type: DataTypes.STRING(36), allowNull: true },
    lastMessageAt: { type: DataTypes.DATE, allowNull: true },
    meta: { type: DataTypes.JSON, defaultValue: {} },
  },
  { tableName: 'ai_conversations', indexes: [{ fields: ['ownerId'] }, { fields: ['folderId'] }, { fields: ['lastMessageAt'] }] },
);

export const AiMessage = sequelize.define(
  'aiMessage',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    conversationId: { type: DataTypes.STRING(36), allowNull: false },
    parentId: { type: DataTypes.STRING(36), allowNull: true },
    role: { type: DataTypes.STRING(16), allowNull: false },
    content: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    attachments: { type: DataTypes.JSON, defaultValue: [] },
    toolCalls: { type: DataTypes.JSON, defaultValue: [] },
    toolCallId: { type: DataTypes.STRING(120), allowNull: true },
    toolName: { type: DataTypes.STRING(120), allowNull: true },
    providerId: { type: DataTypes.STRING(48), allowNull: true },
    model: { type: DataTypes.STRING(160), allowNull: true },
    usage: { type: DataTypes.JSON, defaultValue: {} },
    status: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'complete' },
    error: { type: DataTypes.TEXT, allowNull: true },
    meta: { type: DataTypes.JSON, defaultValue: {} },
  },
  { tableName: 'ai_messages', indexes: [{ fields: ['conversationId'] }, { fields: ['parentId'] }, { fields: ['createdAt'] }] },
);

export const AiFolder = sequelize.define(
  'aiFolder',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    ownerId: { type: DataTypes.STRING(36), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
  },
  { tableName: 'ai_folders', indexes: [{ fields: ['ownerId'] }] },
);

export const AiAssistant = sequelize.define(
  'aiAssistant',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    ownerId: { type: DataTypes.STRING(36), allowNull: false },
    name: { type: DataTypes.STRING(80), allowNull: false },
    description: { type: DataTypes.STRING(240), allowNull: true },
    systemPrompt: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
    providerId: { type: DataTypes.STRING(48), allowNull: true },
    model: { type: DataTypes.STRING(160), allowNull: true },
    icon: { type: DataTypes.STRING(8), allowNull: true },
    temperature: { type: DataTypes.FLOAT, allowNull: true },
    toolsEnabled: { type: DataTypes.BOOLEAN, defaultValue: true },
    knowledgeIds: { type: DataTypes.JSON, defaultValue: [] },
    meta: { type: DataTypes.JSON, defaultValue: {} },
  },
  { tableName: 'ai_assistants', indexes: [{ fields: ['ownerId'] }] },
);

export const AiKnowledge = sequelize.define(
  'aiKnowledge',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    ownerId: { type: DataTypes.STRING(36), allowNull: false },
    name: { type: DataTypes.STRING(120), allowNull: false },
    description: { type: DataTypes.STRING(300), allowNull: true },
    embeddingProviderId: { type: DataTypes.STRING(48), allowNull: true },
    embeddingModel: { type: DataTypes.STRING(160), allowNull: true },
    dimensions: { type: DataTypes.INTEGER, defaultValue: 256 },
    documentCount: { type: DataTypes.INTEGER, defaultValue: 0 },
    meta: { type: DataTypes.JSON, defaultValue: {} },
  },
  { tableName: 'ai_knowledge', indexes: [{ fields: ['ownerId'] }] },
);

export const AiKnowledgeDoc = sequelize.define(
  'aiKnowledgeDoc',
  {
    id: { type: DataTypes.STRING(36), primaryKey: true },
    knowledgeId: { type: DataTypes.STRING(36), allowNull: false },
    ownerId: { type: DataTypes.STRING(36), allowNull: false },
    filename: { type: DataTypes.STRING(240), allowNull: false },
    mime: { type: DataTypes.STRING(120), allowNull: true },
    size: { type: DataTypes.INTEGER, defaultValue: 0 },
    text: { type: DataTypes.TEXT, allowNull: true },
    chunks: { type: DataTypes.JSON, defaultValue: [] },
    status: { type: DataTypes.STRING(24), defaultValue: 'ready' },
    error: { type: DataTypes.TEXT, allowNull: true },
  },
  { tableName: 'ai_knowledge_docs', indexes: [{ fields: ['knowledgeId'] }, { fields: ['ownerId'] }] },
);

/* Per-user AI preferences and personal MCP servers. Global MCP servers remain
 * in the singleton settings row; personal tokens never enter that shared row or
 * any browser response. */
export const AiUserConfig = sequelize.define(
  'aiUserConfig',
  {
    ownerId: { type: DataTypes.STRING(36), primaryKey: true },
    mcpServers: { type: DataTypes.JSON, defaultValue: [] },
    thinking: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'auto' },
    effort: { type: DataTypes.STRING(8), allowNull: false, defaultValue: 'auto' },
  },
  { tableName: 'ai_user_configs' },
);

export const AiUsage = sequelize.define(
  'aiUsage',
  {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    userId: { type: DataTypes.STRING(36), allowNull: false },
    conversationId: { type: DataTypes.STRING(36), allowNull: true },
    messageId: { type: DataTypes.STRING(36), allowNull: true },
    providerId: { type: DataTypes.STRING(48), allowNull: true },
    model: { type: DataTypes.STRING(160), allowNull: true },
    kind: { type: DataTypes.STRING(24), allowNull: false, defaultValue: 'chat' },
    promptTokens: { type: DataTypes.INTEGER, defaultValue: 0 },
    completionTokens: { type: DataTypes.INTEGER, defaultValue: 0 },
    totalTokens: { type: DataTypes.INTEGER, defaultValue: 0 },
  },
  { tableName: 'ai_usage', indexes: [{ fields: ['userId'] }, { fields: ['createdAt'] }] },
);
