import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ControlService } from '../src/control-service.js';

class MemoryControlStore {
  constructor() {
    this.enabled = true;
    this.cursor = null;
    this.processed = new Set();
  }
  async notificationsEnabled() { return this.enabled; }
  async getControlCursor() { return this.cursor; }
  async setControlCursor(value) { this.cursor = value; }
  async applyNotificationCommand(id, command) {
    if (this.processed.has(id)) return { applied: false, enabled: this.enabled };
    this.processed.add(id);
    if (command === 'toggle') this.enabled = !this.enabled;
    if (command === 'on') this.enabled = true;
    if (command === 'off') this.enabled = false;
    return { applied: true, enabled: this.enabled };
  }
}

function config() {
  return {
    control: {
      enabled: true,
      initialReplaySeconds: 60,
      maxCommandAgeSeconds: 120,
      deduplicationTtlSeconds: 86400,
    },
    notifications: {
      targets: [
        { id: 'iphone1', topic: 'phone-one' },
        { id: 'iphone2', topic: 'phone-two' },
      ],
    },
  };
}

test('a fresh toggle command atomically disables notifications and confirms both phones', async () => {
  const store = new MemoryControlStore();
  const published = [];
  const logs = [];
  const service = new ControlService({
    config: config(),
    stateStore: store,
    controlClient: {
      messagesSince: async (since) => {
        assert.equal(since, '60s');
        return [{ id: 'message001', event: 'message', message: 'toggle', time: 1_000 }];
      },
    },
    ntfyClient: { publish: async (...values) => published.push(values) },
    logger: (level, event, fields) => logs.push({ level, event, ...fields }),
    nowMilliseconds: () => 1_030_000,
  });

  assert.deepEqual(await service.sync(), {
    status: 'ok', messages: 1, applied: 1, ignored: 0, enabled: false,
  });
  assert.equal(store.cursor, 'message001');
  assert.equal(published.length, 2);
  assert.match(published[0][1].message, /вимкнено/);
  assert.equal(logs[0].event, 'notifications_toggled');
});

test('duplicate, invalid and stale commands do not change state', async () => {
  const store = new MemoryControlStore();
  store.processed.add('duplicate1');
  const service = new ControlService({
    config: config(),
    stateStore: store,
    controlClient: {
      messagesSince: async () => [
        { id: 'duplicate1', event: 'message', message: 'toggle', time: 1_000 },
        { id: 'invalid001', event: 'message', message: 'launch', time: 1_000 },
        { id: 'stale0001', event: 'message', message: 'off', time: 800 },
      ],
    },
    ntfyClient: { publish: async () => assert.fail('must not confirm') },
    logger: () => {},
    nowMilliseconds: () => 1_030_000,
  });

  assert.deepEqual(await service.sync(), {
    status: 'ok', messages: 3, applied: 0, ignored: 2, enabled: true,
  });
  assert.equal(store.cursor, 'stale0001');
});

test('ntfy control failure degrades one sync without blocking the next', async () => {
  let calls = 0;
  const service = new ControlService({
    config: config(),
    stateStore: new MemoryControlStore(),
    controlClient: {
      messagesSince: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary ntfy failure');
        return [];
      },
    },
    ntfyClient: { publish: async () => {} },
    logger: () => {},
  });

  assert.equal((await service.sync()).status, 'degraded');
  assert.equal((await service.sync()).status, 'ok');
});
