function numberValue(environment, name, defaultValue, { minimum, maximum } = {}) {
  const raw = environment[name] ?? defaultValue;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a number`);
  if (minimum !== undefined && value < minimum) throw new Error(`${name} must be >= ${minimum}`);
  if (maximum !== undefined && value > maximum) throw new Error(`${name} must be <= ${maximum}`);
  return value;
}
function booleanValue(environment, name, defaultValue) {
  const raw = String(environment[name] ?? defaultValue).toLowerCase();
  if (!['true', 'false'].includes(raw)) throw new Error(`${name} must be true or false`);
  return raw === 'true';
}

function secretValue(environment, name) {
  const value = environment[name]?.trim();
  if (!value || value.startsWith('CHANGE_ME')) throw new Error(`${name} must be configured`);
  return value;
}

function topicValue(environment, name, enabled) {
  if (!enabled) return null;
  const value = secretValue(environment, name);
  if (value.length < 32) throw new Error(`${name} must contain at least 32 characters`);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error(`${name} may contain only letters, numbers, underscores, and hyphens`);
  }
  return value;
}

export function loadConfig(environment = process.env) {
  const notifyIphone1 = booleanValue(environment, 'NOTIFY_IPHONE_1', true);
  const notifyIphone2 = booleanValue(environment, 'NOTIFY_IPHONE_2', true);
  const ntfyBaseUrl = new URL(environment.NTFY_BASE_URL ?? 'https://ntfy.sh');
  if (ntfyBaseUrl.protocol !== 'https:') throw new Error('NTFY_BASE_URL must use HTTPS');
  const adsbSource = environment.ADSB_SOURCE ?? 'opensky';
  if (adsbSource !== 'opensky') throw new Error('This build currently supports ADSB_SOURCE=opensky');

  return {
    port: numberValue(environment, 'PORT', 8080, { minimum: 1, maximum: 65535 }),
    redis: {
      host: environment.REDIS_HOST ?? 'redis',
      port: numberValue(environment, 'REDIS_PORT', 6379, { minimum: 1, maximum: 65535 }),
      password: secretValue(environment, 'REDIS_PASSWORD'),
      timeoutMilliseconds: 3000,
    },
    home: {
      lat: numberValue(environment, 'HOME_LAT', undefined, { minimum: -90, maximum: 90 }),
      lon: numberValue(environment, 'HOME_LON', undefined, { minimum: -180, maximum: 180 }),
      elevationMeters: numberValue(environment, 'HOME_ELEVATION_METERS', 0),
    },
    airportIcao: environment.AIRPORT_ICAO ?? 'EPKK',
    adsbSource,
    pollIntervalSeconds: numberValue(environment, 'ADSB_POLL_INTERVAL_SECONDS', 30, {
      minimum: 15,
    }),
    opensky: {
      clientId: secretValue(environment, 'OPENSKY_CLIENT_ID'),
      clientSecret: secretValue(environment, 'OPENSKY_CLIENT_SECRET'),
      searchRadiusKm: numberValue(environment, 'OPENSKY_SEARCH_RADIUS_KM', 90, {
        minimum: 10,
        maximum: 200,
      }),
      timeoutMilliseconds: 12_000,
    },
    prediction: {
      alertLeadTimeSeconds: numberValue(environment, 'ALERT_LEAD_TIME_SECONDS', 120, {
        minimum: 30,
      }),
      alertWindowSeconds: numberValue(environment, 'ALERT_WINDOW_SECONDS', 30, { minimum: 5 }),
      maxOverflightDistanceMeters: numberValue(
        environment,
        'MAX_OVERFLIGHT_DISTANCE_METERS',
        1500,
        { minimum: 100 },
      ),
      minPredictionConfidence: numberValue(environment, 'MIN_PREDICTION_CONFIDENCE', 0.75, {
        minimum: 0,
        maximum: 1,
      }),
      minConfirmationSamples: numberValue(environment, 'MIN_CONFIRMATION_SAMPLES', 3, {
        minimum: 3,
      }),
      minTrackSpanSeconds: numberValue(environment, 'MIN_TRACK_SPAN_SECONDS', 50, { minimum: 10 }),
      maxTrackStddevDegrees: numberValue(environment, 'MAX_TRACK_STDDEV_DEGREES', 12, {
        minimum: 1,
      }),
      maxCpaEtaSpreadSeconds: numberValue(environment, 'MAX_CPA_ETA_SPREAD_SECONDS', 35, {
        minimum: 1,
      }),
      minDescentRateMetersPerSecond: numberValue(environment, 'MIN_DESCENT_RATE_MPS', 0.5, {
        minimum: 0,
      }),
      approachCorridorHalfWidthMeters: numberValue(
        environment,
        'APPROACH_CORRIDOR_HALF_WIDTH_METERS',
        8000,
        { minimum: 500 },
      ),
      approachCorridorLengthMeters: numberValue(
        environment,
        'APPROACH_CORRIDOR_LENGTH_METERS',
        100000,
        { minimum: 10000 },
      ),
      runwayHeadingToleranceDegrees: numberValue(
        environment,
        'RUNWAY_HEADING_TOLERANCE_DEGREES',
        35,
        { minimum: 5, maximum: 90 },
      ),
    },
    trackHistorySeconds: numberValue(environment, 'TRACK_HISTORY_SECONDS', 240, { minimum: 90 }),
    trackStateTtlSeconds: numberValue(environment, 'TRACK_STATE_TTL_SECONDS', 900, { minimum: 300 }),
    notifications: {
      baseUrl: ntfyBaseUrl.toString().replace(/\/$/, ''),
      priority: environment.NTFY_PRIORITY ?? 'default',
      targets: [
        { id: 'iphone1', enabled: notifyIphone1, topic: topicValue(environment, 'NTFY_TOPIC_IPHONE_1', notifyIphone1) },
        { id: 'iphone2', enabled: notifyIphone2, topic: topicValue(environment, 'NTFY_TOPIC_IPHONE_2', notifyIphone2) },
      ].filter((target) => target.enabled),
    },
  };
}
