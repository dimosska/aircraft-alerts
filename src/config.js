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

function listValue(environment, name, defaultValue = '') {
  return String(environment[name] ?? defaultValue)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function integerListValue(environment, name, defaultValue = '') {
  return listValue(environment, name, defaultValue).map((raw) => {
    const value = Number(raw);
    if (!Number.isInteger(value)) throw new Error(`${name} must contain comma-separated integers`);
    return value;
  });
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
  const ntfyControlEnabled = booleanValue(environment, 'NTFY_CONTROL_ENABLED', false);
  const ntfyBaseUrl = new URL(environment.NTFY_BASE_URL ?? 'https://ntfy.sh');
  if (ntfyBaseUrl.protocol !== 'https:') throw new Error('NTFY_BASE_URL must use HTTPS');
  const adsbSource = environment.ADSB_SOURCE ?? 'opensky';
  if (adsbSource !== 'opensky') throw new Error('This build currently supports ADSB_SOURCE=opensky');
  const openskySearchRadiusKm = numberValue(environment, 'OPENSKY_SEARCH_RADIUS_KM', 50, {
    minimum: 10,
    maximum: 200,
  });
  const minAirportDistanceKm = numberValue(environment, 'MIN_AIRPORT_DISTANCE_KM', 8, {
    minimum: 0,
  });
  if (minAirportDistanceKm >= openskySearchRadiusKm) {
    throw new Error('MIN_AIRPORT_DISTANCE_KM must be smaller than OPENSKY_SEARCH_RADIUS_KM');
  }
  const minTrueTrackDegrees = numberValue(environment, 'MIN_TRUE_TRACK_DEGREES', 180, {
    minimum: 0,
    maximum: 360,
  });
  const maxTrueTrackDegrees = numberValue(environment, 'MAX_TRUE_TRACK_DEGREES', 270, {
    minimum: 0,
    maximum: 360,
  });
  if (minTrueTrackDegrees >= maxTrueTrackDegrees) {
    throw new Error('MIN_TRUE_TRACK_DEGREES must be smaller than MAX_TRUE_TRACK_DEGREES');
  }
  const allowedIcao24 = listValue(environment, 'AIRCRAFT_ICAO24_ALLOWLIST')
    .map((value) => value.toLowerCase());
  if (allowedIcao24.some((value) => !/^[0-9a-f]{6}$/.test(value))) {
    throw new Error('AIRCRAFT_ICAO24_ALLOWLIST must contain comma-separated 6-digit hexadecimal addresses');
  }
  const allowedCategories = integerListValue(
    environment,
    'AIRCRAFT_ADSB_CATEGORY_ALLOWLIST',
    '3,4,5,6,7',
  );
  if (allowedCategories.some((value) => value < 0 || value > 20)) {
    throw new Error('AIRCRAFT_ADSB_CATEGORY_ALLOWLIST values must be between 0 and 20');
  }

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
      searchRadiusKm: openskySearchRadiusKm,
      timeoutMilliseconds: 12_000,
    },
    prediction: {
      maxCandidateAltitudeFeet: numberValue(environment, 'MAX_CANDIDATE_ALTITUDE_FEET', 5000, {
        minimum: 500,
      }),
      minAirportDistanceKilometers: minAirportDistanceKm,
      maxAirportDistanceKilometers: openskySearchRadiusKm,
      minTrueTrackDegrees,
      maxTrueTrackDegrees,
      minDescentRateMetersPerSecond: numberValue(environment, 'MIN_DESCENT_RATE_MPS', 0.5, {
        minimum: 0,
      }),
    },
    aircraftFilter: {
      allowedIcao24,
      allowedCategories,
      allowOperatorCallsignFallback: booleanValue(
        environment,
        'ALLOW_OPERATOR_CALLSIGN_FALLBACK',
        true,
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
    control: {
      enabled: ntfyControlEnabled,
      topic: topicValue(environment, 'NTFY_CONTROL_TOPIC', ntfyControlEnabled),
      initialReplaySeconds: numberValue(environment, 'NTFY_CONTROL_INITIAL_REPLAY_SECONDS', 60, {
        minimum: 15,
        maximum: 600,
      }),
      maxCommandAgeSeconds: numberValue(environment, 'NTFY_CONTROL_MAX_COMMAND_AGE_SECONDS', 120, {
        minimum: 30,
        maximum: 600,
      }),
      deduplicationTtlSeconds: 86400,
    },
  };
}
