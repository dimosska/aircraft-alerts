const DEFAULT_BASE_URL = 'https://edwin-meteo.apps.paas.psnc.pl';

function finiteNumber(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`Invalid ${field} in eDWIN response`);
  return number;
}

function optionalFiniteNumber(value, field) {
  if (value === null || value === undefined) return null;
  return finiteNumber(value, field);
}

export function loadWeatherConfig(environment = process.env) {
  const stationId = String(environment.WEATHER_STATION_ID ?? 'PME193').trim();
  if (!/^[A-Za-z0-9_-]{2,32}$/.test(stationId)) {
    throw new Error('WEATHER_STATION_ID has an invalid format');
  }
  const pollIntervalSeconds = Number(environment.WEATHER_POLL_INTERVAL_SECONDS ?? 60);
  const staleAfterSeconds = Number(environment.WEATHER_STALE_AFTER_SECONDS ?? 600);
  if (!Number.isInteger(pollIntervalSeconds) || pollIntervalSeconds < 30) {
    throw new Error('WEATHER_POLL_INTERVAL_SECONDS must be an integer >= 30');
  }
  if (!Number.isInteger(staleAfterSeconds) || staleAfterSeconds < pollIntervalSeconds * 2) {
    throw new Error('WEATHER_STALE_AFTER_SECONDS must be at least two polling intervals');
  }
  const baseUrl = new URL(environment.WEATHER_API_BASE_URL ?? DEFAULT_BASE_URL);
  if (baseUrl.protocol !== 'https:') throw new Error('WEATHER_API_BASE_URL must use HTTPS');
  return {
    stationId,
    stationName: String(environment.WEATHER_STATION_NAME ?? 'Węgrzce').trim(),
    baseUrl: baseUrl.toString().replace(/\/$/, ''),
    pollIntervalSeconds,
    staleAfterSeconds,
    timeoutMilliseconds: 15_000,
    port: 8080,
  };
}

export class EdwinWeatherClient {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.stationId = options.stationId;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 15_000;
    this.fetch = options.fetch ?? fetch;
  }

  async latest(nowMilliseconds = Date.now()) {
    const url = new URL(`/meteo/station/${encodeURIComponent(this.stationId)}`, this.baseUrl);
    url.searchParams.set('after', new Date(nowMilliseconds - 15 * 60_000).toISOString());
    url.searchParams.set('page', '0');
    url.searchParams.set('size', '100');
    const response = await this.fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'aircraft-alerts-weather/1.0' },
      signal: AbortSignal.timeout(this.timeoutMilliseconds),
    });
    if (!response.ok) throw new Error(`eDWIN returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.content) || payload.content.length === 0) {
      throw new Error('eDWIN returned no recent measurements');
    }
    const latest = payload.content.reduce((selected, candidate) =>
      Date.parse(candidate.measurementDate) > Date.parse(selected.measurementDate)
        ? candidate
        : selected
    );
    const observedAtMilliseconds = Date.parse(latest.measurementDate);
    if (!Number.isFinite(observedAtMilliseconds)) {
      throw new Error('Invalid measurementDate in eDWIN response');
    }
    return {
      stationId: this.stationId,
      observedAtMilliseconds,
      temperatureCelsius: finiteNumber(latest.airTemperature, 'airTemperature'),
      relativeHumidityPercent: finiteNumber(latest.relativeHumidity, 'relativeHumidity'),
      windSpeedMetersPerSecond: finiteNumber(latest.windSpeed, 'windSpeed'),
      windDirectionDegrees: optionalFiniteNumber(latest.windDirection, 'windDirection'),
      precipitationMillimeters: finiteNumber(latest.precipitation, 'precipitation'),
    };
  }
}

function labelValue(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', '\\n');
}

function metric(name, help, type, value, labels = '') {
  if (!Number.isFinite(value)) return '';
  const suffix = labels ? `{${labels}}` : '';
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name}${suffix} ${value}\n`;
}

export class WeatherCollector {
  constructor(options) {
    Object.assign(this, options);
    this.observation = null;
    this.lastSuccessMilliseconds = null;
    this.lastAttemptMilliseconds = null;
    this.fetchErrors = 0;
    this.lastError = null;
    this.running = false;
    this.nowMilliseconds = options.nowMilliseconds ?? Date.now;
  }

  async poll() {
    if (this.running) return;
    this.running = true;
    this.lastAttemptMilliseconds = this.nowMilliseconds();
    try {
      this.observation = await this.client.latest(this.lastAttemptMilliseconds);
      this.lastSuccessMilliseconds = this.nowMilliseconds();
      this.lastError = null;
      this.logger('info', 'weather_updated', {
        stationId: this.config.stationId,
        observedAt: new Date(this.observation.observedAtMilliseconds).toISOString(),
        temperatureCelsius: this.observation.temperatureCelsius,
        relativeHumidityPercent: this.observation.relativeHumidityPercent,
        windSpeedMetersPerSecond: this.observation.windSpeedMetersPerSecond,
        precipitationMillimeters: this.observation.precipitationMillimeters,
      });
    } catch (error) {
      this.fetchErrors += 1;
      this.lastError = error.message;
      this.logger('error', 'weather_update_failed', { message: error.message });
    } finally {
      this.running = false;
    }
  }

  isFresh(nowMilliseconds = this.nowMilliseconds()) {
    return this.observation !== null &&
      nowMilliseconds - this.observation.observedAtMilliseconds <= this.config.staleAfterSeconds * 1000;
  }

  metrics(nowMilliseconds = this.nowMilliseconds()) {
    const labels = `source="edwin",station_id="${labelValue(this.config.stationId)}",station_name="${labelValue(this.config.stationName)}"`;
    let output = metric('weather_up', 'Whether the latest station observation is fresh.', 'gauge', this.isFresh(nowMilliseconds) ? 1 : 0, labels);
    output += metric('weather_fetch_errors_total', 'Total failed weather API requests.', 'counter', this.fetchErrors, labels);
    if (!this.observation) return output;
    output += metric('weather_temperature_celsius', 'Measured air temperature in degrees Celsius.', 'gauge', this.observation.temperatureCelsius, labels);
    output += metric('weather_relative_humidity_percent', 'Measured relative humidity percentage.', 'gauge', this.observation.relativeHumidityPercent, labels);
    output += metric('weather_wind_speed_meters_per_second', 'Measured wind speed in meters per second.', 'gauge', this.observation.windSpeedMetersPerSecond, labels);
    output += metric('weather_wind_direction_degrees', 'Measured wind direction in degrees.', 'gauge', this.observation.windDirectionDegrees, labels);
    output += metric('weather_precipitation_millimeters', 'Precipitation value reported by the station in millimeters.', 'gauge', this.observation.precipitationMillimeters, labels);
    output += metric('weather_observation_timestamp_seconds', 'Unix timestamp of the station observation.', 'gauge', this.observation.observedAtMilliseconds / 1000, labels);
    output += metric('weather_observation_age_seconds', 'Age of the station observation in seconds.', 'gauge', Math.max(0, (nowMilliseconds - this.observation.observedAtMilliseconds) / 1000), labels);
    return output;
  }
}
