# Local weather dashboard

The weather collector reads real one-minute measurements from the public eDWIN station **Węgrzce (`PME193`)**, located roughly 2–3 km from the configured neighbourhood. It does not send the home coordinates to eDWIN and does not require an API key. The station ID can be replaced through `.env` without changing code.

Available measurements:

- air temperature in °C;
- relative humidity in percent;
- wind speed in m/s;
- wind direction in degrees;
- the precipitation value reported by the station;
- observation timestamp and age.

The source endpoint and its documented interface are maintained by the Polish eDWIN platform. Keep source attribution when presenting or redistributing the measurements.

## Start

The collector is part of the main Compose file. Prometheus and the provisioned dashboard are part of the optional observability file:

```bash
docker compose \
  -f docker-compose.yml \
  -f observability/docker-compose.yml \
  up -d --build weather prometheus grafana
```

Open Grafana and select **Dashboards → Aircraft Alerts → Local Weather — Węgrzce**. Prometheus scrapes every 30 seconds. The collector requests eDWIN once per minute, retains the last valid reading during a temporary API failure, and marks `weather_up` as zero when the observation becomes stale.

Prometheus retains at most 365 days or 1 GB, whichever limit is reached first. Its port is available only on the private Compose network.

## Configuration

Defaults are safe to commit because they identify a public station and contain no home coordinates or credentials:

```env
WEATHER_STATION_ID=PME193
WEATHER_STATION_NAME=Węgrzce
WEATHER_API_BASE_URL=https://edwin-meteo.apps.paas.psnc.pl
WEATHER_POLL_INTERVAL_SECONDS=60
WEATHER_STALE_AFTER_SECONDS=600
```

`WEATHER_STALE_AFTER_SECONDS` must be at least twice the polling interval. The collector requests only the most recent 15-minute window and chooses the newest timestamp from the response.

## Verify

```bash
docker compose ps weather
docker compose logs --tail=50 weather
docker compose exec weather node -e \
  'fetch("http://127.0.0.1:8080/metrics").then(async r=>console.log(await r.text()))'

docker compose \
  -f docker-compose.yml \
  -f observability/docker-compose.yml \
  exec prometheus wget -qO- \
  'http://127.0.0.1:9090/api/v1/query?query=weather_up'
```

Expected results include `weather_up 1` and `weather_temperature_celsius`. On first start, allow up to one minute for the dashboard selector and panels to populate.

## Failure behaviour

- An eDWIN timeout or invalid response is logged as `weather_update_failed` and does not stop the server.
- The last successful observation remains exported with an increasing age.
- `/health` remains reachable and reports `degraded` while data is missing or stale, preventing a remote API outage from causing a restart loop.
- No collector or Prometheus port is published on the host.
