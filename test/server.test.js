import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleRequest } from '../src/server.js';

test('health endpoint reports ok', async () => {
  let status;
  let headers;
  let body;
  const response = {
    writeHead(value, valueHeaders) {
      status = value;
      headers = valueHeaders;
    },
    end(value) {
      body = value;
    },
  };

  await handleRequest({ method: 'GET', url: '/health' }, response);

  assert.equal(status, 200);
  assert.deepEqual(headers, { 'content-type': 'application/json' });
  assert.deepEqual(JSON.parse(body), { status: 'ok' });
});
