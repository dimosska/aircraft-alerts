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
  assert.equal(config.prediction.maxCandidateAltitudeFeet, 5000);
  assert.equal(config.prediction.minAirportDistanceKilometers, 8);
  assert.equal(config.prediction.maxAirportDistanceKilometers, 50);
  assert.equal(config.prediction.minTrueTrackDegrees, 180);
  assert.equal(config.prediction.maxTrueTrackDegrees, 270);
  assert.equal(config.notifications.targets.length, 2);
  assert.deepEqual(config.aircraftFilter.allowedCategories, [3, 4, 5, 6, 7]);
  assert.equal(config.aircraftFilter.allowOperatorCallsignFallback, true);
  assert.deepEqual(config.home, { lat: 50.1, lon: 19.2, elevationMeters: 0 });
});

test('true-track bounds must be ordered', () => {
  assert.throws(
    () => loadConfig({ ...validEnvironment(), MIN_TRUE_TRACK_DEGREES: '270' }),
    /must be smaller/,
  );
});

test('minimum airport distance must be inside the OpenSky search radius', () => {
  assert.throws(
    () => loadConfig({ ...validEnvironment(), MIN_AIRPORT_DISTANCE_KM: '50' }),
    /must be smaller/,
  );
});

test('aircraft filter validates ADS-B categories and ICAO24 addresses', () => {
  assert.throws(
    () => loadConfig({ ...validEnvironment(), AIRCRAFT_ADSB_CATEGORY_ALLOWLIST: '3,21' }),
    /between 0 and 20/,
  );
  assert.throws(
    () => loadConfig({ ...validEnvironment(), AIRCRAFT_ICAO24_ALLOWLIST: 'not-hex' }),
    /6-digit hexadecimal/,
  );
});
