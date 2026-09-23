import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NtfyClient } from '../src/ntfy.js';

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
