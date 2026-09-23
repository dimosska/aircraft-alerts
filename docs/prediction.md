# Candidate filtering and readiness criteria

## Alert rule

An aircraft produces an alert when its latest trustworthy OpenSky state satisfies every condition:

- its ADS-B emitter category is in `AIRCRAFT_ADSB_CATEGORY_ALLOWLIST` (`3,4,5,6,7` by default), or its exact transponder address is in `AIRCRAFT_ICAO24_ALLOWLIST`;
- its distance from the EPKK reference point is at most `OPENSKY_SEARCH_RADIUS_KM` (50 km by default);
- its distance from EPKK is greater than `MIN_AIRPORT_DISTANCE_KM` (8 km by default);
- its barometric altitude (or geometric altitude when barometric is absent) is below `MAX_CANDIDATE_ALTITUDE_FEET` (5,000 ft by default);
- its ADS-B vertical rate, or the altitude trend across available positions, is at most `-MIN_DESCENT_RATE_MPS`;
- its `true_track` is strictly greater than `MIN_TRUE_TRACK_DEGREES` (180°) and strictly less than `MAX_TRUE_TRACK_DEGREES` (270°);
- its position is no more than 45 seconds old.

OpenSky does not provide a trustworthy live destination or landing ETA. This intentionally broad rule follows the deployment assumption that low descending civil traffic in the configured area is approaching KRK. The notification does not claim an exact overflight time.

The live API does not identify an aircraft as private, corporate, scheduled airline or military. Its category `2` means `Light` (below 15,500 lb), while category `3` starts at 15,500 lb. The default allowlist therefore rejects light Cessna-class general aviation and missing/unknown categories while retaining business jets, regional and mainline airliners, heavy transports and high-performance aircraft. Some very light business jets or military trainers may be excluded; add a known six-digit ICAO24 address to `AIRCRAFT_ICAO24_ALLOWLIST` when an exact exception is needed.

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

The automated suite covers ADS-B category filtering, exact ICAO24 overrides, the altitude boundary, descent, inner 8 km exclusion, outer 50 km boundary, strict true-track boundaries, stale positions, altitude-trend fallback, per-phone deduplication, Unicode ntfy titles and retry after an ntfy failure.
