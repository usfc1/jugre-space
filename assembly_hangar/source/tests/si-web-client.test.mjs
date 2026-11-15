import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebSiClient } from '../si-web-client.mjs';

test('web SI makes a credential-free request to the configured service', async () => {
  let sent;
  const browser = { fetch: async (url, options) => { sent = { url, options }; return Response.json({ status: 'ready' }); } };
  const client = createWebSiClient({ browser, serviceOrigin: 'https://si.example.test' });
  assert.equal((await client.propose('Orbit Earth')).status, 'ready');
  assert.equal(sent.url, 'https://si.example.test/mission');
  assert.equal(sent.options.credentials, 'omit');
  assert.equal(JSON.parse(sent.options.body).prompt, 'Orbit Earth');
  assert.ok(!('Authorization' in sent.options.headers));
});

test('web SI reports service errors and respects cancellation', async () => {
  const errorClient = createWebSiClient({ browser: { fetch: async () => Response.json({ error: 'Try again.' }, { status: 429 }) },
    serviceOrigin: 'https://si.example.test' });
  await assert.rejects(errorClient.propose('Orbit Earth'), /Try again/);
  const controller = new AbortController();
  controller.abort();
  const client = createWebSiClient({ browser: { fetch: async (_url, options) => { options.signal.throwIfAborted(); } },
    serviceOrigin: 'https://si.example.test' });
  await assert.rejects(client.propose('Orbit Earth', { signal: controller.signal }), { name: 'AbortError' });
});
