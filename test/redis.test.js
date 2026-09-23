import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCommand, parseResponse } from '../src/redis.js';

test('Redis command encoder does not expose protocol ambiguity', () => {
  assert.equal(encodeCommand(['SET', 'key', 'value']).toString(), '*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n');
});
test('Redis parser handles arrays, nulls, and integers', () => {
  const response = parseResponse(Buffer.from('*3\r\n$5\r\nvalue\r\n$-1\r\n:7\r\n'));
  assert.deepEqual(response.value, ['value', null, 7]);
});
