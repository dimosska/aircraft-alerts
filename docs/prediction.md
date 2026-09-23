# Trajectory prediction and readiness criteria

## Candidate gates

An aircraft is considered a possible EPKK arrival only when several measurements show all of the following:

- fresh valid positions and sufficient history;
- sustained descent;
- decreasing distance to EPKK;
- membership in the approach corridor before a runway threshold;
- track compatible with that runway’s true bearing;
- positive time to closest approach to the home;
- predicted CPA distance within the configured limit;
- stable course and stable repeated CPA estimates.

ADS-B does not guarantee a destination field. These gates infer EPKK intent from motion and intentionally prefer a missed alert over a false alert.

## CPA calculation

Latitude/longitude samples are converted to local east/north metres relative to the home. Linear regression over recent positions estimates horizontal velocity. For relative position `r` and velocity `v`:

```text
tCPA = -(r · v) / |v|²
dCPA = |r + v × tCPA|
```

Altitude is extrapolated with the recent vertical trend. The model reports both predicted altitude MSL and approximate altitude above the configured home elevation.

Linear extrapolation is used only for a short horizon. Circular course deviation and the spread of absolute CPA times across successive measurements detect turns. A sharp turn or inconsistent forecast suppresses the notification until the track stabilizes.

## Confidence

The score combines sample quality, freshness, descent, airport convergence, runway/corridor compatibility, course stability, CPA distance and repeated-CPA stability. Hard failures such as a past CPA, wrong runway direction, missed home, or unstable course cannot be compensated by other score components.

## Approach and deduplication

Redis keeps a time-limited approach session for each ICAO24. Once a notification target is claimed, `SET NX EX` atomically prevents a second message for that phone during that approach. If publishing fails, the claim is released so the same phone may be retried while the ETA remains inside the alert window. A long loss of tracking expires the session and allows a later approach.

## Readiness criteria

- All automated tests pass.
- Compose parses successfully.
- The workflow imports into pinned n8n and is explicitly published.
- Both phone-specific smoke tests arrive on the correct phone only.
- No real coordinate, topic, OAuth credential or token appears in `git grep` or staged diff.
- At least several real EPKK approaches are observed in logs before relying on alerts; tune thresholds using outcomes, without logging home coordinates.
- OpenSky outages or low-frequency data result in no notification rather than an unstable prediction.

The automated suite covers exact 120-second CPA, too-early CPA, already-passed aircraft, aircraft moving away, airport-bound aircraft missing the home, unstable course, deduplication, and incompatible landing direction.
