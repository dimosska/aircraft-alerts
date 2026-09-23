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
        title: notification.title,
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
  const eta = Math.max(0, Math.round(prediction.etaSeconds));
  const altitude = Number.isFinite(prediction.currentAltitudeMeters)
    ? `${Math.round(prediction.currentAltitudeMeters)} м`
    : 'невідомо';
  const distance = `${(prediction.currentDistanceMeters / 1000).toFixed(1)} км`;
  const confidence = `${Math.round(prediction.confidence * 100)}%`;
  const direction = Number.isFinite(prediction.trackDegrees)
    ? ` · курс ${Math.round(prediction.trackDegrees).toString().padStart(3, '0')}°`
    : '';
  return {
    title: `Літак ${callsign}`,
    message:
      `${callsign} пролетить над будинком приблизно через 2 хв\n` +
      `Прогноз: ${eta} с · висота: ${altitude} · відстань: ${distance} · confidence: ${confidence}${direction}`,
  };
}
