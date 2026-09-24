import { evaluateTrack } from './prediction.js';
import { notificationForAircraft } from './ntfy.js';
import { classifyAircraft } from './aircraft-classifier.js';

function appendSample(existing, aircraft, nowSeconds, historySeconds) {
  const samples = (existing?.samples ?? []).filter(
    (sample) => sample.timestamp >= nowSeconds - historySeconds,
  );
  if (!samples.some((sample) => sample.timestamp === aircraft.timestamp)) samples.push(aircraft);
  samples.sort((first, second) => first.timestamp - second.timestamp);
  return samples;
}
function approachIdentifier(aircraft, existing, samples) {
  return existing?.approachId ?? `${aircraft.icao24}-${Math.floor(samples[0].timestamp)}`;
}
function rounded(value, fractionDigits = 0) {
  return Number.isFinite(value) ? Number(value.toFixed(fractionDigits)) : null;
}
function aircraftEvaluationFields(aircraft, prediction, classification, feedTimestamp, sampleCount) {
  return {
    callsign: aircraft.callsign,
    icao24: aircraft.icao24,
    category: aircraft.category,
    positionTimestamp: aircraft.timestamp,
    positionAgeSeconds: rounded(Math.max(0, feedTimestamp - aircraft.timestamp), 1),
    positionSource: aircraft.positionSource,
    sampleCount,
    altitudeMeters: rounded(prediction.currentAltitudeMeters),
    altitudeFeet: rounded(prediction.currentAltitudeFeet),
    speedMetersPerSecond: rounded(aircraft.speedMetersPerSecond, 1),
    speedKilometersPerHour: Number.isFinite(aircraft.speedMetersPerSecond)
      ? rounded(aircraft.speedMetersPerSecond * 3.6)
      : null,
    trueTrackDegrees: rounded(prediction.trackDegrees, 1),
    reportedVerticalRateMetersPerSecond: rounded(aircraft.verticalRateMetersPerSecond, 2),
    evaluatedDescentRateMetersPerSecond: rounded(prediction.descentRateMetersPerSecond, 2),
    airportDistanceKilometers: rounded(prediction.airportDistanceMeters / 1000, 1),
    homeDistanceKilometers: rounded(prediction.currentDistanceMeters / 1000, 1),
    classificationMatchedBy: classification.matchedBy,
    decision: prediction.shouldAlert ? 'accepted' : 'rejected',
    rejectionReasons: prediction.reasons,
  };
}

export class PollService {
  constructor(options) {
    Object.assign(this, options);
    this.running = false;
    this.lastPollStartedAt = 0;
    this.nowMilliseconds = options.nowMilliseconds ?? Date.now;
  }

  async poll() {
    if (this.running) return { status: 'skipped', reason: 'poll_already_running' };
    const now = this.nowMilliseconds();
    if (
      this.lastPollStartedAt > 0 &&
      now - this.lastPollStartedAt < this.config.pollIntervalSeconds * 1000
    ) {
      return { status: 'skipped', reason: 'source_poll_interval' };
    }
    this.running = true;
    this.lastPollStartedAt = now;
    try {
      return await this.pollOnce();
    } catch (error) {
      this.logger('error', 'poll_failed', { message: error.message });
      return { status: 'degraded', error: error.message };
    } finally {
      this.running = false;
    }
  }

  async pollOnce() {
    const feed = await this.adsbClient.states(
      this.airport.reference,
      this.config.opensky.searchRadiusKm,
    );
    const aircraftValues = feed.states.filter((aircraft) => aircraft.icao24);
    const existingTracks = await this.stateStore.getTracks(
      aircraftValues.map((aircraft) => aircraft.icao24),
    );
    const updatedTracks = [];
    const alerts = [];
    let candidates = 0;

    for (const aircraft of aircraftValues) {
      const existing = existingTracks.get(aircraft.icao24);
      const classification = classifyAircraft(aircraft, this.config.aircraftFilter);
      const samples = appendSample(existing, aircraft, feed.timestamp, this.config.trackHistorySeconds);
      const approachId = approachIdentifier(aircraft, existing, samples);
      const prediction = evaluateTrack({
        samples,
        previousPredictions: existing?.predictions ?? [],
        alreadyAlerted: false,
        home: this.config.home,
        airport: this.airport,
        nowSeconds: feed.timestamp,
        config: this.config.prediction,
        aircraftClassification: classification,
      });
      if (prediction.eligible) candidates += 1;
      const predictions = [...(existing?.predictions ?? [])];
      if (prediction.prediction) predictions.push(prediction.prediction);
      const state = {
        approachId,
        samples,
        predictions: predictions.slice(-5),
        lastEvaluation: {
          timestamp: feed.timestamp,
          etaSeconds: prediction.etaSeconds,
          cpaDistanceMeters: prediction.cpaDistanceMeters,
          airportDistanceMeters: prediction.airportDistanceMeters,
          currentAltitudeFeet: prediction.currentAltitudeFeet,
          descentRateMetersPerSecond: prediction.descentRateMetersPerSecond,
          confidence: prediction.confidence,
          reasons: prediction.reasons,
          runway: prediction.runway,
          aircraftMatchedBy: classification.matchedBy,
        },
      };
      updatedTracks.push({ icao24: aircraft.icao24, state });
      this.logger(
        'info',
        'aircraft_evaluated',
        aircraftEvaluationFields(
          aircraft,
          prediction,
          classification,
          feed.timestamp,
          samples.length,
        ),
      );
      if (!prediction.shouldAlert) continue;

      const notification = notificationForAircraft(aircraft, prediction);
      for (const target of this.config.notifications.targets) {
        const claimed = await this.stateStore.claimAlert(approachId, target.id, 7200);
        if (!claimed) {
          this.logger('info', 'notification_suppressed', {
            icao24: aircraft.icao24,
            callsign: aircraft.callsign,
            target: target.id,
            reason: 'duplicate_approach',
          });
          continue;
        }
        try {
          await this.ntfyClient.publish(target.topic, notification);
          alerts.push({ icao24: aircraft.icao24, target: target.id, etaSeconds: prediction.etaSeconds });
          this.logger('info', 'notification_sent', {
            icao24: aircraft.icao24,
            callsign: aircraft.callsign,
            target: target.id,
            altitudeFeet: Math.round(prediction.currentAltitudeFeet),
            airportDistanceKilometers: Number(
              (prediction.airportDistanceMeters / 1000).toFixed(1),
            ),
            aircraftCategory: aircraft.category,
          });
        } catch (error) {
          await this.stateStore.releaseAlert(approachId, target.id);
          this.logger('error', 'notification_failed', {
            icao24: aircraft.icao24,
            target: target.id,
            message: error.message,
          });
        }
      }
    }

    await this.stateStore.saveTracks(updatedTracks, this.config.trackStateTtlSeconds);
    return {
      status: 'ok',
      sourceTimestamp: feed.timestamp,
      aircraft: aircraftValues.length,
      candidates,
      alerts,
      rateLimitRemaining: feed.rateLimitRemaining,
    };
  }
}
