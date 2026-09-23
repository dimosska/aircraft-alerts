import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OpenSkyClient } from '../src/opensky.js';

test('OpenSky client uses OAuth2, normalizes states, and rejects coordinates without time_position', async () => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('/token')) {
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 1800 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        time: 1000,
        states: [
          ['abc123', ' LOT123 ', null, 999, 1000, 19.5, 50.2, 1500, false, 90, 78, -3, null, 1600, null, false, 0, 4],
          ['def456', null, null, 999, 1000, null, null, 2000, false, 100, 90, 0],
          ['fed987', 'STALE', null, null, 1000, 19.6, 50.3, 1800, false, 80, 75, -2],
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json', 'x-rate-limit-remaining': '3999' } },
    );
  };
  const client = new OpenSkyClient({
    clientId: 'id',
    clientSecret: 'secret',
    fetchImpl,
    timeoutMilliseconds: 1000,
  });

  const result = await client.states({ lat: 50.1, lon: 19.7 }, 90);

  assert.equal(requests.length, 2);
  assert.match(String(requests[0].options.body), /grant_type=client_credentials/);
  assert.equal(requests[1].options.headers.authorization, 'Bearer test-token');
  assert.equal(result.states.length, 1);
  assert.deepEqual(result.states[0], {
    icao24: 'abc123',
    callsign: 'LOT123',
    timestamp: 999,
    lon: 19.5,
    lat: 50.2,
    altitudeMeters: 1500,
    barometricAltitudeMeters: 1500,
    speedMetersPerSecond: 90,
    trackDegrees: 78,
    verticalRateMetersPerSecond: -3,
    positionSource: 0,
  });
  assert.equal(result.rateLimitRemaining, '3999');
});
