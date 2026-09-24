# Local log processing with Loki

## Why Loki

This single-server deployment uses Grafana Loki instead of Logstash/Elasticsearch. Loki indexes a small set of bounded labels and keeps the complete structured JSON as the log body. Grafana Alloy discovers only the `predictor` container, parses `level`, `event`, and `decision` as labels, and sends the stream to Loki. Callsign, ICAO24, altitude, distances, and rejection reasons remain query-time JSON fields to avoid high-cardinality indexes.

The stack is intentionally separate from the main Compose file:

- Loki `3.7.0`, monolithic mode, TSDB schema v13, filesystem storage, 14-day retention;
- Grafana Alloy `1.19.2` for Docker discovery and collection;
- Grafana `13.2.2` (free default image), pre-provisioned Loki source and dashboard;
- Grafana bound to the configurable LAN-facing address; Loki and Alloy have no host ports.

## Configure and start

Generate a password locally and add it to `.env`:

```bash
openssl rand -base64 32
```

```env
GRAFANA_BIND_ADDRESS=0.0.0.0
GRAFANA_PORT=3000
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=paste-the-generated-value-here
```

Never commit `.env`. Validate and start:

```bash
docker compose -f docker-compose.yml -f observability/docker-compose.yml config -q
docker compose -f docker-compose.yml -f observability/docker-compose.yml up -d
docker compose -f docker-compose.yml -f observability/docker-compose.yml ps
docker compose -f docker-compose.yml -f observability/docker-compose.yml logs --tail=100 loki alloy grafana
```

The first start downloads approximately three additional images. Existing predictor, n8n, and Redis data is preserved.

## Open Grafana on the local network

Open Grafana from another device on the same LAN:

```text
http://SERVER_LAN_IP:3000
```

Sign in with the credentials from `.env`, and open **Dashboards → Aircraft Alerts → Aircraft Alerts — Log Decisions**.

`GRAFANA_BIND_ADDRESS=0.0.0.0` listens on every server interface. Restrict TCP port 3000 with the host/router firewall to your trusted local subnet and do not forward it from the Internet. If the server has a stable LAN address, setting `GRAFANA_BIND_ADDRESS` to that address is stricter. To restore SSH-tunnel-only access, use `GRAFANA_BIND_ADDRESS=127.0.0.1`.

## Useful LogQL queries

Run these in Grafana **Explore**, with the pre-provisioned `Loki` data source.

All aircraft decisions:

```logql
{compose_project="aircraft-alerts", compose_service="predictor", event="aircraft_evaluated"} | json
```

Rejected aircraft with readable fields:

```logql
{compose_project="aircraft-alerts", compose_service="predictor", event="aircraft_evaluated", decision="rejected"}
| json
| line_format "{{.callsign}} {{.icao24}} altitude={{.altitudeFeet}}ft track={{.trueTrackDegrees}}° airport={{.airportDistanceKilometers}}km home={{.homeDistanceKilometers}}km reasons={{.rejectionReasons}}"
```

Only stale positions:

```logql
{compose_project="aircraft-alerts", compose_service="predictor", event="aircraft_evaluated", decision="rejected"}
|= "stale_position"
| json
```

One callsign without creating a high-cardinality index label:

```logql
{compose_project="aircraft-alerts", compose_service="predictor", event="aircraft_evaluated"}
|= "RYR9DA"
| json
| callsign="RYR9DA"
```

Application errors:

```logql
{compose_project="aircraft-alerts", compose_service="predictor", level="error"} | json
```

Accepted-versus-rejected rate over five minutes:

```logql
sum by (decision) (
  count_over_time({compose_project="aircraft-alerts", compose_service="predictor", event="aircraft_evaluated"}[5m])
)
```

## Security and operations

Alloy needs read access to `/var/run/docker.sock` to discover and read predictor logs. Access to the Docker socket is security-sensitive even when mounted read-only; do not expose the Alloy UI, and keep the pinned image updated. Loki has no authentication because it is reachable only inside the private Compose network. Grafana is authenticated, but its port must still be limited to the trusted LAN.

Retention is 14 days (`336h`). Loki retention is enforced by the Compactor. The three named volumes survive container recreation. To stop the optional stack without deleting data:

```bash
docker compose -f docker-compose.yml -f observability/docker-compose.yml stop grafana alloy loki
```

Do not add `-v` unless you explicitly intend to delete Grafana settings and all stored Loki logs.
