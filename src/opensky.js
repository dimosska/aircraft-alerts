function boundingBox(center, radiusKm) {
  const latitudeDelta = radiusKm / 111.32;
  const longitudeDelta = radiusKm / (111.32 * Math.cos((center.lat * Math.PI) / 180));
  return {
    lamin: center.lat - latitudeDelta,
    lamax: center.lat + latitudeDelta,
    lomin: center.lon - longitudeDelta,
    lomax: center.lon + longitudeDelta,
  };
}
function normalizeState(state) {
  // time_position belongs to latitude/longitude. last_contact may advance on
  // non-position Mode S messages while the coordinates remain stale.
  const timestamp = state[3];
  if (!Number.isFinite(timestamp) || !Number.isFinite(state[5]) || !Number.isFinite(state[6])) {
    return null;
  }
  if (state[8] === true) return null;
  return {
    icao24: String(state[0]).toLowerCase(),
    callsign: String(state[1] ?? '').trim() || null,
    timestamp,
    lon: state[5],
    lat: state[6],
    altitudeMeters: Number.isFinite(state[13]) ? state[13] : state[7],
    barometricAltitudeMeters: state[7],
    speedMetersPerSecond: state[9],
    trackDegrees: state[10],
    verticalRateMetersPerSecond: state[11],
    positionSource: state[16],
  };
}

export class OpenSkyClient {
  constructor(options) {
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.fetch = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 12_000;
    this.token = null;
    this.tokenExpiresAt = 0;
    this.tokenUrl = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
    this.statesUrl = 'https://opensky-network.org/api/states/all';
  }

  async accessToken(forceRefresh = false) {
    if (!forceRefresh && this.token && Date.now() < this.tokenExpiresAt) return this.token;
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    const response = await this.fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(this.timeoutMilliseconds),
    });
    if (!response.ok) throw new Error(`OpenSky token request failed with HTTP ${response.status}`);
    const payload = await response.json();
    if (!payload.access_token) throw new Error('OpenSky token response did not contain access_token');
    this.token = payload.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(30, (payload.expires_in ?? 1800) - 30) * 1000;
    return this.token;
  }

  async states(center, radiusKm, retryAuthentication = true) {
    const token = await this.accessToken();
    const url = new URL(this.statesUrl);
    const bounds = boundingBox(center, radiusKm);
    for (const [name, value] of Object.entries(bounds)) url.searchParams.set(name, value.toFixed(6));
    url.searchParams.set('extended', '1');
    const response = await this.fetch(url, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(this.timeoutMilliseconds),
    });
    if (response.status === 401 && retryAuthentication) {
      await this.accessToken(true);
      return this.states(center, radiusKm, false);
    }
    if (!response.ok) throw new Error(`OpenSky states request failed with HTTP ${response.status}`);
    const payload = await response.json();
    return {
      timestamp: payload.time ?? Math.floor(Date.now() / 1000),
      states: (payload.states ?? []).map(normalizeState).filter(Boolean),
      rateLimitRemaining: response.headers.get('x-rate-limit-remaining'),
      retryAfterSeconds: response.headers.get('x-rate-limit-retry-after-seconds'),
    };
  }
}
