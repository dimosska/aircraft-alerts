import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromLocalMeters } from '../src/geo.js';
import { evaluateTrack } from '../src/prediction.js';

const origin = { lat: 50, lon: 19 };
const homePoint = fromLocalMeters({ x: -12_000, y: 0 }, origin);
const home = { ...homePoint, elevationMeters: 250 };
const airport = {
  icao: 'TEST',
  reference: origin,
  runways: [{ designator: '09', headingDegrees: 90, threshold: origin }],
};
const nowSeconds = 1_800;
const baseConfig = {
  alertLeadTimeSeconds: 120,
  alertWindowSeconds: 30,
  maxOverflightDistanceMeters: 1_000,
  minPredictionConfidence: 0.68,
  minConfirmationSamples: 3,
  minTrackSpanSeconds: 50,
  maxTrackStddevDegrees: 12,
  approachCorridorHalfWidthMeters: 8_000,
  approachCorridorLengthMeters: 100_000,
  runwayHeadingToleranceDegrees: 35,
};

function sampleAt({ timestamp, x, y = 0, trackDegrees = 90, verticalRate = -3 }) {
  const position = fromLocalMeters({ x, y }, origin);
  return {
    timestamp,
    ...position,
    altitudeMeters: 2_000 + verticalRate * (timestamp - nowSeconds),
    speedMetersPerSecond: 100,
    trackDegrees,
    verticalRateMetersPerSecond: verticalRate,
  };
}

function inboundSamples({ etaSeconds = 120, lateralMeters = 0, tracks = [90, 90, 90] } = {}) {
  const currentX = -12_000 - 100 * etaSeconds;
  return [-60, -30, 0].map((offset, index) =>
    sampleAt({
      timestamp: nowSeconds + offset,
      x: currentX + 100 * offset,
      y: lateralMeters,
      trackDegrees: tracks[index],
    }),
  );
}

function stablePredictions(etaSeconds) {
  return [
    { timestamp: nowSeconds - 60, etaSeconds: etaSeconds + 60, distanceMeters: 0 },
    { timestamp: nowSeconds - 30, etaSeconds: etaSeconds + 30, distanceMeters: 0 },
  ];
}

function evaluate(samples, overrides = {}) {
  return evaluateTrack({
    samples,
    previousPredictions: overrides.previousPredictions ?? stablePredictions(120),
    alreadyAlerted: overrides.alreadyAlerted ?? false,
    home,
    airport: overrides.airport ?? airport,
    nowSeconds,
    config: { ...baseConfig, ...overrides.config },
  });
}

test('aircraft tracking directly over home with ETA 120 seconds alerts', () => {
  const result = evaluate(inboundSamples());
  assert.equal(result.shouldAlert, true, result.reasons.join(', '));
  assert.ok(Math.abs(result.etaSeconds - 120) < 1);
  assert.ok(result.cpaDistanceMeters < 1);
  assert.equal(result.runway, '09');
});
test('ETA too far ahead does not alert', () => {
  const result = evaluate(inboundSamples({ etaSeconds: 240 }), {
    previousPredictions: stablePredictions(240),
  });
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('outside_alert_window'));
});

test('aircraft that passed the home does not alert', () => {
  const samples = [-60, -30, 0].map((offset) =>
    sampleAt({ timestamp: nowSeconds + offset, x: -8_000 + 100 * offset }),
  );
  const result = evaluate(samples);
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('cpa_in_past'));
});

test('nearby aircraft flying away from the home does not alert', () => {
  const samples = [-60, -30, 0].map((offset) =>
    sampleAt({ timestamp: nowSeconds + offset, x: -14_000 - 100 * offset, trackDegrees: 270 }),
  );
  const result = evaluate(samples);
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('outside_approach_corridor'));
});

test('aircraft converging on airport but missing the home does not alert', () => {
  const result = evaluate(inboundSamples({ lateralMeters: 5_000 }));
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('misses_home'));
});

test('unstable course waits for confirmation', () => {
  const result = evaluate(inboundSamples({ tracks: [55, 125, 90] }));
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('unstable_course'));
});

test('already alerted approach never sends a duplicate', () => {
  const result = evaluate(inboundSamples(), { alreadyAlerted: true });
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('already_alerted'));
});

test('landing direction incompatible with the track does not alert', () => {
  const oppositeRunwayAirport = {
    ...airport,
    runways: [{ designator: '27', headingDegrees: 270, threshold: origin }],
  };
  const result = evaluate(inboundSamples(), { airport: oppositeRunwayAirport });
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('outside_approach_corridor'));
});
