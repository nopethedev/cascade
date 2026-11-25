/* Attachment reading for chat. Images become data URLs for vision models; text,
 * CSV, JSON, Markdown and PDFs are extracted to text. PDF parsing is imported
 * lazily so ordinary chats never load pdf.js. */
import { FileRecord } from '../db.js';
import { readFileWithFallback } from '../storage.js';

const TEXT_EXT = /\.(txt|md|markdown|json|csv|tsv|log|yml|yaml|toml|ini|xml|html|css|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|sh|sql|srt|vtt)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 120000;

export async function loadAttachment(fileId, ownerId) {
  const file = await FileRecord.findOne({ where: { id: String(fileId), ownerId } });
  if (!file) throw new Error('attachment not found');
  const { buffer } = await readFileWithFallback(file);
  return { file, buffer };
}

export async function extractAttachmentText(file, buffer) {
  const mime = String(file.mime || '');
  if (mime === 'application/pdf' || /\.pdf$/i.test(file.filename)) {
    try {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), disableWorker: true, useSystemFonts: true }).promise;
      const pages = [];
      const limit = Math.min(doc.numPages, 80);
      for (let i = 1; i <= limit; i += 1) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((item) => item.str).join(' '));
      }
      await doc.destroy();
      return pages.join('\n\n').slice(0, MAX_TEXT_CHARS);
    } catch (err) {
      return `[PDF text extraction failed: ${err.message}]`;
    }
  }
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || TEXT_EXT.test(file.filename)) {
    return buffer.toString('utf8').slice(0, MAX_TEXT_CHARS);
  }
  return '';
}

export async function attachmentParts(attachments, ownerId, limits = {}) {
  const maxBytes = limits.maxAttachmentBytes || 20 * 1024 * 1024;
  const parts = [];
  const notes = [];
  for (const attachment of attachments || []) {
    const id = String(attachment.id || attachment.fileId || '');
    if (!id) continue;
    try {
      const { file, buffer } = await loadAttachment(id, ownerId);
      if (file.size > maxBytes) {
        notes.push(`${file.filename}: too large to attach (limit ${Math.round(maxBytes / 1048576)} MB)`);
        continue;
      }
      const mime = String(file.mime || '');
      if (mime.startsWith('image/')) {
        if (buffer.length <= MAX_IMAGE_BYTES) {
          const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
          parts.push({ type: 'image_url', image_url: { url: dataUrl }, filename: file.filename, fileId: file.id });
        } else {
          notes.push(`${file.filename}: image is too large to send to a vision model`);
        }
        continue;
      }
      const text = await extractAttachmentText(file, buffer);
      if (text.trim()) {
        parts.push({ type: 'text', text: `File: ${file.filename}\n\n${text}`, filename: file.filename, fileId: file.id });
      } else {
        notes.push(`${file.filename}: this file type has no readable text`);
      }
    } catch (err) {
      notes.push(`${attachment.filename || id}: ${err.message}`);
    }
  }
  return { parts, notes };
}

export function partsToContent(text, parts) {
  const content = [];
  if (text) content.push({ type: 'text', text });
  for (const part of parts) content.push(part.type === 'image_url' ? part : { type: 'text', text: part.text });
  return content.length === 1 && content[0].type === 'text' ? content[0].text : content;
}
