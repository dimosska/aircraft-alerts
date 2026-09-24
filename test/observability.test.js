import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('observability configs use bounded labels, TSDB v13, and a filterable Grafana dashboard', async () => {
  const [compose, loki, alloy, datasource, dashboard] = await Promise.all([
    readFile('observability/docker-compose.yml', 'utf8'),
    readFile('observability/loki-config.yml', 'utf8'),
    readFile('observability/alloy-config.alloy', 'utf8'),
    readFile('observability/grafana/provisioning/datasources/loki.yml', 'utf8'),
    readFile('observability/grafana/dashboards/aircraft-alerts.json', 'utf8'),
  ]);

  assert.match(
    compose,
    /\$\{GRAFANA_BIND_ADDRESS:-0\.0\.0\.0\}:\$\{GRAFANA_PORT:-3000\}:3000/,
  );
  assert.doesNotMatch(compose, /3100:3100|12345:12345/);
  assert.match(loki, /store: tsdb/);
  assert.match(loki, /schema: v13/);
  assert.match(loki, /retention_period: 336h/);
  assert.match(loki, /retention_enabled: true/);
  assert.match(alloy, /compose_service/);
  assert.match(alloy, /regex\s+= "predictor"/);
  assert.doesNotMatch(alloy, /regex\s+= "aircraft-alerts"/);
  assert.doesNotMatch(alloy, /callsign\s+=|icao24\s+=/);
  assert.match(datasource, /url: http:\/\/loki:3100/);
  const parsedDashboard = JSON.parse(dashboard);
  assert.equal(parsedDashboard.uid, 'aircraft-alerts-logs');
  assert.deepEqual(
    parsedDashboard.templating.list.map((variable) => variable.name),
    ['event', 'level', 'decision', 'callsign', 'reason'],
  );
  assert.ok(parsedDashboard.panels.every((panel) =>
    panel.targets.every((target) => target.expr.includes('job="aircraft-alerts"'))
  ));
  assert.ok(parsedDashboard.panels.some((panel) => panel.title === 'All predictor logs'));
});
