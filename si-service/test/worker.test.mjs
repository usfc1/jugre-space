import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';

const environment = { OPENAI_API_KEY: 'test-secret', SI_RATE_LIMIT: { limit: async () => ({ success: true }) } };
const request = body => new Request('https://example.test/mission', { method: 'POST',
  headers: { 'content-type': 'application/json', 'cf-connecting-ip': '192.0.2.1' }, body: JSON.stringify(body) });

test('allows browsers to call the public mission endpoint without credentials', async () => {
  const preflight = await worker.fetch(new Request('https://example.test/mission', { method: 'OPTIONS',
    headers: { origin: 'http://127.0.0.1:4179', 'access-control-request-method': 'POST' } }), environment);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), '*');
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
});

test('applies the per-client limit and rejects oversized requests', async () => {
  let receivedKey;
  const limited = await worker.fetch(request({ prompt: 'Orbit Earth' }), { ...environment,
    SI_RATE_LIMIT: { limit: async ({ key }) => { receivedKey = key; return { success: false }; } } });
  assert.equal(limited.status, 429);
  assert.equal(receivedKey, '192.0.2.1');
  assert.equal(limited.headers.get('access-control-allow-origin'), '*');
  assert.equal((await worker.fetch(request({ prompt: 'x'.repeat(3001) }), environment)).status, 400);
});

test('sends anonymous requests to the selected model without revealing the secret', async () => {
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, init) => {
    captured = { url, init, body: JSON.parse(init.body) };
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
      status: 'ready', message: 'A proposal is ready for engineering checks.', assumptions: [],
      mission: { name: 'Orbital test', destination: 'earth', goal: 'orbit', crewCount: 0, payloadMassKg: 10, returnRequired: false },
    }) }] }] });
  };
  try {
    const result = await worker.fetch(request({ prompt: 'Orbit Earth with 10 kg' }), environment);
    const output = await result.json();
    assert.equal(result.status, 200);
    assert.equal(captured.url, 'https://api.openai.com/v1/responses');
    assert.equal(captured.body.model, 'gpt-6.1-terra');
    assert.equal(captured.body.reasoning.effort, 'medium');
    assert.equal(captured.body.store, false);
    assert.equal(output.mission.payloadMassKg, 10);
    assert.ok(!JSON.stringify(output).includes(environment.OPENAI_API_KEY));
  } finally { globalThis.fetch = original; }
});

test('does not expose upstream error bodies', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response('upstream private details', { status: 401 });
  try {
    const result = await worker.fetch(request({ prompt: 'Orbit Earth' }), environment);
    assert.equal(result.status, 502);
    assert.ok(!(await result.text()).includes('upstream private details'));
  } finally { globalThis.fetch = original; }
});
