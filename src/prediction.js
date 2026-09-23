import {
  angularDifferenceDegrees,
  clamp,
  circularStandardDeviationDegrees,
  closestPointOfApproach,
  estimateMotion,
  haversineDistanceMeters,
  median,
  toLocalMeters,
  velocityFromSpeedAndTrack,
} from './geo.js';

const DEFAULTS = Object.freeze({
  alertLeadTimeSeconds: 120,
  alertWindowSeconds: 30,
  maxOverflightDistanceMeters: 1500,
  minPredictionConfidence: 0.75,
  minConfirmationSamples: 3,
  minTrackSpanSeconds: 50,
  maxTrackStddevDegrees: 12,
  maxCpaEtaSpreadSeconds: 35,
  minDescentRateMetersPerSecond: 0.5,
  approachCorridorHalfWidthMeters: 8000,
  approachCorridorLengthMeters: 100000,
  runwayHeadingToleranceDegrees: 35,
  maxPredictionHorizonSeconds: 300,
  maxPositionAgeSeconds: 45,
});

function runwayMatch(sample, trackDegrees, airport, config) {
  let best = null;
  for (const runway of airport.runways) {
    const relative = toLocalMeters(sample, runway.threshold);
    const unitVelocity = velocityFromSpeedAndTrack(1, runway.headingDegrees);
    const beforeThresholdMeters = -(relative.x * unitVelocity.x + relative.y * unitVelocity.y);
    const crossTrackMeters = Math.abs(relative.x * unitVelocity.y - relative.y * unitVelocity.x);
    const headingErrorDegrees = angularDifferenceDegrees(trackDegrees, runway.headingDegrees);
    const matches =
      beforeThresholdMeters >= 0 &&
      beforeThresholdMeters <= config.approachCorridorLengthMeters &&
      crossTrackMeters <= config.approachCorridorHalfWidthMeters &&
      headingErrorDegrees <= config.runwayHeadingToleranceDegrees;
    if (!matches) continue;
    const score =
      (1 - crossTrackMeters / config.approachCorridorHalfWidthMeters) * 0.55 +
      (1 - headingErrorDegrees / config.runwayHeadingToleranceDegrees) * 0.45;
    if (!best || score > best.score) {
      best = { ...runway, beforeThresholdMeters, crossTrackMeters, headingErrorDegrees, score };
    }
  }
  return best;
}
function confidenceScore(components) {
  const weights = {
    sampleQuality: 0.12,
    freshness: 0.08,
    descent: 0.12,
    airportConvergence: 0.13,
    runwayCompatibility: 0.17,
    courseStability: 0.14,
    cpaDistance: 0.16,
    cpaStability: 0.08,
  };
  return Object.entries(weights).reduce(
    (total, [name, weight]) => total + clamp(components[name] ?? 0, 0, 1) * weight,
    0,
  );
}

export function evaluateTrack(input) {
  const config = { ...DEFAULTS, ...input.config };
  const nowSeconds = input.nowSeconds ?? Date.now() / 1000;
  const samples = [...input.samples]
    .filter((sample) => Number.isFinite(sample.lat) && Number.isFinite(sample.lon))
    .sort((first, second) => first.timestamp - second.timestamp);
  const reasons = [];

  if (samples.length < config.minConfirmationSamples) reasons.push('insufficient_samples');
  if (samples.length < 2) return { eligible: false, shouldAlert: false, reasons, confidence: 0 };

  const first = samples[0];
  const current = samples.at(-1);
  const trackSpanSeconds = current.timestamp - first.timestamp;
  const positionAgeSeconds = nowSeconds - current.timestamp;
  if (trackSpanSeconds < config.minTrackSpanSeconds) reasons.push('insufficient_track_span');
  if (positionAgeSeconds > config.maxPositionAgeSeconds) reasons.push('stale_position');

  const motion = estimateMotion(samples, input.home);
  if (!motion || motion.speedMetersPerSecond < 15) {
    reasons.push('invalid_motion');
    return { eligible: false, shouldAlert: false, reasons, confidence: 0 };
  }

  const reportedTracks = samples
    .map((sample) => sample.trackDegrees)
    .filter(Number.isFinite);
  const trackStddevDegrees = circularStandardDeviationDegrees(reportedTracks);
  if (trackStddevDegrees > config.maxTrackStddevDegrees) reasons.push('unstable_course');

  const verticalRates = samples
    .map((sample) => sample.verticalRateMetersPerSecond)
    .filter(Number.isFinite);
  const descentRate = median(verticalRates) ?? motion.verticalRateMetersPerSecond ?? 0;
  if (descentRate > -config.minDescentRateMetersPerSecond) reasons.push('not_descending');

  const runway = runwayMatch(current, motion.trackDegrees, input.airport, config);
  if (!runway) reasons.push('outside_approach_corridor');

  const firstAirportDistance = haversineDistanceMeters(first, input.airport.reference);
  const currentAirportDistance = haversineDistanceMeters(current, input.airport.reference);
  const airportConvergenceMetersPerSecond =
    (firstAirportDistance - currentAirportDistance) / Math.max(1, trackSpanSeconds);
  if (airportConvergenceMetersPerSecond <= 0) reasons.push('not_converging_on_airport');

  const currentLocal = toLocalMeters(current, input.home);
  const cpa = closestPointOfApproach(currentLocal, motion.velocity);
  if (!cpa || cpa.timeSeconds <= 0) reasons.push('cpa_in_past');
  if (cpa && cpa.timeSeconds > config.maxPredictionHorizonSeconds) reasons.push('cpa_too_far_ahead');
  if (cpa && cpa.distanceMeters > config.maxOverflightDistanceMeters) reasons.push('misses_home');

  const previousPredictions = (input.previousPredictions ?? []).filter(
    (prediction) => Number.isFinite(prediction.etaSeconds) && Number.isFinite(prediction.timestamp),
  );
  const absoluteCpaTimes = [
    ...previousPredictions.map((prediction) => prediction.timestamp + prediction.etaSeconds),
    ...(cpa ? [nowSeconds + cpa.timeSeconds] : []),
  ];
  const cpaEtaSpreadSeconds = absoluteCpaTimes.length > 1
    ? Math.max(...absoluteCpaTimes) - Math.min(...absoluteCpaTimes)
    : config.maxCpaEtaSpreadSeconds;
  if (
    previousPredictions.length >= config.minConfirmationSamples - 1 &&
    cpaEtaSpreadSeconds > config.maxCpaEtaSpreadSeconds
  ) {
    reasons.push('unstable_cpa');
  }

  const components = {
    sampleQuality: Math.min(1, samples.length / Math.max(4, config.minConfirmationSamples)),
    freshness: clamp(1 - positionAgeSeconds / config.maxPositionAgeSeconds, 0, 1),
    descent: clamp((-descentRate - config.minDescentRateMetersPerSecond) / 3 + 0.5, 0, 1),
    airportConvergence: clamp(airportConvergenceMetersPerSecond / 60, 0, 1),
    runwayCompatibility: runway?.score ?? 0,
    courseStability: clamp(1 - trackStddevDegrees / config.maxTrackStddevDegrees, 0, 1),
    cpaDistance: cpa
      ? clamp(1 - cpa.distanceMeters / config.maxOverflightDistanceMeters, 0, 1)
      : 0,
    cpaStability:
      previousPredictions.length >= config.minConfirmationSamples - 1
        ? clamp(1 - cpaEtaSpreadSeconds / config.maxCpaEtaSpreadSeconds, 0, 1)
        : 0.5,
  };
  const confidence = confidenceScore(components);
  if (confidence < config.minPredictionConfidence) reasons.push('low_confidence');

  const etaSeconds = cpa?.timeSeconds ?? null;
  const inAlertWindow =
    etaSeconds !== null &&
    Math.abs(etaSeconds - config.alertLeadTimeSeconds) <= config.alertWindowSeconds;
  if (!inAlertWindow) reasons.push('outside_alert_window');
  if (input.alreadyAlerted) reasons.push('already_alerted');

  const blockingReasons = reasons.filter((reason) => reason !== 'outside_alert_window');
  const eligible = blockingReasons.length === 0;
  const altitudeRate = motion.verticalRateMetersPerSecond ?? descentRate;
  const predictedAltitudeMslMeters =
    cpa && Number.isFinite(current.altitudeMeters)
      ? current.altitudeMeters + altitudeRate * cpa.timeSeconds
      : null;

  return {
    eligible,
    shouldAlert: eligible && inAlertWindow,
    reasons,
    confidence,
    confidenceComponents: components,
    etaSeconds,
    cpaDistanceMeters: cpa?.distanceMeters ?? null,
    currentDistanceMeters: haversineDistanceMeters(current, input.home),
    currentAltitudeMeters: current.altitudeMeters ?? null,
    predictedAltitudeMslMeters,
    predictedAltitudeAboveHomeMeters:
      predictedAltitudeMslMeters !== null
        ? predictedAltitudeMslMeters - (input.home.elevationMeters ?? 0)
        : null,
    trackDegrees: motion.trackDegrees,
    trackStddevDegrees,
    descentRateMetersPerSecond: descentRate,
    cpaEtaSpreadSeconds,
    runway: runway?.designator ?? null,
    prediction: cpa
      ? { timestamp: nowSeconds, etaSeconds: cpa.timeSeconds, distanceMeters: cpa.distanceMeters }
      : null,
  };
}
