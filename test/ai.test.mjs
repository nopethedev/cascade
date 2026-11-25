import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultAiSettings, normalizeAiSettings, normalizeBaseUrl, normalizeEffort, normalizeMcpServers, normalizeThinking, publicAiSettings, publicUserConfig } from '../src/ai/config.js';

test('normalizeAiSettings restores settings stored as a SQLite JSON string', () => {
  const raw = {
    ...defaultAiSettings(),
    defaultProviderId: 'mock',
    providers: [{ id: 'mock', name: 'Mock', type: 'openai', baseUrl: 'https://example.test/v1', apiKey: 'secret', enabled: true, models: [{ id: 'm1' }] }],
  };
  const parsed = normalizeAiSettings(JSON.stringify(raw));
  assert.equal(parsed.defaultProviderId, 'mock');
  assert.equal(parsed.providers[0].id, 'mock');
  assert.equal(parsed.providers[0].apiKey, 'secret');
  assert.equal(parsed.providers[0].models[0].id, 'm1');
});

test('normalizeAiSettings falls back safely for corrupt JSON', () => {
  const parsed = normalizeAiSettings('{not json');
  assert.equal(parsed.enabled, true);
  assert.ok(parsed.providers.length >= 2);
  assert.equal(parsed.limits.maxTokens, 4096);
});

test('publicAiSettings never exposes provider or search keys', () => {
  const settings = normalizeAiSettings({
    ...defaultAiSettings(),
    defaultProviderId: 'custom',
    providers: [{ id: 'custom', name: 'Custom', type: 'compatible', baseUrl: 'https://example.test/v1', apiKey: 'sk-secret', enabled: true, models: [{ id: 'model-a' }] }],
    search: { provider: 'tavily', apiKey: 'tvly-secret', endpoint: 'https://example.test' },
  });
  const publicSettings = publicAiSettings(settings);
  const serialized = JSON.stringify(publicSettings);
  assert.equal(serialized.includes('sk-secret'), false);
  assert.equal(serialized.includes('tvly-secret'), false);
  assert.equal(publicSettings.providers[0].hasKey, true);
  assert.deepEqual(publicSettings.providers[0].models.map((model) => model.id), ['model-a']);
  assert.equal(publicSettings.defaultProviderId, 'custom');
});

test('hasKey uses apiKeyEnv without copying the value into public settings', (t) => {
  const previous = process.env.CASCADE_AI_TEST_KEY;
  process.env.CASCADE_AI_TEST_KEY = 'env-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.CASCADE_AI_TEST_KEY;
    else process.env.CASCADE_AI_TEST_KEY = previous;
  });
  const settings = normalizeAiSettings({
    ...defaultAiSettings(),
    providers: [{ id: 'env', name: 'Env', type: 'openai', baseUrl: 'https://example.test/v1', apiKeyEnv: 'CASCADE_AI_TEST_KEY', enabled: true }],
  });
  const publicSettings = publicAiSettings(settings);
  assert.equal(publicSettings.providers[0].hasKey, true);
  assert.equal(JSON.stringify(publicSettings).includes('env-secret'), false);
});

test('normalizeBaseUrl accepts http(s) and rejects other protocols', () => {
  assert.equal(normalizeBaseUrl('https://example.test/v1/'), 'https://example.test/v1');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
  assert.equal(normalizeBaseUrl('ftp://example.test'), '');
  assert.equal(normalizeBaseUrl('javascript:alert(1)'), '');
});

test('thinking and effort preferences only accept supported modes', () => {
  assert.equal(normalizeThinking('on'), 'on');
  assert.equal(normalizeThinking('extended'), 'auto');
  assert.equal(normalizeEffort('high'), 'high');
  assert.equal(normalizeEffort('maximum'), 'auto');
});

test('personal MCP configuration validates URLs and never exposes tokens', () => {
  const servers = normalizeMcpServers([
    { id: 'personal-a', name: 'A', url: 'https://mcp.example.test/mcp', token: 'personal-secret', enabled: true },
    { id: 'bad', name: 'Bad', url: 'javascript:alert(1)', token: 'bad' },
  ]);
  assert.equal(servers.length, 1);
  assert.equal(servers[0].id, 'personal-a');
  const publicConfig = publicUserConfig({ thinking: 'on', effort: 'high', mcpServers: servers });
  assert.equal(publicConfig.thinking, 'on');
  assert.equal(publicConfig.effort, 'high');
  assert.equal(publicConfig.mcpServers[0].hasToken, true);
  assert.equal(JSON.stringify(publicConfig).includes('personal-secret'), false);
});

test('AI defaults include confirmation, bounded limits and no credential', () => {
  const defaults = defaultAiSettings();
  assert.equal(defaults.confirmDestructive, true);
  assert.ok(defaults.limits.maxToolIterations >= 1);
  assert.ok(defaults.limits.dailyTokens >= 0);
  assert.equal(defaults.providers.every((provider) => !provider.apiKey), true);
});
