/* Credential scanning shared by the Flow compiler, API responses and editor.
   Flow graphs must store environment variable *names*, never raw credentials. */

const SENSITIVE_KEYS = new Set([
  'token', 'password', 'secret', 'apikey', 'api_key', 'authorization',
  'credentials', 'privatekey', 'private_key', 'clientsecret', 'client_secret',
  'accesstoken', 'access_token', 'refreshtoken', 'refresh_token',
]);

const SECRET_PATTERNS = [
  /sk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AIza[0-9A-Za-z_-]{30,}/g,
  /mongodb(?:\+srv)?:\/\/[^/\s@]+:[^@\s]+@/g,
  /postgres(?:ql)?:\/\/[^/\s@]+:[^@\s]+@/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/g,
];

const PLACEHOLDERS = /^(?:your[-_ ]|example|placeholder|changeme|replace[-_ ]|todo|test[-_ ]|demo[-_ ]|x{4,})/i;

function normalizedKey(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isEnvNameKey(key) {
  return /env$/i.test(String(key || ''));
}

function isSensitiveKey(key) {
  if (isEnvNameKey(key)) return false;
  return SENSITIVE_KEYS.has(normalizedKey(key));
}

function isPlaceholder(value) {
  const text = String(value ?? '').trim();
  return !text || text.length < 8 || PLACEHOLDERS.test(text) || /^[<{[]/.test(text);
}

function matchesSecret(value) {
  const text = String(value ?? '');
  return SECRET_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

function pathFor(parts) {
  return parts.map((part) => (typeof part === 'number' ? `[${part}]` : String(part))).join('.');
}

export function scanFlowSecrets(value) {
  const findings = [];
  const walk = (node, parts) => {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...parts, index]));
      return;
    }
    if (typeof node === 'object') {
      for (const [key, child] of Object.entries(node)) {
        const next = [...parts, key];
        if (isSensitiveKey(key) && (typeof child === 'string' || typeof child === 'number') && !isPlaceholder(child)) {
          findings.push({ path: pathFor(next), key, reason: 'credential-shaped field' });
        }
        walk(child, next);
      }
      return;
    }
    if (typeof node === 'string' && matchesSecret(node)) {
      findings.push({ path: pathFor(parts), key: parts[parts.length - 1] || '', reason: 'credential-shaped value' });
    }
  };
  walk(value, []);
  return findings;
}

export function redactFlowSecrets(value) {
  const clean = (node) => {
    if (Array.isArray(node)) return node.map(clean);
    if (node && typeof node === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(node)) {
        if (isSensitiveKey(key) && (typeof child === 'string' || typeof child === 'number') && !isPlaceholder(child)) {
          out[key] = '[redacted]';
          continue;
        }
        out[key] = clean(child);
      }
      return out;
    }
    if (typeof node === 'string') {
      let text = node;
      for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, '[redacted]');
      return text;
    }
    return node;
  };
  return clean(value);
}

export function flowContainsSecrets(value) {
  return scanFlowSecrets(value).length > 0;
}
