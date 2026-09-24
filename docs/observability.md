# Local log processing with Loki

## Why Loki

This single-server deployment uses Grafana Loki instead of Logstash/Elasticsearch. Loki indexes a small set of bounded labels and keeps the complete structured JSON as the log body. Grafana Alloy discovers only the `predictor` container, parses `level`, `event`, and `decision` as labels, and sends the stream to Loki. Callsign, ICAO24, altitude, distances, and rejection reasons remain query-time JSON fields to avoid high-cardinality indexes. Prometheus separately stores numeric measurements from the local weather collector; see [weather.md](weather.md).

The stack is intentionally separate from the main Compose file:

- Loki `3.7.0`, monolithic mode, TSDB schema v13, filesystem storage, 14-day retention;
- Grafana Alloy `1.19.2` for Docker discovery and collection;
- Grafana `13.2.2` (free default image), pre-provisioned Loki source and dashboard;
- Prometheus `3.13.3` LTS, available only inside the Compose network, for weather time series;
- Grafana bound to the configurable LAN-facing address; Loki and Alloy have no host ports.

Grafana 13.2 distributes its Prometheus data source as a standalone plugin. Compose pins `prometheus@13.2.1` and installs it synchronously before provisioning data sources, avoiding a startup race that otherwise leaves a visible but unusable Prometheus entry.

Alloy discovers the stable Compose service name `predictor`; it does not depend on the Compose project name, which may be overridden on a server.

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

The first start downloads approximately four additional images. Existing predictor, n8n, and Redis data is preserved.

## Open Grafana on the local network

Open Grafana from another device on the same LAN:

```text
http://SERVER_LAN_IP:3000
```

Sign in with the credentials from `.env`, and open **Dashboards → Aircraft Alerts → Aircraft Alerts — Log Decisions**.

The dashboard has selectors for event, level, decision, callsign, and rejection reason. The **All predictor logs** panel deliberately queries only the stable `job="aircraft-alerts"` label, so it also shows startup, polling, and error records when Docker Compose metadata differs between hosts.

`GRAFANA_BIND_ADDRESS=0.0.0.0` listens on every server interface. Restrict TCP port 3000 with the host/router firewall to your trusted local subnet and do not forward it from the Internet. If the server has a stable LAN address, setting `GRAFANA_BIND_ADDRESS` to that address is stricter. To restore SSH-tunnel-only access, use `GRAFANA_BIND_ADDRESS=127.0.0.1`.

`GRAFANA_ADMIN_PASSWORD` initializes the administrator only when `grafana_data` is first created. Changing the value later does not modify the account stored in Grafana's database. Reset an existing password with `grafana cli admin reset-admin-password`; do not delete the volume just to change a password.

## Useful LogQL queries

Run these in Grafana **Explore**, with the pre-provisioned `Loki` data source.

All aircraft decisions:

```logql
{job="aircraft-alerts", event="aircraft_evaluated"} | json
```

Rejected aircraft with readable fields:

```logql
{job="aircraft-alerts", event="aircraft_evaluated", decision="rejected"}
| json
| line_format "{{.callsign}} {{.icao24}} altitude={{.altitudeFeet}}ft track={{.trueTrackDegrees}}° airport={{.airportDistanceKilometers}}km home={{.homeDistanceKilometers}}km reasons={{.rejectionReasons}}"
```

Only stale positions:

```logql
{job="aircraft-alerts", event="aircraft_evaluated", decision="rejected"}
|= "stale_position"
| json
```

One callsign without creating a high-cardinality index label:

```logql
{job="aircraft-alerts", event="aircraft_evaluated"}
|= "RYR9DA"
| json
| callsign="RYR9DA"
```

Application errors:

```logql
{job="aircraft-alerts", level="error"} | json
```

Accepted-versus-rejected rate over five minutes:

```logql
sum by (decision) (
  count_over_time({job="aircraft-alerts", event="aircraft_evaluated"}[5m])
)
```

## Troubleshoot an empty dashboard

First confirm that the predictor is producing structured records and that Alloy can see its container:

```bash
docker compose logs --since=5m predictor
docker compose -f docker-compose.yml -f observability/docker-compose.yml logs --since=5m alloy loki
docker inspect aircraft-alerts-predictor-1 --format '{{json .Config.Labels}}'
```

Then generate a fresh poll and wait a few seconds for ingestion:

```bash
docker compose exec n8n node -e 'fetch("http://predictor:8080/poll",{method:"POST"}).then(async r=>console.log(r.status,await r.text()))'
```

In Grafana **Explore**, select Loki and run the broadest diagnostic query:

```logql
{job="aircraft-alerts"}
```

Use a time range such as **Last 15 minutes**. If predictor logs exist but this query is empty, inspect Alloy logs for Docker socket or Loki write errors. The dashboard selectors are populated from indexed Loki labels and therefore cannot contain values until at least one log has been ingested.

## Security and operations

Alloy needs read access to `/var/run/docker.sock` to discover and read predictor logs. Access to the Docker socket is security-sensitive even when mounted read-only; do not expose the Alloy UI, and keep the pinned image updated. Alloy runs as root for portable Docker-socket access, drops every capability, and adds back only `DAC_OVERRIDE` so it can write its image-owned persistent state directory. Loki has no authentication because it is reachable only inside the private Compose network. Grafana is authenticated, but its port must still be limited to the trusted LAN.

Retention is 14 days (`336h`). Loki retention is enforced by the Compactor. The three named volumes survive container recreation. To stop the optional stack without deleting data:

```bash
docker compose -f docker-compose.yml -f observability/docker-compose.yml stop grafana alloy loki
```

Do not add `-v` unless you explicitly intend to delete Grafana settings and all stored Loki logs.
