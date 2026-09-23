const EARTH_RADIUS_METERS = 6_371_008.8;

export function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}
export function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

export function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function angularDifferenceDegrees(first, second) {
  return Math.abs(((first - second + 540) % 360) - 180);
}

export function circularStandardDeviationDegrees(values) {
  if (values.length < 2) return 0;
  const sum = values.reduce(
    (accumulator, value) => {
      const radians = toRadians(value);
      accumulator.sin += Math.sin(radians);
      accumulator.cos += Math.cos(radians);
      return accumulator;
    },
    { sin: 0, cos: 0 },
  );
  const resultantLength = Math.hypot(sum.sin, sum.cos) / values.length;
  if (resultantLength <= Number.EPSILON) return 180;
  return toDegrees(Math.sqrt(-2 * Math.log(Math.min(1, resultantLength))));
}

export function toLocalMeters(point, origin) {
  const latitudeDelta = toRadians(point.lat - origin.lat);
  const longitudeDelta = toRadians(point.lon - origin.lon);
  const meanLatitude = toRadians((point.lat + origin.lat) / 2);
  return {
    x: EARTH_RADIUS_METERS * longitudeDelta * Math.cos(meanLatitude),
    y: EARTH_RADIUS_METERS * latitudeDelta,
  };
}

export function fromLocalMeters(point, origin) {
  const latitude = origin.lat + toDegrees(point.y / EARTH_RADIUS_METERS);
  const meanLatitude = toRadians((latitude + origin.lat) / 2);
  return {
    lat: latitude,
    lon: origin.lon + toDegrees(point.x / (EARTH_RADIUS_METERS * Math.cos(meanLatitude))),
  };
}

export function haversineDistanceMeters(first, second) {
  const latitudeDelta = toRadians(second.lat - first.lat);
  const longitudeDelta = toRadians(second.lon - first.lon);
  const firstLatitude = toRadians(first.lat);
  const secondLatitude = toRadians(second.lat);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(a));
}

export function velocityFromSpeedAndTrack(speedMetersPerSecond, trackDegrees) {
  const track = toRadians(trackDegrees);
  return {
    x: speedMetersPerSecond * Math.sin(track),
    y: speedMetersPerSecond * Math.cos(track),
  };
}

export function trackFromVelocity(velocity) {
  return (toDegrees(Math.atan2(velocity.x, velocity.y)) + 360) % 360;
}

export function linearSlope(points, valueKey) {
  if (points.length < 2) return null;
  const meanTime = points.reduce((sum, point) => sum + point.timestamp, 0) / points.length;
  const meanValue = points.reduce((sum, point) => sum + point[valueKey], 0) / points.length;
  let covariance = 0;
  let variance = 0;
  for (const point of points) {
    const timeDelta = point.timestamp - meanTime;
    covariance += timeDelta * (point[valueKey] - meanValue);
    variance += timeDelta ** 2;
  }
  return variance > 0 ? covariance / variance : null;
}

export function estimateMotion(samples, origin) {
  const positioned = samples.map((sample) => ({
    ...sample,
    ...toLocalMeters(sample, origin),
  }));
  const velocity = {
    x: linearSlope(positioned, 'x'),
    y: linearSlope(positioned, 'y'),
  };
  if (!Number.isFinite(velocity.x) || !Number.isFinite(velocity.y)) return null;
  const altitudePoints = positioned.filter((point) => Number.isFinite(point.altitudeMeters));
  return {
    velocity,
    speedMetersPerSecond: Math.hypot(velocity.x, velocity.y),
    trackDegrees: trackFromVelocity(velocity),
    verticalRateMetersPerSecond: linearSlope(altitudePoints, 'altitudeMeters'),
  };
}

export function closestPointOfApproach(position, velocity) {
  const speedSquared = velocity.x ** 2 + velocity.y ** 2;
  if (speedSquared <= Number.EPSILON) return null;
  const timeSeconds = -((position.x * velocity.x + position.y * velocity.y) / speedSquared);
  return {
    timeSeconds,
    distanceMeters: Math.hypot(
      position.x + velocity.x * timeSeconds,
      position.y + velocity.y * timeSeconds,
    ),
  };
}
