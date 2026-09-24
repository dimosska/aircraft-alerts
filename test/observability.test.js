import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('observability configs provide logs and a local weather metrics dashboard', async () => {
  const [compose, loki, alloy, lokiDatasource, aircraftDashboard, prometheus, prometheusDatasource, weatherDashboard] = await Promise.all([
    readFile('observability/docker-compose.yml', 'utf8'),
    readFile('observability/loki-config.yml', 'utf8'),
    readFile('observability/alloy-config.alloy', 'utf8'),
    readFile('observability/grafana/provisioning/datasources/loki.yml', 'utf8'),
    readFile('observability/grafana/dashboards/aircraft-alerts.json', 'utf8'),
    readFile('observability/prometheus.yml', 'utf8'),
    readFile('observability/grafana/provisioning/datasources/prometheus.yml', 'utf8'),
    readFile('observability/grafana/dashboards/weather.json', 'utf8'),
  ]);

  assert.match(
    compose,
    /\$\{GRAFANA_BIND_ADDRESS:-0\.0\.0\.0\}:\$\{GRAFANA_PORT:-3000\}:3000/,
  );
  assert.match(compose, /alloy:[\s\S]*cap_add:[\s\S]*- DAC_OVERRIDE/);
  assert.match(compose, /prom\/prometheus:v3\.13\.3/);
  assert.match(compose, /GF_PLUGINS_PREINSTALL_SYNC: prometheus@13\.2\.1/);
  assert.match(compose, /GF_PLUGINS_PREINSTALL_AUTO_UPDATE: "false"/);
  assert.match(compose, /--storage\.tsdb\.retention\.time=365d/);
  assert.match(compose, /--storage\.tsdb\.retention\.size=1GB/);
  assert.doesNotMatch(compose, /3100:3100|12345:12345|9090:9090/);
  assert.match(loki, /store: tsdb/);
  assert.match(loki, /schema: v13/);
  assert.match(loki, /retention_period: 336h/);
  assert.match(loki, /retention_enabled: true/);
  assert.match(alloy, /compose_service/);
  assert.match(alloy, /regex\s+= "predictor"/);
  assert.doesNotMatch(alloy, /regex\s+= "aircraft-alerts"/);
  assert.doesNotMatch(alloy, /callsign\s+=|icao24\s+=/);
  assert.match(lokiDatasource, /url: http:\/\/loki:3100/);
  const parsedDashboard = JSON.parse(aircraftDashboard);
  assert.equal(parsedDashboard.uid, 'aircraft-alerts-logs');
  assert.deepEqual(
    parsedDashboard.templating.list.map((variable) => variable.name),
    ['event', 'level', 'decision', 'callsign', 'reason'],
  );
  assert.ok(parsedDashboard.panels.every((panel) =>
    panel.targets.every((target) => target.expr.includes('job="aircraft-alerts"'))
  ));
  assert.ok(parsedDashboard.panels.some((panel) => panel.title === 'All predictor logs'));
  assert.match(prometheus, /job_name: weather/);
  assert.match(prometheus, /weather:8080/);
  assert.match(prometheusDatasource, /url: http:\/\/prometheus:9090/);
  const parsedWeatherDashboard = JSON.parse(weatherDashboard);
  assert.equal(parsedWeatherDashboard.uid, 'local-weather');
  assert.ok(parsedWeatherDashboard.panels.some((panel) => panel.title === 'Temperature history'));
  assert.ok(parsedWeatherDashboard.panels.every((panel) =>
    panel.targets.every((target) => target.expr.startsWith('weather_'))
  ));
});
