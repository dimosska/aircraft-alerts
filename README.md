# Aircraft Alerts for EPKK

Production-oriented MVP that detects low, descending aircraft near Kraków Airport and sends one ntfy notification per iPhone.

The system does not use flight schedules. It alerts when a fresh OpenSky position is within 90 km of EPKK but more than 8 km from the airport, below 7,000 ft, and descending. Redis suppresses subsequent notifications for the same aircraft approach.

## Architecture

- n8n `2.40.5`: scheduler published on the configurable `N8N_PORT`; restrict it with the server firewall or a private network.
- Predictor service: OpenSky OAuth2 client, configurable candidate filtering and ntfy publishing.
- Redis `8.10.2`: expiring track history and atomic per-phone alert deduplication.
- OpenSky `/states/all`: initial ADS-B source, queried every 30 seconds inside a bounded EPKK area.
- ntfy.sh: two independent, randomly generated topics.

The n8n workflow wakes every 15 seconds. The predictor enforces `ADSB_POLL_INTERVAL_SECONDS`, which defaults to 30 seconds. This keeps a standard authenticated OpenSky account below its 4,000-credit daily limit: 2,880 one-credit requests per day. State vectors without a real `time_position` are discarded so old coordinates cannot masquerade as new measurements.

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

Important filtering variables:

- `OPENSKY_SEARCH_RADIUS_KM=90`
- `MAX_CANDIDATE_ALTITUDE_FEET=7000`
- `MIN_AIRPORT_DISTANCE_KM=8`
- `MIN_DESCENT_RATE_MPS=0.5`

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
