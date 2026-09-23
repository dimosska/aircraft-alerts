import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyAircraft } from '../src/aircraft-classifier.js';

const rules = {
  allowedIcao24: ['abcdef'],
  allowedCategories: [3, 4, 5, 6, 7],
};

test('allows business jets, airliners, heavy aircraft and high-performance aircraft', () => {
  for (const category of [3, 4, 5, 6, 7]) {
    assert.equal(classifyAircraft({ icao24: '111111', category }, rules).eligible, true);
  }
});

test('selects an exact ICAO24 allowlist match', () => {
  const result = classifyAircraft({ callsign: 'UNKNOWN', icao24: 'ABCDEF' }, rules);
  assert.equal(result.eligible, true);
  assert.equal(result.matchedBy, 'icao24_allowlist');
});

test('rejects light general aviation and non-airplane categories', () => {
  for (const category of [0, 1, 2, 8, 9, 10, 11, 12, 14, null]) {
    assert.equal(classifyAircraft({ icao24: '111111', category }, rules).eligible, false);
  }
});

test('allows ordinary airline traffic', () => {
  const result = classifyAircraft({ callsign: 'RYR123', icao24: '4ca123', category: 4 }, rules);
  assert.deepEqual(result, { eligible: true, matchedBy: 'category:4' });
});
