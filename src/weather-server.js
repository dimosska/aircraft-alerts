import http from 'node:http';
import { EdwinWeatherClient, loadWeatherConfig, WeatherCollector } from './weather.js';

function logger(level, event, fields = {}) {
  const method = level === 'error' ? 'error' : 'log';
  console[method](JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
}

export function handleWeatherRequest(request, response, collector) {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({
      status: collector.isFresh() ? 'ok' : 'degraded',
      stationId: collector.config.stationId,
      lastError: collector.lastError,
    }));
    return;
  }
  if (request.method === 'GET' && request.url === '/metrics') {
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    response.end(collector.metrics());
    return;
  }
  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const config = loadWeatherConfig();
    const client = new EdwinWeatherClient(config);
    const collector = new WeatherCollector({ config, client, logger });
    const server = http.createServer((request, response) => handleWeatherRequest(request, response, collector));
    server.listen(config.port, '0.0.0.0', () => {
      logger('info', 'weather_server_started', { port: config.port, stationId: config.stationId });
      collector.poll();
    });
    const timer = setInterval(() => collector.poll(), config.pollIntervalSeconds * 1000);
    timer.unref();
  } catch (error) {
    logger('error', 'weather_startup_failed', { message: error.message });
    process.exitCode = 1;
  }
}
