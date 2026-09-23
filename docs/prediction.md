# Trajectory prediction and readiness criteria

## Candidate gates

An aircraft is considered a possible EPKK arrival only when several measurements show all of the following:

- fresh valid positions and sufficient history;
- sustained descent;
- decreasing distance to EPKK;
- the home is close to the extended centreline of the candidate landing runway;
- the aircraft is converging on the airport and on the configurable final-turn capture area;
- a positive turn-aware ETA to the home;
- a coherent stable course or a coherent one-direction final turn.

ADS-B does not guarantee a destination field. These gates infer EPKK intent from motion and intentionally prefer a missed alert over a false alert.

## Turn-aware ETA and CPA calculation

Latitude/longitude samples are converted to local east/north metres relative to the home. Before final rollout, the model projects the current ADS-B ground-speed/track vector toward a virtual rollout point on the runway centreline. The default point is 2 km before the home, and the capture radius is configurable. ETA is the time to that point plus the short centreline segment to the home.

Once the aircraft has rolled out, ordinary closest point of approach is used. For relative position `r` and velocity `v`:

```text
tCPA = -(r · v) / |v|²
dCPA = |r + v × tCPA|
```

The age of the OpenSky position is subtracted from ETA so a delayed state vector does not produce a late notification. Altitude is extrapolated with the recent vertical trend. The model reports both predicted altitude MSL and approximate altitude above the configured home elevation.

The full history remains available for descent and airport-convergence checks, but old headings and CPA estimates from before the final turn do not poison the current forecast. A monotonic turn is accepted; a reversing or erratic sequence is rejected as `unstable_course`.

## Confidence

The score combines sample quality, freshness, descent, airport convergence, final-turn capture compatibility, course coherence and predicted overflight distance. Hard failures such as no descent, movement away from EPKK, a past overflight or an erratic course cannot be compensated by other score components.

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

The automated suite covers exact 120-second CPA, coherent final turns, too-early CPA, already-passed aircraft, aircraft moving away, airport-bound aircraft missing the home, erratic course, deduplication, and incompatible landing direction.
