import http from 'node:http';
import { EPKK } from './airports/epkk.js';
import { loadConfig } from './config.js';
import { NtfyClient } from './ntfy.js';
import { OpenSkyClient } from './opensky.js';
import { PollService } from './poll-service.js';
import { RedisClient, RedisStateStore } from './redis.js';

function sendJson(response, status, payload) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

export async function handleRequest(request, response, service = null) {
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.method === 'POST' && request.url === '/poll' && service) {
    sendJson(response, 200, await service.poll());
    return;
  }

  sendJson(response, 404, { error: 'not_found' });
}

export function createServer(service = null) {
  return http.createServer((request, response) => {
    handleRequest(request, response, service).catch((error) => {
      console.error(JSON.stringify({ level: 'error', event: 'request_failed', message: error.message }));
      if (!response.headersSent) sendJson(response, 500, { status: 'error' });
      else response.end();
    });
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  try {
    const config = loadConfig();
    if (config.airportIcao !== 'EPKK') throw new Error('Only AIRPORT_ICAO=EPKK is configured');
    const redisClient = new RedisClient(config.redis);
    const stateStore = new RedisStateStore(redisClient);
    const logger = (level, event, fields = {}) => {
      const method = level === 'error' ? 'error' : 'log';
      console[method](JSON.stringify({ level, event, ...fields }));
    };
    const service = new PollService({
      config,
      airport: EPKK,
      adsbClient: new OpenSkyClient(config.opensky),
      stateStore,
      ntfyClient: new NtfyClient(config.notifications),
      logger,
    });
    const server = createServer(service);
    server.listen(config.port, '0.0.0.0', () => {
      logger('info', 'server_started', { port: config.port, source: config.adsbSource });
    });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', event: 'startup_failed', message: error.message }));
    process.exitCode = 1;
  }
}
