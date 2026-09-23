# Aircraft Alerts for EPKK

Production-oriented MVP that predicts whether an aircraft on approach to Kraków Airport will pass near a private home and sends one ntfy notification per iPhone roughly two minutes before closest approach.

The system is trajectory-first. It does not use flight schedules and does not treat “eight minutes before landing” as a trigger. It keeps multiple ADS-B measurements, detects a coherent final turn toward the runway centreline, switches to closest point of approach (CPA) after rollout, checks sustained descent and EPKK convergence, and fails closed when the motion is erratic.

## Architecture

- n8n `2.40.5`: scheduler published on the configurable `N8N_PORT`; restrict it with the server firewall or a private network.
- Predictor service: OpenSky OAuth2 client, trajectory model, confidence scoring and ntfy publishing.
- Redis `8.10.2`: expiring track history and atomic per-phone alert deduplication.
- OpenSky `/states/all`: initial ADS-B source, queried every 30 seconds inside a bounded EPKK area.
- ntfy.sh: two independent, randomly generated topics.

The n8n workflow wakes every 15 seconds. The predictor enforces `ADSB_POLL_INTERVAL_SECONDS`, which defaults to 30 seconds. This keeps a standard authenticated OpenSky account below its 4,000-credit daily limit: 2,880 one-credit requests per day. OpenSky can still return delayed or incomplete data, so the service deliberately skips alerts when it cannot obtain a stable prediction.

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
```

Then set `HOME_LAT`, `HOME_LON`, `HOME_ELEVATION_METERS`, and the OpenSky client credentials. Never send these values in chat and never commit `.env`.

Validate and start:

```bash
docker compose config -q
docker compose build predictor
docker compose up -d
docker compose ps
docker compose logs --tail=100 predictor
```

Import `n8n/workflows/aircraft-overflight-alert.json` from the n8n UI, or run:

```bash
docker compose exec n8n n8n import:workflow --input=/workflows/aircraft-overflight-alert.json
```

n8n listens on the server's configured port. Allow that port only from a trusted IP or private network, then open:

```text
http://SERVER_IP:5678
```

Finish local owner setup, inspect the imported workflow, and publish it. n8n requires a Schedule Trigger workflow to be published before scheduled executions start.

## Verification

```bash
npm test
docker compose config -q
docker compose run --rm --no-deps predictor node scripts/push-smoke.js both
```

The push command never prints topic names. Use `iphone1` or `iphone2` instead of `both` to test one phone.

## Configuration

Important prediction variables:

- `ALERT_LEAD_TIME_SECONDS=120`
- `ALERT_WINDOW_SECONDS=30`, interpreted as ±30 seconds around the lead time
- `MAX_OVERFLIGHT_DISTANCE_METERS`
- `MIN_PREDICTION_CONFIDENCE`
- `MIN_CONFIRMATION_SAMPLES`
- `MIN_TRACK_SPAN_SECONDS`
- `MAX_TRACK_STDDEV_DEGREES`
- `MAX_CPA_ETA_SPREAD_SECONDS`
- `APPROACH_CORRIDOR_HALF_WIDTH_METERS`
- `RUNWAY_HEADING_TOLERANCE_DEGREES`
- `FINAL_TURN_EXIT_BEFORE_HOME_METERS=2000`
- `FINAL_TURN_CAPTURE_RADIUS_METERS=4000`

The EPKK runway headings and thresholds in `src/airports/epkk.js` come from AIP Poland EPKK AD 2.12. Home coordinates are never stored in this file.

## Security

- Keep the repository private and `.env` untracked.
- Do not publish ports 6379 or 8080.
- Restrict the n8n port with a firewall or private network. For Internet-facing use, add a reverse proxy, TLS and appropriate authentication controls.
- Treat ntfy.sh topic names as passwords. Anyone who learns a topic can subscribe or publish because all ntfy.sh topics are public.
- Successful n8n execution data is disabled; the workflow itself contains no credentials, coordinates, or topics.

## Documentation

- [Two-iPhone ntfy setup](docs/ntfy-iphone.md)
- [OpenSky credentials and quota](docs/opensky.md)
- [Prediction model and readiness criteria](docs/prediction.md)
- [Migration to local readsb/dump1090](docs/local-adsb.md)

## Stop and update

```bash
docker compose down
git pull --ff-only
docker compose build predictor
docker compose up -d
```

Do not use `docker compose down -v` during normal operation; `-v` deletes n8n and Redis state.
