/**
 * Preview: serve public/ exactly the way Cloudflare will.
 *
 *   node build/preview.mjs            http://localhost:8788
 *   PORT=3000 node build/preview.mjs
 *
 * Binds to 0.0.0.0 and answers for any Host header, so it works behind a
 * proxy or a tunnel without an allowlist. No dependencies, no build step:
 * it reads the committed files from disk on every request.
 *
 * Routing matches the deployed behaviour
 *   /                       -> public/index.html
 *   /about                  -> public/about.html        (extension optional)
 *   /articles/x.html        -> public/articles/x.html
 *   /assets/site.css        -> public/assets/site.css
 *   anything else           -> public/404.html with status 404
 */

import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const ROOT = resolve(positional[0] ?? '.');
const PUBLIC = join(ROOT, 'public');
const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? '0.0.0.0';

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
};

/** Map a request path to a file inside public/, or null if it escapes or is absent. */
export function resolveRequest(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  let relative = normalize(decoded).replace(/^([/\\])+/, '').split(sep).join('/');
  if (relative.startsWith('..') || relative.includes('../')) return null;

  const candidates = relative === '' || relative.endsWith('/')
    ? [`${relative}index.html`]
    : [relative, `${relative}.html`, `${relative}/index.html`];

  for (const candidate of candidates) {
    const absolute = join(PUBLIC, candidate);
    if (!absolute.startsWith(PUBLIC)) return null;
    if (existsSync(absolute) && statSync(absolute).isFile()) return candidate;
  }
  return null;
}

function send(response, status, body, type) {
  response.writeHead(status, {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

/** Build the request handler. Exported so build/smoke.mjs can test it in-process. */
export function createPreviewServer() {
  return createServer(handleRequest);
}

function handleRequest(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(response, 405, 'Method not allowed', 'text/plain; charset=utf-8');
    return;
  }

  const found = resolveRequest(request.url ?? '/');
  if (found === null) {
    const notFound = join(PUBLIC, '404.html');
    const body = existsSync(notFound) ? readFileSync(notFound, 'utf8') : '<h1>404</h1>';
    send(response, 404, body, CONTENT_TYPES['.html']);
    return;
  }

  const absolute = join(PUBLIC, found);
  const extension = extname(absolute).toLowerCase();
  const type = CONTENT_TYPES[extension] ?? 'application/octet-stream';
  // _headers and ads.txt are served by Cloudflare itself; locally they are plain text.
  send(response, 200, readFileSync(absolute), type);
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);

if (invokedDirectly) {
  const server = createPreviewServer();
  server.listen(PORT, HOST, () => {
    const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
    console.log('NoCode Blueprint preview');
    console.log(`  serving   ${PUBLIC}`);
    console.log(`  listening http://${shown}:${PORT}`);
    console.log('  routes    /  /about  /articles/ai-inbox-triage.html  /feed.xml  /sitemap.xml');
    console.log('  stop with Ctrl+C\n');
  });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      server.close();
      process.exit(0);
    });
  }
}

export { PUBLIC, PORT, HOST };
