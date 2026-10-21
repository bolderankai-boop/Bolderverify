import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { app, type Bindings } from '../src/api/index';
import { localDatabase } from './sqlite';

mkdirSync('.local', { recursive: true });
const local = localDatabase('.local/bolderank.sqlite');
const env: Bindings = {
  DB: local.db, AUTH_PRINCIPALS: process.env.AUTH_PRINCIPALS,
  // Remote calls remain off in the local fallback unless explicitly enabled.
  ALLOW_REMOTE_MODELS: process.env.ALLOW_REMOTE_MODELS,
  MODEL_ENDPOINT: process.env.MODEL_ENDPOINT, MODEL_TOKEN: process.env.MODEL_TOKEN,
  MODEL_REVISION: process.env.MODEL_REVISION
};
const root = resolve('build/web');
const types: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url ?? '/', 'http://127.0.0.1:8787');
    if (!url.pathname.startsWith('/api/')) {
      let path = resolve(root, '.' + decodeURIComponent(url.pathname));
      if (path !== root && !path.startsWith(root + sep)) { outgoing.writeHead(403).end(); return; }
      if (path === root) path = resolve(root, 'index.html');
      if (!existsSync(path)) { outgoing.writeHead(404).end('Not found. Build the UI first.'); return; }
      outgoing.writeHead(200, { 'Content-Type': types[extname(path)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      outgoing.end(readFileSync(path)); return;
    }
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of incoming) {
      length += chunk.length;
      if (length > 262144) { outgoing.writeHead(413).end('Request too large'); return; }
      chunks.push(Buffer.from(chunk));
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value) headers.set(name, Array.isArray(value) ? value.join(',') : value);
    const request = new Request(url, { method: incoming.method, headers,
      ...(!['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? { body: Buffer.concat(chunks) } : {}) });
    const response = await app.fetch(request, env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500).end('Local server error'); }
});
server.listen(8787, '127.0.0.1', () => console.log('Local Node/SQLite fallback: http://127.0.0.1:8787 (not the Cloudflare runtime)'));
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => server.close(() => { local.close(); process.exit(0); }));

