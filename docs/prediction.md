# Candidate filtering and readiness criteria

## Alert rule

An aircraft produces an alert when its latest trustworthy OpenSky state satisfies every condition:

- its distance from the EPKK reference point is at most `OPENSKY_SEARCH_RADIUS_KM` (90 km by default);
- its distance from EPKK is greater than `MIN_AIRPORT_DISTANCE_KM` (8 km by default);
- its barometric altitude (or geometric altitude when barometric is absent) is below `MAX_CANDIDATE_ALTITUDE_FEET` (7,000 ft by default);
- its ADS-B vertical rate, or the altitude trend across available positions, is at most `-MIN_DESCENT_RATE_MPS`;
- its position is no more than 45 seconds old.

OpenSky does not provide a trustworthy live destination or landing ETA. This intentionally broad rule follows the deployment assumption that low descending civil traffic in the configured area is approaching KRK. The notification does not claim an exact overflight time.

`time_position` is mandatory. `last_contact` is never substituted for it because non-position Mode S messages can update `last_contact` while coordinates remain stale.

## Deduplication

Redis keeps a time-limited approach session for each ICAO24. Once a notification target is claimed, `SET NX EX` atomically prevents another message for that phone during the same approach. If publishing fails, the claim is released so the following workflow run can retry. A long loss of tracking expires the session and permits an alert for a later approach.

## Readiness criteria

- All automated tests pass.
- Compose parses successfully.
- The n8n workflow is published.
- Both phone-specific smoke tests arrive on the correct phone.
- No real coordinates, topic, OAuth credential or token appears in Git.
- Several real approaches are observed before relying on the system operationally.

The automated suite covers the altitude boundary, descent, inner 8 km exclusion, outer 90 km boundary, stale positions, altitude-trend fallback, per-phone deduplication and retry after an ntfy failure.
