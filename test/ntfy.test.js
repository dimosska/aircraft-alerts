import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NtfyClient, NtfyControlClient } from '../src/ntfy.js';

test('ntfy client RFC 2047 encodes a Unicode title', async () => {
  let request;
  const client = new NtfyClient({
    baseUrl: 'https://ntfy.sh',
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response('', { status: 200 });
    },
  });

  await client.publish('safe-topic', {
    title: 'Літак знижується: TEST123',
    message: 'Unicode body is valid: літак',
  });

  assert.equal(request.url, 'https://ntfy.sh/safe-topic');
  assert.match(request.options.headers.title, /^=\?UTF-8\?B\?[A-Za-z0-9+/]+=*\?=$/);
  assert.equal(request.options.body, 'Unicode body is valid: літак');
});

test('ntfy control client polls cached NDJSON messages from a cursor', async () => {
  let requestedUrl;
  const client = new NtfyControlClient({
    baseUrl: 'https://ntfy.sh',
    topic: 'private-control-topic',
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return {
        ok: true,
        text: async () => [
          JSON.stringify({ id: 'first123', event: 'message', message: 'toggle', time: 100 }),
          JSON.stringify({ id: 'second12', event: 'message', message: 'off', time: 101 }),
        ].join('\n'),
      };
    },
  });

  const messages = await client.messagesSince('cursor123');
  assert.match(requestedUrl, /private-control-topic\/json\?poll=1&since=cursor123$/);
  assert.deepEqual(messages.map((message) => message.id), ['first123', 'second12']);
});
