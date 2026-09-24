import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EdwinWeatherClient, loadWeatherConfig, WeatherCollector } from '../src/weather.js';
import { readFile } from 'node:fs/promises';

test('weather configuration defaults to the nearby Węgrzce station', () => {
  const config = loadWeatherConfig({});
  assert.equal(config.stationId, 'PME193');
  assert.equal(config.pollIntervalSeconds, 60);
  assert.equal(config.staleAfterSeconds, 600);
});

test('weather service stays private on the Compose network', async () => {
  const compose = await readFile('docker-compose.yml', 'utf8');
  const weatherSection = compose.split('\n  predictor:')[0].split('services:')[1];
  assert.match(weatherSection, /weather:/);
  assert.match(weatherSection, /expose:\n\s+- "8080"/);
  assert.doesNotMatch(weatherSection, /ports:/);
  assert.doesNotMatch(weatherSection, /HOME_LAT|HOME_LON/);
});

test('eDWIN client selects and normalizes the newest measurement', async () => {
  let requestedUrl;
  const client = new EdwinWeatherClient({
    baseUrl: 'https://example.test',
    stationId: 'PME193',
    fetch: async (url) => {
      requestedUrl = url;
      return {
        ok: true,
        async json() {
          return { content: [
            { measurementDate: '2026-09-24T10:01:00Z', airTemperature: 13.1, relativeHumidity: 92, windSpeed: 0.2, windDirection: 180, precipitation: 0 },
            { measurementDate: '2026-09-24T10:03:00Z', airTemperature: 13.4, relativeHumidity: 91.8, windSpeed: 0.5, windDirection: 169, precipitation: 0.1 },
          ] };
        },
      };
    },
  });
  const result = await client.latest(Date.parse('2026-09-24T10:05:00Z'));
  assert.equal(result.temperatureCelsius, 13.4);
  assert.equal(result.precipitationMillimeters, 0.1);
  assert.equal(requestedUrl.searchParams.get('size'), '100');
  assert.equal(requestedUrl.searchParams.get('after'), '2026-09-24T09:50:00.000Z');
});

test('collector exports measurements and marks stale data down', async () => {
  let now = Date.parse('2026-09-24T10:04:00Z');
  const config = { stationId: 'PME193', stationName: 'Węgrzce', staleAfterSeconds: 600 };
  const collector = new WeatherCollector({
    config,
    nowMilliseconds: () => now,
    logger() {},
    client: { async latest() {
      return {
        stationId: 'PME193',
        observedAtMilliseconds: Date.parse('2026-09-24T10:03:00Z'),
        temperatureCelsius: 13.4,
        relativeHumidityPercent: 91.8,
        windSpeedMetersPerSecond: 0.5,
        windDirectionDegrees: 169,
        precipitationMillimeters: 0.1,
      };
    } },
  });
  await collector.poll();
  assert.match(collector.metrics(), /weather_up\{[^}]+\} 1/);
  assert.match(collector.metrics(), /weather_temperature_celsius\{[^}]+\} 13\.4/);
  now += 601_000;
  assert.match(collector.metrics(), /weather_up\{[^}]+\} 0/);
});

test('collector preserves the last observation when the API fails', async () => {
  const config = { stationId: 'PME193', stationName: 'Węgrzce', staleAfterSeconds: 600 };
  let fails = false;
  const collector = new WeatherCollector({
    config,
    logger() {},
    nowMilliseconds: () => Date.parse('2026-09-24T10:04:00Z'),
    client: { async latest() {
      if (fails) throw new Error('network down');
      return {
        stationId: 'PME193', observedAtMilliseconds: Date.parse('2026-09-24T10:03:00Z'),
        temperatureCelsius: 13, relativeHumidityPercent: 90,
        windSpeedMetersPerSecond: 1, windDirectionDegrees: null, precipitationMillimeters: 0,
      };
    } },
  });
  await collector.poll();
  fails = true;
  await collector.poll();
  assert.equal(collector.observation.temperatureCelsius, 13);
  assert.equal(collector.fetchErrors, 1);
  assert.equal(collector.lastError, 'network down');
});
