# Aircraft Alerts and Local Weather

Production-oriented MVP that detects low, descending aircraft near Kraków Airport and sends one ntfy notification per iPhone.

The same private Docker stack also provides a Grafana dashboard backed by real one-minute observations from the nearby eDWIN Węgrzce weather station. The weather collector uses a public station ID and never sends the home coordinates to the weather API.

The system does not use flight schedules. It alerts when a fresh OpenSky position is within 50 km of EPKK but more than 8 km from the airport, below 5,000 ft, descending, and has a true track strictly between 180° and 270°. Light general-aviation traffic is excluded using the ADS-B emitter category, while business jets, airliners, heavy aircraft and high-performance aircraft remain eligible. Redis suppresses subsequent notifications for the same aircraft approach.

## Architecture

- n8n `2.40.5`: scheduler published on the configurable `N8N_PORT`; restrict it with the server firewall or a private network.
- Predictor service: OpenSky OAuth2 client, configurable candidate filtering and ntfy publishing.
- Redis `8.10.2`: expiring track history and atomic per-phone alert deduplication.
- OpenSky `/states/all`: initial ADS-B source, queried every 30 seconds inside a bounded EPKK area.
- ntfy.sh: two independent, randomly generated topics.
- ntfy control: a third secret topic lets Apple Shortcuts toggle alerts without inbound NAT access.
- Weather collector: public eDWIN station `PME193`, polled once per minute without credentials.
- Prometheus: private time-series storage for the local weather dashboard.

The n8n workflow wakes every 15 seconds from 10:00:00 through 19:59:45 in the `Europe/Warsaw` timezone. The predictor enforces `ADSB_POLL_INTERVAL_SECONDS`, which defaults to 30 seconds. The restricted daily window reduces OpenSky usage further. State vectors without a real `time_position` are discarded so old coordinates cannot masquerade as new measurements.

## Server installation

Requirements: Git, Docker Engine, and Docker Compose v2.

```bash
git clone <your-private-repository-url> aircraft-alerts
cd aircraft-alerts
cp .env.example .env
```

Generate independent values locally and paste them into `.env`:

```bash
openssl rand -hex 32  # N8N_ENCRYPTION_KEY
openssl rand -hex 32  # REDIS_PASSWORD
openssl rand -hex 24  # NTFY_TOPIC_IPHONE_1
openssl rand -hex 24  # NTFY_TOPIC_IPHONE_2
openssl rand -hex 24  # NTFY_CONTROL_TOPIC
```

Then set `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION_METERS`, and the OpenSky client credentials. Never send these values in chat and never commit `.env`.

Validate and start:

```bash
docker compose config -q
docker compose build predictor weather
docker compose up -d
docker compose ps
docker compose logs --tail=100 predictor
```

The predictor writes one structured JSON `aircraft_evaluated` log per aircraft and poll. It includes callsign, ICAO24, ADS-B category, position age, sample count, altitude, speed, true track, vertical/descent rate, distance to KRK and home, classification match, the `accepted`/`rejected` decision, and all rejection reasons. It never logs home coordinates, credentials, tokens, or ntfy topics. Follow decisions live with:

```bash
docker compose logs -f predictor
```

An eligible aircraft that has already notified a phone produces a separate `notification_suppressed` event with `reason=duplicate_approach`.
Predictor container logs use Docker's `json-file` driver with five 20 MB rotated files (about 100 MB maximum).

Import `n8n/workflows/aircraft-overflight-alert.json` from the n8n UI, or run:

```bash
docker compose exec n8n n8n import:workflow --input=/workflows/aircraft-overflight-alert.json
```

n8n listens on the server's configured port. Allow that port only from a trusted IP or private network, then open:

```text
http://SERVER_IP:5678
```

Finish local owner setup, inspect the imported workflow, and publish it. n8n requires a Schedule Trigger workflow to be published before scheduled executions start.

The separate `n8n/workflows/notification-control.json` workflow checks the private ntfy control topic every 15 seconds, all day. Configure `NTFY_CONTROL_ENABLED=true` and the separately generated `NTFY_CONTROL_TOPIC` in `.env`, import that workflow, and publish it. This uses outbound HTTPS only; n8n and the predictor remain unreachable through the server's NAT. See [Apple Shortcuts notification control](docs/notification-control.md).

For an already imported workflow, edit its Schedule Trigger in the UI, select **Custom (Cron)**, enter `*/15 * 10-19 * * *`, save, and publish again. Pulling the repository does not automatically replace a workflow already stored in the n8n database.

## Verification

```bash
npm test
docker compose config -q
docker compose run --rm --no-deps predictor node scripts/push-smoke.js both
```

The push command never prints topic names. Use `iphone1` or `iphone2` instead of `both` to test one phone.

## Configuration

Important filtering variables:

- `OPENSKY_SEARCH_RADIUS_KM=50`
- `MAX_CANDIDATE_ALTITUDE_FEET=5000`
- `MIN_AIRPORT_DISTANCE_KM=8`
- `MIN_DESCENT_RATE_MPS=0.5`
- `MIN_TRUE_TRACK_DEGREES=180`
- `MAX_TRUE_TRACK_DEGREES=270`
- `AIRCRAFT_ADSB_CATEGORY_ALLOWLIST=3,4,5,6,7`
- `ALLOW_OPERATOR_CALLSIGN_FALLBACK=true`
- `AIRCRAFT_ICAO24_ALLOWLIST=` (optional exact overrides)

OpenSky category `2` means `Light` (below 15,500 lb) and is excluded by default. Categories `3` through `7` cover aircraft from `Small` (15,500–75,000 lb) through high-performance aircraft. When OpenSky reports category `0`, `1`, or no category, a standard ICAO operator-style callsign containing a flight number (for example `RYR9DA`, `LOT123`, `NJE123`, or `PLF101`) is accepted. Registration-style callsigns such as `SPABC` are not accepted by this fallback. Exact ICAO24 overrides remain available for known exceptions.

The EPKK runway headings and thresholds in `src/airports/epkk.js` come from AIP Poland EPKK AD 2.12. Home coordinates are never stored in this file.

## Security

- Keep the repository private and `.env` untracked.
- Do not publish ports 6379 or 8080.
- Restrict the n8n port with a firewall or private network. For Internet-facing use, add a reverse proxy, TLS and appropriate authentication controls.
- Treat ntfy.sh topic names as passwords. Anyone who learns a topic can subscribe or publish because all ntfy.sh topics are public.
- Successful n8n execution data is disabled; the workflow itself contains no credentials, coordinates, or topics.

## Documentation

- [Two-iPhone ntfy setup](docs/ntfy-iphone.md)
- [Apple Shortcuts notification control](docs/notification-control.md)
- [OpenSky credentials and quota](docs/opensky.md)
- [Prediction model and readiness criteria](docs/prediction.md)
- [Migration to local readsb/dump1090](docs/local-adsb.md)
- [Local Loki, Alloy, and Grafana log processing](docs/observability.md)
- [Local weather collector, Prometheus, and Grafana dashboard](docs/weather.md)

## Stop and update

```bash
docker compose down
git pull --ff-only
docker compose build predictor weather
docker compose up -d
```

Do not use `docker compose down -v` during normal operation; `-v` deletes n8n and Redis state.
