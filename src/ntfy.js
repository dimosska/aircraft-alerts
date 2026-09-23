function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export class NtfyClient {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.priority = options.priority ?? 'default';
    this.fetch = options.fetchImpl ?? globalThis.fetch;
    this.timeoutMilliseconds = options.timeoutMilliseconds ?? 8000;
  }

  async publish(topic, notification) {
    const response = await this.fetch(`${this.baseUrl}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        title: encodeHeader(notification.title),
        priority: this.priority,
        tags: 'airplane,warning',
        'content-type': 'text/plain; charset=utf-8',
      },
      body: notification.message,
      signal: AbortSignal.timeout(this.timeoutMilliseconds),
    });
    if (!response.ok) throw new Error(`ntfy publish failed with HTTP ${response.status}`);
  }
}
export function notificationForAircraft(aircraft, prediction) {
  const callsign = aircraft.callsign || aircraft.icao24.toUpperCase();
  const altitude = Number.isFinite(prediction.currentAltitudeFeet)
    ? `${Math.round(prediction.currentAltitudeFeet)} ft`
    : 'невідомо';
  const airportDistance = Number.isFinite(prediction.airportDistanceMeters)
    ? `${(prediction.airportDistanceMeters / 1000).toFixed(1)} км`
    : 'невідомо';
  const homeDistance = `${(prediction.currentDistanceMeters / 1000).toFixed(1)} км`;
  const speed = Number.isFinite(aircraft.speedMetersPerSecond)
    ? `${Math.round(aircraft.speedMetersPerSecond * 3.6)} км/год`
    : 'невідомо';
  const direction = Number.isFinite(prediction.trackDegrees)
    ? ` · курс ${Math.round(prediction.trackDegrees).toString().padStart(3, '0')}°`
    : '';
  return {
    title: `Літак знижується: ${callsign}`,
    message:
      `${callsign} знижується поблизу KRK\n` +
      `Висота: ${altitude} · до KRK: ${airportDistance} · до будинку: ${homeDistance}\n` +
      `Швидкість: ${speed}${direction}`,
  };
}
