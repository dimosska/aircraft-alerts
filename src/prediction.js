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
  finalTurnExitBeforeHomeMeters: 2000,
  finalTurnCaptureRadiusMeters: 4000,
  maxPredictionHorizonSeconds: 300,
  maxPositionAgeSeconds: 45,
});

function runwayGeometry(point, runway) {
  const relative = toLocalMeters(point, runway.threshold);
  const unit = velocityFromSpeedAndTrack(1, runway.headingDegrees);
  return {
    unit,
    beforeThresholdMeters: -(relative.x * unit.x + relative.y * unit.y),
    crossTrackMeters: Math.abs(relative.x * unit.y - relative.y * unit.x),
  };
}

function runwayAlignedWithHome(home, airport, config) {
  return airport.runways
    .map((runway) => ({ ...runway, ...runwayGeometry(home, runway) }))
    .filter(
      (runway) =>
        runway.beforeThresholdMeters > 0 &&
        runway.crossTrackMeters <= config.maxOverflightDistanceMeters,
    )
    .sort((first, second) => first.crossTrackMeters - second.crossTrackMeters)[0] ?? null;
}

function turnAwareClosestApproach({ samples, current, motion, home, airport, positionAgeSeconds, config }) {
  const runway = runwayAlignedWithHome(home, airport, config);
  if (!runway) return null;

  const speedMetersPerSecond = Number.isFinite(current.speedMetersPerSecond)
    ? current.speedMetersPerSecond
    : motion.speedMetersPerSecond;
  const trackDegrees = Number.isFinite(current.trackDegrees)
    ? current.trackDegrees
    : motion.trackDegrees;
  if (speedMetersPerSecond < 15 || !Number.isFinite(trackDegrees)) return null;

  const velocity = velocityFromSpeedAndTrack(speedMetersPerSecond, trackDegrees);
  const currentLocal = toLocalMeters(current, home);
  const firstLocal = toLocalMeters(samples[0], home);
  const exitLocal = {
    x: -runway.unit.x * config.finalTurnExitBeforeHomeMeters,
    y: -runway.unit.y * config.finalTurnExitBeforeHomeMeters,
  };
  const currentAlong = currentLocal.x * runway.unit.x + currentLocal.y * runway.unit.y;
  const currentCross = Math.abs(currentLocal.x * runway.unit.y - currentLocal.y * runway.unit.x);
  const currentExitDistance = Math.hypot(
    currentLocal.x - exitLocal.x,
    currentLocal.y - exitLocal.y,
  );
  const firstExitDistance = Math.hypot(firstLocal.x - exitLocal.x, firstLocal.y - exitLocal.y);
  const exitCpa = closestPointOfApproach(
    { x: currentLocal.x - exitLocal.x, y: currentLocal.y - exitLocal.y },
    velocity,
  );
  const homeCpa = closestPointOfApproach(currentLocal, velocity);
  const onFinal =
    currentAlong >= -config.finalTurnExitBeforeHomeMeters &&
    currentAlong < 0 &&
    currentCross <= config.finalTurnCaptureRadiusMeters &&
    angularDifferenceDegrees(trackDegrees, runway.headingDegrees) <=
      config.runwayHeadingToleranceDegrees;

  if (onFinal && homeCpa) {
    return {
      mode: 'final',
      runway,
      trackDegrees,
      speedMetersPerSecond,
      etaSeconds: homeCpa.timeSeconds - positionAgeSeconds,
      distanceMeters: homeCpa.distanceMeters,
      corridorCompatible: homeCpa.timeSeconds > 0,
      compatibilityScore: clamp(
        1 - homeCpa.distanceMeters / config.finalTurnCaptureRadiusMeters,
        0,
        1,
      ),
    };
  }

  const exitConverging = firstExitDistance > currentExitDistance;
  const corridorCompatible =
    currentAlong < -config.finalTurnExitBeforeHomeMeters &&
    exitConverging &&
    exitCpa &&
    exitCpa.timeSeconds > 0 &&
    exitCpa.distanceMeters <= config.finalTurnCaptureRadiusMeters;
  if (!exitCpa) return null;
  return {
    mode: 'turn',
    runway,
    trackDegrees,
    speedMetersPerSecond,
    etaSeconds:
      exitCpa.timeSeconds +
      config.finalTurnExitBeforeHomeMeters / speedMetersPerSecond -
      positionAgeSeconds,
    distanceMeters: runway.crossTrackMeters,
    corridorCompatible,
    compatibilityScore: clamp(
      1 - exitCpa.distanceMeters / config.finalTurnCaptureRadiusMeters,
      0,
      1,
    ),
  };
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

function coherentCourse(tracks, stableThresholdDegrees) {
  if (circularStandardDeviationDegrees(tracks) <= stableThresholdDegrees) return true;
  const changes = tracks
    .slice(1)
    .map((track, index) => ((track - tracks[index] + 540) % 360) - 180)
    .filter((change) => Math.abs(change) >= 5);
  if (changes.length === 0) return true;
  const direction = Math.sign(changes[0]);
  return changes.every((change) => Math.sign(change) === direction && Math.abs(change) <= 90);
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
    .slice(-config.minConfirmationSamples)
    .map((sample) => sample.trackDegrees)
    .filter(Number.isFinite);
  const trackStddevDegrees = circularStandardDeviationDegrees(reportedTracks);
  const courseIsCoherent = coherentCourse(reportedTracks, config.maxTrackStddevDegrees);
  if (!courseIsCoherent) reasons.push('unstable_course');

  const verticalRates = samples
    .map((sample) => sample.verticalRateMetersPerSecond)
    .filter(Number.isFinite);
  const descentRate = median(verticalRates) ?? motion.verticalRateMetersPerSecond ?? 0;
  if (descentRate > -config.minDescentRateMetersPerSecond) reasons.push('not_descending');

  const firstAirportDistance = haversineDistanceMeters(first, input.airport.reference);
  const currentAirportDistance = haversineDistanceMeters(current, input.airport.reference);
  const airportConvergenceMetersPerSecond =
    (firstAirportDistance - currentAirportDistance) / Math.max(1, trackSpanSeconds);
  if (airportConvergenceMetersPerSecond <= 0) reasons.push('not_converging_on_airport');

  const approach = turnAwareClosestApproach({
    samples,
    current,
    motion,
    home: input.home,
    airport: input.airport,
    positionAgeSeconds,
    config,
  });
  if (!approach?.corridorCompatible) reasons.push('outside_approach_corridor');
  if (!approach || approach.etaSeconds <= 0) reasons.push('cpa_in_past');
  if (approach && approach.etaSeconds > config.maxPredictionHorizonSeconds) {
    reasons.push('cpa_too_far_ahead');
  }
  if (approach && approach.distanceMeters > config.maxOverflightDistanceMeters) {
    reasons.push('misses_home');
  }

  const previousPredictions = (input.previousPredictions ?? []).filter(
    (prediction) => Number.isFinite(prediction.etaSeconds) && Number.isFinite(prediction.timestamp),
  );
  const absoluteCpaTimes = [
    ...previousPredictions.map((prediction) => prediction.timestamp + prediction.etaSeconds),
    ...(approach ? [nowSeconds + approach.etaSeconds] : []),
  ];
  const cpaEtaSpreadSeconds = absoluteCpaTimes.length > 1
    ? Math.max(...absoluteCpaTimes) - Math.min(...absoluteCpaTimes)
    : config.maxCpaEtaSpreadSeconds;
  const components = {
    sampleQuality: Math.min(1, samples.length / Math.max(4, config.minConfirmationSamples)),
    freshness: clamp(1 - positionAgeSeconds / config.maxPositionAgeSeconds, 0, 1),
    descent: clamp((-descentRate - config.minDescentRateMetersPerSecond) / 3 + 0.5, 0, 1),
    airportConvergence: clamp(airportConvergenceMetersPerSecond / 60, 0, 1),
    runwayCompatibility: approach?.compatibilityScore ?? 0,
    courseStability: courseIsCoherent
      ? 1
      : clamp(1 - trackStddevDegrees / config.maxTrackStddevDegrees, 0, 1),
    cpaDistance: approach
      ? clamp(1 - approach.distanceMeters / config.maxOverflightDistanceMeters, 0, 1)
      : 0,
    cpaStability: approach?.mode === 'turn'
      ? 1
      : previousPredictions.length >= config.minConfirmationSamples - 1
        ? clamp(1 - cpaEtaSpreadSeconds / config.maxCpaEtaSpreadSeconds, 0, 1)
        : 0.5,
  };
  const confidence = confidenceScore(components);
  if (confidence < config.minPredictionConfidence) reasons.push('low_confidence');

  const etaSeconds = approach?.etaSeconds ?? null;
  const inAlertWindow =
    etaSeconds !== null &&
    Math.abs(etaSeconds - config.alertLeadTimeSeconds) <= config.alertWindowSeconds + 1e-6;
  if (!inAlertWindow) reasons.push('outside_alert_window');
  if (input.alreadyAlerted) reasons.push('already_alerted');

  const blockingReasons = reasons.filter((reason) => reason !== 'outside_alert_window');
  const eligible = blockingReasons.length === 0;
  const altitudeRate = motion.verticalRateMetersPerSecond ?? descentRate;
  const predictedAltitudeMslMeters =
    approach && Number.isFinite(current.altitudeMeters)
      ? current.altitudeMeters + altitudeRate * approach.etaSeconds
      : null;

  return {
    eligible,
    shouldAlert: eligible && inAlertWindow,
    reasons,
    confidence,
    confidenceComponents: components,
    etaSeconds,
    cpaDistanceMeters: approach?.distanceMeters ?? null,
    currentDistanceMeters: haversineDistanceMeters(current, input.home),
    currentAltitudeMeters: current.altitudeMeters ?? null,
    predictedAltitudeMslMeters,
    predictedAltitudeAboveHomeMeters:
      predictedAltitudeMslMeters !== null
        ? predictedAltitudeMslMeters - (input.home.elevationMeters ?? 0)
        : null,
    trackDegrees: approach?.trackDegrees ?? motion.trackDegrees,
    trackStddevDegrees,
    descentRateMetersPerSecond: descentRate,
    cpaEtaSpreadSeconds,
    runway: approach?.runway.designator ?? null,
    prediction: approach
      ? { timestamp: nowSeconds, etaSeconds: approach.etaSeconds, distanceMeters: approach.distanceMeters }
      : null,
  };
}
