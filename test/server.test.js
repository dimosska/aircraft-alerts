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

test('control sync and notification status remain private service endpoints', async () => {
  const responses = [];
  const response = () => ({
    writeHead(status) { responses.push({ status }); },
    end(body) { responses.at(-1).body = JSON.parse(body); },
  });
  const service = { stateStore: { notificationsEnabled: async () => false } };
  const controlService = { sync: async () => ({ status: 'ok', applied: 1, enabled: false }) };

  await handleRequest({ method: 'POST', url: '/control/sync' }, response(), service, controlService);
  await handleRequest({ method: 'GET', url: '/notifications/status' }, response(), service, controlService);

  assert.deepEqual(responses, [
    { status: 200, body: { status: 'ok', applied: 1, enabled: false } },
    { status: 200, body: { enabled: false } },
  ]);
});
