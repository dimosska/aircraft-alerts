import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromLocalMeters } from '../src/geo.js';
import { PollService } from '../src/poll-service.js';

const origin = { lat: 50, lon: 19 };
const home = { ...fromLocalMeters({ x: -12_000, y: 0 }, origin), elevationMeters: 250 };
const airport = {
  icao: 'TEST',
  reference: origin,
  runways: [{ designator: '09', headingDegrees: 90, threshold: origin }],
};

class MemoryStateStore {
  constructor() {
    this.tracks = new Map();
    this.claims = new Set();
  }

  async getTracks(icao24Values) {
    return new Map(icao24Values.filter((value) => this.tracks.has(value)).map((value) => [value, this.tracks.get(value)]));
  }

  async saveTracks(tracks) {
    for (const track of tracks) this.tracks.set(track.icao24, track.state);
  }

  async claimAlert(approachId, targetId) {
    const key = `${approachId}:${targetId}`;
    if (this.claims.has(key)) return false;
    this.claims.add(key);
    return true;
  }

  async releaseAlert(approachId, targetId) {
    this.claims.delete(`${approachId}:${targetId}`);
  }

  async notificationsEnabled() {
    return true;
  }
}

function aircraftAt(timestamp, etaAtTimestamp) {
  const x = -12_000 - 100 * etaAtTimestamp;
  return {
    icao24: 'abc123',
    callsign: 'NJE123',
    category: 3,
    timestamp,
    ...fromLocalMeters({ x, y: 0 }, origin),
    altitudeMeters: 1400,
    speedMetersPerSecond: 100,
    trackDegrees: 225,
    verticalRateMetersPerSecond: -3,
  };
}

test('polling sends one notification per phone and suppresses repeated measurements', async () => {
  const times = [1740, 1770, 1800, 1830];
  const feeds = times.map((timestamp) => ({
    timestamp,
    states: [aircraftAt(timestamp, 1920 - timestamp)],
    rateLimitRemaining: '3999',
  }));
  const published = [];
  const logs = [];
  const stateStore = new MemoryStateStore();
  const service = new PollService({
    config: {
      home,
      pollIntervalSeconds: 0,
      opensky: { searchRadiusKm: 50 },
      aircraftFilter: {
        allowedIcao24: [],
        allowedCategories: [3, 4, 5, 6, 7],
        allowOperatorCallsignFallback: true,
      },
      trackHistorySeconds: 240,
      trackStateTtlSeconds: 900,
      prediction: {
        maxCandidateAltitudeFeet: 5000,
        minAirportDistanceKilometers: 8,
        maxAirportDistanceKilometers: 50,
        minDescentRateMetersPerSecond: 0.5,
      },
      notifications: {
        targets: [
          { id: 'iphone1', topic: 'topic-1' },
          { id: 'iphone2', topic: 'topic-2' },
        ],
      },
    },
    airport,
    adsbClient: { states: async () => feeds.shift() },
    stateStore,
    ntfyClient: { publish: async (topic, notification) => published.push({ topic, notification }) },
    logger: (level, event, fields) => logs.push({ level, event, ...fields }),
  });

  const alertingPoll = await service.poll();
  const repeatedPoll = await service.poll();

  assert.equal(alertingPoll.alerts.length, 2);
  assert.equal(repeatedPoll.alerts.length, 0);
  assert.equal(published.length, 2);
  assert.match(published[0].notification.message, /знижується поблизу KRK/);
  assert.match(published[0].notification.message, /до KRK:/);
  const accepted = logs.find((entry) => entry.event === 'aircraft_evaluated');
  assert.equal(accepted.decision, 'accepted');
  assert.equal(accepted.callsign, 'NJE123');
  assert.equal(accepted.altitudeFeet, 4593);
  assert.equal(accepted.trueTrackDegrees, 225);
  assert.deepEqual(accepted.rejectionReasons, []);
  assert.equal(
    logs.filter((entry) => entry.event === 'notification_suppressed').length,
    2,
  );
});

test('an ntfy failure is retried on the next workflow run', async () => {
  const times = [1740, 1770, 1800, 1830];
  const feeds = times.map((timestamp) => ({
    timestamp,
    states: [aircraftAt(timestamp, 1920 - timestamp)],
    rateLimitRemaining: '3999',
  }));
  let publishAttempts = 0;
  const service = new PollService({
    config: {
      home,
      pollIntervalSeconds: 0,
      opensky: { searchRadiusKm: 50 },
      aircraftFilter: {
        allowedIcao24: [],
        allowedCategories: [3, 4, 5, 6, 7],
        allowOperatorCallsignFallback: true,
      },
      trackHistorySeconds: 240,
      trackStateTtlSeconds: 900,
      prediction: {
        maxCandidateAltitudeFeet: 5000,
        minAirportDistanceKilometers: 8,
        maxAirportDistanceKilometers: 50,
        minDescentRateMetersPerSecond: 0.5,
      },
      notifications: { targets: [{ id: 'iphone1', topic: 'topic-1' }] },
    },
    airport,
    adsbClient: { states: async () => feeds.shift() },
    stateStore: new MemoryStateStore(),
    ntfyClient: {
      publish: async () => {
        publishAttempts += 1;
        if (publishAttempts === 1) throw new Error('temporary ntfy failure');
      },
    },
    logger: () => {},
  });

  const failedPublish = await service.poll();
  assert.equal(failedPublish.status, 'ok');
  assert.equal(failedPublish.alerts.length, 0);
  assert.equal(publishAttempts, 1);

  const retriedPublish = await service.poll();
  assert.equal(retriedPublish.alerts.length, 1);
  assert.equal(publishAttempts, 2);
});

test('light general-aviation category is stored but does not notify', async () => {
  const lightAircraft = { ...aircraftAt(1800, 120), callsign: 'SPABC', category: 2 };
  const published = [];
  const logs = [];
  const stateStore = new MemoryStateStore();
  const service = new PollService({
    config: {
      home,
      pollIntervalSeconds: 0,
      opensky: { searchRadiusKm: 50 },
      aircraftFilter: {
        allowedIcao24: [],
        allowedCategories: [3, 4, 5, 6, 7],
        allowOperatorCallsignFallback: true,
      },
      trackHistorySeconds: 240,
      trackStateTtlSeconds: 900,
      prediction: {
        maxCandidateAltitudeFeet: 5000,
        minAirportDistanceKilometers: 8,
        maxAirportDistanceKilometers: 50,
        minDescentRateMetersPerSecond: 0.5,
      },
      notifications: { targets: [{ id: 'iphone1', topic: 'topic-1' }] },
    },
    airport,
    adsbClient: {
      states: async () => ({ timestamp: 1800, states: [lightAircraft], rateLimitRemaining: '3999' }),
    },
    stateStore,
    ntfyClient: { publish: async (...args) => published.push(args) },
    logger: (level, event, fields) => logs.push({ level, event, ...fields }),
  });

  const result = await service.poll();
  assert.equal(result.candidates, 0);
  assert.equal(result.alerts.length, 0);
  assert.equal(published.length, 0);
  assert.ok(stateStore.tracks.get('abc123').lastEvaluation.reasons.includes('aircraft_not_selected'));
  const rejected = logs.find((entry) => entry.event === 'aircraft_evaluated');
  assert.equal(rejected.decision, 'rejected');
  assert.equal(rejected.category, 2);
  assert.equal(rejected.classificationMatchedBy, null);
  assert.ok(rejected.rejectionReasons.includes('aircraft_not_selected'));
});

test('an OpenSky failure does not prevent the next poll', async () => {
  let calls = 0;
  const service = new PollService({
    config: { pollIntervalSeconds: 0, opensky: { searchRadiusKm: 90 } },
    airport,
    adsbClient: {
      states: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary OpenSky failure');
        return { timestamp: 1800, states: [], rateLimitRemaining: '3999' };
      },
    },
    stateStore: new MemoryStateStore(),
    ntfyClient: { publish: async () => {} },
    logger: () => {},
  });

  assert.equal((await service.poll()).status, 'degraded');
  assert.equal((await service.poll()).status, 'ok');
});

test('disabled notifications skip OpenSky polling and publishing', async () => {
  let openskyCalls = 0;
  const logs = [];
  const stateStore = new MemoryStateStore();
  stateStore.notificationsEnabled = async () => false;
  const service = new PollService({
    config: { pollIntervalSeconds: 0, opensky: { searchRadiusKm: 50 } },
    airport,
    adsbClient: { states: async () => { openskyCalls += 1; } },
    stateStore,
    ntfyClient: { publish: async () => assert.fail('must not publish') },
    logger: (level, event, fields) => logs.push({ level, event, ...fields }),
  });

  assert.deepEqual(await service.poll(), { status: 'skipped', reason: 'notifications_disabled' });
  assert.equal(openskyCalls, 0);
  assert.deepEqual(logs.at(-1), {
    level: 'info', event: 'poll_skipped', reason: 'notifications_disabled',
  });
});
