import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromLocalMeters } from '../src/geo.js';
import { evaluateTrack } from '../src/prediction.js';

const airport = {
  icao: 'TEST',
  reference: { lat: 50, lon: 19 },
  runways: [{ designator: '09', headingDegrees: 90, threshold: { lat: 50, lon: 19 } }],
};
const home = { ...fromLocalMeters({ x: -12_000, y: 0 }, airport.reference), elevationMeters: 250 };
const nowSeconds = 1_800;
const baseConfig = {
  maxCandidateAltitudeFeet: 7000,
  minAirportDistanceKilometers: 8,
  maxAirportDistanceKilometers: 90,
  minDescentRateMetersPerSecond: 0.5,
};

function sample({
  timestamp = nowSeconds,
  airportDistanceMeters = 20_000,
  altitudeMeters = 2_000,
  verticalRateMetersPerSecond = -3,
} = {}) {
  return {
    timestamp,
    ...fromLocalMeters({ x: -airportDistanceMeters, y: 0 }, airport.reference),
    altitudeMeters,
    speedMetersPerSecond: 100,
    trackDegrees: 90,
    verticalRateMetersPerSecond,
  };
}

function evaluate(samples, overrides = {}) {
  return evaluateTrack({
    samples,
    alreadyAlerted: overrides.alreadyAlerted ?? false,
    home,
    airport,
    nowSeconds,
    config: { ...baseConfig, ...overrides.config },
  });
}

test('descending aircraft below 7000 ft and 8-90 km from airport alerts', () => {
  const result = evaluate([sample()]);
  assert.equal(result.shouldAlert, true, result.reasons.join(', '));
  assert.ok(result.currentAltitudeFeet < 7000);
  assert.ok(result.airportDistanceMeters > 8_000);
});

test('aircraft at or above 7000 ft does not alert', () => {
  const result = evaluate([sample({ altitudeMeters: 2_134 })]);
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('altitude_too_high'));
});

test('level or climbing aircraft does not alert', () => {
  const result = evaluate([sample({ verticalRateMetersPerSecond: 0 })]);
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('not_descending'));
});

test('aircraft within 8 km of airport does not alert', () => {
  const result = evaluate([sample({ airportDistanceMeters: 7_999 })]);
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('too_close_to_airport'));
});

test('aircraft beyond the configured 90 km radius does not alert', () => {
  const result = evaluate([sample({ airportDistanceMeters: 91_000 })]);
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('outside_search_radius'));
});

test('stale position does not alert', () => {
  const result = evaluate([sample({ timestamp: nowSeconds - 60 })]);
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('stale_position'));
});

test('altitude history confirms descent when ADS-B vertical rate is absent', () => {
  const samples = [
    sample({ timestamp: nowSeconds - 30, airportDistanceMeters: 23_000, altitudeMeters: 2_050, verticalRateMetersPerSecond: null }),
    sample({ timestamp: nowSeconds, airportDistanceMeters: 20_000, altitudeMeters: 2_000, verticalRateMetersPerSecond: null }),
  ];
  const result = evaluate(samples);
  assert.equal(result.shouldAlert, true, result.reasons.join(', '));
  assert.ok(result.descentRateMetersPerSecond < 0);
});

test('already alerted approach never sends a duplicate', () => {
  const result = evaluate([sample()], { alreadyAlerted: true });
  assert.equal(result.shouldAlert, false);
  assert.ok(result.reasons.includes('already_alerted'));
});
