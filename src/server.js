import http from 'node:http';

export function handleRequest(request, response) {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json' });
  response.end(JSON.stringify({ error: 'not_found' }));
}

export function createServer() {
  return http.createServer(handleRequest);
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const port = Number.parseInt(process.env.PORT ?? '8080', 10);
  const server = createServer();
  server.listen(port, '0.0.0.0', () => {
    console.log(JSON.stringify({ level: 'info', event: 'server_started', port }));
  });
}
