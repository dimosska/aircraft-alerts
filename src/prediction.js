import { haversineDistanceMeters, linearSlope } from './geo.js';

const FEET_PER_METER = 3.280839895;

const DEFAULTS = Object.freeze({
  maxCandidateAltitudeFeet: 7000,
  minAirportDistanceKilometers: 8,
  maxAirportDistanceKilometers: 90,
  minDescentRateMetersPerSecond: 0.5,
  maxPositionAgeSeconds: 45,
});

export function evaluateTrack(input) {
  const config = { ...DEFAULTS, ...input.config };
  const nowSeconds = input.nowSeconds ?? Date.now() / 1000;
  const samples = [...input.samples]
    .filter((sample) => Number.isFinite(sample.lat) && Number.isFinite(sample.lon))
    .sort((first, second) => first.timestamp - second.timestamp);
  const reasons = [];

  if (samples.length === 0) {
    return { eligible: false, shouldAlert: false, reasons: ['insufficient_samples'], confidence: 0 };
  }

  const current = samples.at(-1);
  const positionAgeSeconds = Math.max(0, nowSeconds - current.timestamp);
  if (positionAgeSeconds > config.maxPositionAgeSeconds) reasons.push('stale_position');

  const currentAltitudeMeters = Number.isFinite(current.altitudeMeters)
    ? current.altitudeMeters
    : null;
  const currentAltitudeFeet = currentAltitudeMeters === null
    ? null
    : currentAltitudeMeters * FEET_PER_METER;
  if (currentAltitudeFeet === null) reasons.push('unknown_altitude');
  else if (currentAltitudeFeet >= config.maxCandidateAltitudeFeet) reasons.push('altitude_too_high');

  const altitudeSamples = samples.filter((sample) => Number.isFinite(sample.altitudeMeters));
  const altitudeTrend = linearSlope(altitudeSamples, 'altitudeMeters');
  const descentRateMetersPerSecond = Number.isFinite(current.verticalRateMetersPerSecond)
    ? current.verticalRateMetersPerSecond
    : altitudeTrend;
  if (
    descentRateMetersPerSecond === null ||
    descentRateMetersPerSecond > -config.minDescentRateMetersPerSecond
  ) {
    reasons.push('not_descending');
  }

  const airportDistanceMeters = haversineDistanceMeters(current, input.airport.reference);
  const minimumAirportDistanceMeters = config.minAirportDistanceKilometers * 1000;
  const maximumAirportDistanceMeters = config.maxAirportDistanceKilometers * 1000;
  if (airportDistanceMeters <= minimumAirportDistanceMeters) reasons.push('too_close_to_airport');
  if (airportDistanceMeters > maximumAirportDistanceMeters) reasons.push('outside_search_radius');
  if (input.alreadyAlerted) reasons.push('already_alerted');

  const eligible = reasons.length === 0;
  const confidenceComponents = {
    freshPosition: positionAgeSeconds <= config.maxPositionAgeSeconds ? 1 : 0,
    altitudeKnown: currentAltitudeFeet === null ? 0 : 1,
    belowAltitudeLimit:
      currentAltitudeFeet !== null && currentAltitudeFeet < config.maxCandidateAltitudeFeet ? 1 : 0,
    descending:
      descentRateMetersPerSecond !== null &&
      descentRateMetersPerSecond <= -config.minDescentRateMetersPerSecond
        ? 1
        : 0,
    withinDistanceBand:
      airportDistanceMeters > minimumAirportDistanceMeters &&
      airportDistanceMeters <= maximumAirportDistanceMeters
        ? 1
        : 0,
  };
  const confidence =
    Object.values(confidenceComponents).reduce((sum, value) => sum + value, 0) /
    Object.keys(confidenceComponents).length;

  return {
    eligible,
    shouldAlert: eligible,
    reasons,
    confidence,
    confidenceComponents,
    etaSeconds: null,
    landingEtaSeconds: null,
    cpaDistanceMeters: null,
    airportDistanceMeters,
    currentDistanceMeters: haversineDistanceMeters(current, input.home),
    currentAltitudeMeters,
    currentAltitudeFeet,
    predictedAltitudeMslMeters: null,
    predictedAltitudeAboveHomeMeters: null,
    trackDegrees: current.trackDegrees,
    trackStddevDegrees: null,
    descentRateMetersPerSecond,
    cpaEtaSpreadSeconds: null,
    runway: null,
    prediction: null,
  };
}
