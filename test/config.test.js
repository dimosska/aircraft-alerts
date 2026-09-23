import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.js';

function validEnvironment() {
  return {
    REDIS_PASSWORD: 'local-redis-password',
    HOME_LAT: '50.1',
    HOME_LON: '19.2',
    OPENSKY_CLIENT_ID: 'client-id',
    OPENSKY_CLIENT_SECRET: 'client-secret',
    NTFY_TOPIC_IPHONE_1: 'a'.repeat(40),
    NTFY_TOPIC_IPHONE_2: 'b'.repeat(40),
  };
}

test('configuration requires long unguessable ntfy topics', () => {
  assert.throws(
    () => loadConfig({ ...validEnvironment(), NTFY_TOPIC_IPHONE_1: 'short' }),
    /at least 32 characters/,
  );
});
test('configuration accepts OpenSky production defaults', () => {
  const config = loadConfig(validEnvironment());
  assert.equal(config.adsbSource, 'opensky');
  assert.equal(config.pollIntervalSeconds, 30);
  assert.equal(config.notifications.targets.length, 2);
  assert.deepEqual(config.home, { lat: 50.1, lon: 19.2, elevationMeters: 0 });
});
