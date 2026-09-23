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
}

function aircraftAt(timestamp, etaAtTimestamp) {
  const x = -12_000 - 100 * etaAtTimestamp;
  return {
    icao24: 'abc123',
    callsign: 'LOT123',
    timestamp,
    ...fromLocalMeters({ x, y: 0 }, origin),
    altitudeMeters: 2000,
    speedMetersPerSecond: 100,
    trackDegrees: 90,
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
  const stateStore = new MemoryStateStore();
  const service = new PollService({
    config: {
      home,
      opensky: { searchRadiusKm: 90 },
      trackHistorySeconds: 240,
      trackStateTtlSeconds: 900,
      prediction: {
        alertLeadTimeSeconds: 120,
        alertWindowSeconds: 30,
        maxOverflightDistanceMeters: 1000,
        minPredictionConfidence: 0.68,
        minConfirmationSamples: 3,
        minTrackSpanSeconds: 50,
        maxTrackStddevDegrees: 12,
        approachCorridorHalfWidthMeters: 8000,
        approachCorridorLengthMeters: 100000,
        runwayHeadingToleranceDegrees: 35,
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
    logger: () => {},
  });

  await service.poll();
  await service.poll();
  const alertingPoll = await service.poll();
  const repeatedPoll = await service.poll();

  assert.equal(alertingPoll.alerts.length, 2);
  assert.equal(repeatedPoll.alerts.length, 0);
  assert.equal(published.length, 2);
  assert.match(published[0].notification.message, /приблизно через 2 хв/);
  assert.match(published[0].notification.message, /confidence:/);
});
