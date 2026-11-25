/* Knowledge bases: chunking, embeddings and retrieval.
 *
 * When an embedding provider is configured the real provider is used. Without
 * one, a deterministic local hashing embedding keeps RAG usable offline; it is
 * lexical rather than semantic, and that limitation is reported by the API. */
import { AiKnowledgeDoc } from './models.js';
import { embedTexts } from './providers.js';
import { findProvider } from './config.js';

const CHUNK_CHARS = 1400;
const CHUNK_OVERLAP = 220;

export function chunkText(input) {
  const text = String(input || '').replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = '';
  const push = () => {
    const value = current.trim();
    if (value.length >= 40) chunks.push(value);
    current = '';
  };
  for (const paragraph of paragraphs) {
    const piece = paragraph.trim();
    if (!piece) continue;
    if (piece.length > CHUNK_CHARS) {
      push();
      for (let i = 0; i < piece.length; i += CHUNK_CHARS - CHUNK_OVERLAP) {
        chunks.push(piece.slice(i, i + CHUNK_CHARS));
      }
      continue;
    }
    if ((current + '\n\n' + piece).length > CHUNK_CHARS) {
      const carry = current.slice(-CHUNK_OVERLAP);
      push();
      current = carry ? `${carry}\n\n${piece}` : piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  push();
  return chunks.slice(0, 400);
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function localEmbedding(text, dimensions = 256) {
  const dims = Math.max(32, Math.min(1024, Number(dimensions) || 256));
  const vector = new Float32Array(dims);
  const tokens = String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [];
  const add = (token, weight) => {
    const index = fnv1a(token) % dims;
    const sign = fnv1a(`s:${token}`) % 2 === 0 ? 1 : -1;
    vector[index] += sign * weight;
  };
  for (let i = 0; i < tokens.length; i += 1) {
    add(tokens[i], 1);
    if (i + 1 < tokens.length) add(`${tokens[i]} ${tokens[i + 1]}`, 0.5);
  }
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dims; i += 1) vector[i] /= norm;
  return Array.from(vector);
}

export function embeddingPlan(settings, knowledge) {
  const provider = knowledge.embeddingProviderId
    ? findProvider(settings, knowledge.embeddingProviderId)
    : findProvider(settings, settings.embedding?.providerId);
  const model = knowledge.embeddingModel || settings.embedding?.model || '';
  if (provider && model) return { provider, model, providerId: provider.id, dimensions: knowledge.dimensions || 0, local: false };
  return { provider: null, model: 'local-hash', providerId: 'local', dimensions: settings.embedding?.localDimensions || 256, local: true };
}

export async function embedDocuments(settings, knowledge, texts) {
  const plan = embeddingPlan(settings, knowledge);
  if (plan.local) {
    return {
      vectors: texts.map((text) => localEmbedding(text, plan.dimensions)),
      providerId: 'local',
      model: plan.model,
      dimensions: plan.dimensions,
    };
  }
  try {
    const vectors = await embedTexts(plan.provider, { model: plan.model, texts });
    return { vectors, providerId: plan.providerId, model: plan.model, dimensions: vectors[0]?.length || 0 };
  } catch (err) {
    // A provider outage should not make an existing knowledge base unusable.
    const dims = settings.embedding?.localDimensions || 256;
    return {
      vectors: texts.map((text) => localEmbedding(text, dims)),
      providerId: 'local',
      model: 'local-hash',
      dimensions: dims,
      warning: `Embedding provider failed (${err.message}); indexed with local embeddings instead.`,
    };
  }
}

export function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / Math.sqrt(na * nb);
}

export async function searchKnowledge({ ownerId, knowledgeIds, query, settings, topK = 6 }) {
  if (!knowledgeIds?.length || !query) return { hits: [], provider: 'local' };
  const plan = embeddingPlan(settings, { embeddingProviderId: '', embeddingModel: '', dimensions: 0 });
  let queryVector;
  try {
    if (plan.local) {
      queryVector = localEmbedding(query, plan.dimensions);
    } else {
      const [vector] = await embedTexts(plan.provider, { model: plan.model, texts: [query] });
      queryVector = vector;
    }
  } catch {
    queryVector = localEmbedding(query, settings.embedding?.localDimensions || 256);
  }
  const docs = await AiKnowledgeDoc.findAll({
    where: { ownerId, knowledgeId: knowledgeIds },
    attributes: ['id', 'knowledgeId', 'filename', 'chunks'],
    limit: 500,
  });
  const hits = [];
  for (const doc of docs) {
    for (const chunk of doc.chunks || []) {
      if (!chunk?.text || !Array.isArray(chunk.embedding)) continue;
      if (chunk.embedding.length !== queryVector.length) continue;
      const score = cosine(queryVector, chunk.embedding);
      if (score > 0.08) hits.push({ docId: doc.id, knowledgeId: doc.knowledgeId, filename: doc.filename, text: chunk.text, score });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  const trimmed = hits.slice(0, Math.max(1, Math.min(20, topK)));
  return { hits: trimmed, provider: plan.local ? 'local' : plan.providerId };
}

export function knowledgePrompt(hits) {
  if (!hits?.length) return '';
  const body = hits.map((hit, index) => `[${index + 1}] ${hit.filename}\n${hit.text.slice(0, 1600)}`).join('\n\n');
  return `Relevant excerpts from the user's knowledge bases. Cite them as [1], [2] when used:\n\n${body}`;
}
