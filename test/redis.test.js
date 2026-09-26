import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeCommand, parseResponse, RedisStateStore } from '../src/redis.js';

test('Redis command encoder does not expose protocol ambiguity', () => {
  assert.equal(encodeCommand(['SET', 'key', 'value']).toString(), '*3\r\n$3\r\nSET\r\n$3\r\nkey\r\n$5\r\nvalue\r\n');
});
test('Redis parser handles arrays, nulls, and integers', () => {
  const response = parseResponse(Buffer.from('*3\r\n$5\r\nvalue\r\n$-1\r\n:7\r\n'));
  assert.deepEqual(response.value, ['value', null, 7]);
});

test('notification toggle uses one atomic Redis script and returns the resulting state', async () => {
  let command;
  const store = new RedisStateStore({
    command: async (parts) => {
      command = parts;
      return [1, '0'];
    },
  });

  assert.deepEqual(await store.applyNotificationCommand('message001', 'toggle', 86400), {
    applied: true,
    enabled: false,
  });
  assert.equal(command[0], 'EVAL');
  assert.equal(command[2], '2');
  assert.match(command[3], /control-message:message001$/);
  assert.match(command[4], /notifications-enabled$/);
  assert.deepEqual(command.slice(-2), [86400, 'toggle']);
});
