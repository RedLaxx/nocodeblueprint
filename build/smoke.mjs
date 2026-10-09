/**
 * Smoke test: serve public/ locally and confirm the important routes answer.
 *
 *   node build/smoke.mjs
 *
 * Starts the same handler as `npm run preview` on an ephemeral port, requests
 * every URL that must keep working, and checks the status, the content type and
 * enough of the body to prove the right file was served. Exits non-zero on the
 * first failure, so it is safe to run in CI before a deploy.
 */

import { resolve } from 'node:path';
import { Suite } from './lib/harness.mjs';
import { createPreviewServer } from './preview.mjs';
import { loadContent, absoluteUrl } from './lib/content.mjs';

const ROOT = resolve('.');
const suite = new Suite('NoCode Blueprint — preview smoke test');
const content = loadContent(ROOT);
const publishedPosts = content.posts.filter((post) => !post.draft);
const publishedPages = content.pages.filter((page) => !page.draft);

const routes = [
  { path: '/', expect: 'text/html', contains: 'The good stuff, in steps.' },
  { path: '/index.html', expect: 'text/html', contains: 'The good stuff, in steps.' },
  { path: '/sitemap.xml', expect: 'application/xml', contains: '<urlset' },
  { path: '/feed.xml', expect: 'application/xml', contains: '<rss version="2.0">' },
  { path: '/robots.txt', expect: 'text/plain', contains: 'Sitemap:' },
  { path: '/ads.txt', expect: 'text/plain', contains: 'publisher inventory' },
  { path: '/assets/site.css', expect: 'text/css', contains: ':root' },
  { path: '/assets/site.js', expect: 'text/javascript', contains: 'results-status' },
  // Extension-less URLs must resolve, because that is how the header links are written.
  { path: '/about', expect: 'text/html', contains: 'About NoCode Blueprint' },
  { path: '/editorial-policy', expect: 'text/html', contains: 'Editorial' },
  { path: '/contact', expect: 'text/html', contains: content.site.contactEmail },
];

for (const slug of ['ai-inbox-triage', 'process-audit', 'follow-up-drafts']) {
  routes.push({ path: `/articles/${slug}.html`, expect: 'text/html', contains: 'application/ld+json' });
  routes.push({ path: `/articles/${slug}`, expect: 'text/html', contains: 'application/ld+json' });
}
for (const page of publishedPages) {
  routes.push({ path: `/${page.slug}.html`, expect: 'text/html', contains: 'standard-sidebar' });
}

const server = createPreviewServer();

await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${server.address().port}`;
console.log(`  preview listening on ${base}`);

suite.group('Routes answer');
for (const route of routes) {
  let response;
  let body = '';
  try {
    response = await fetch(base + route.path);
    body = await response.text();
  } catch (error) {
    suite.ok(`GET ${route.path}`, false, error.message);
    continue;
  }
  suite.equal(`GET ${route.path} -> 200`, response.status, 200);
  suite.ok(`GET ${route.path} serves ${route.expect}`,
    (response.headers.get('content-type') ?? '').startsWith(route.expect),
    `content-type was ${response.headers.get('content-type')}`);
  suite.ok(`GET ${route.path} returns the expected document`, body.includes(route.contains),
    `body did not contain ${JSON.stringify(route.contains)}`);
  suite.ok(`GET ${route.path} sets nosniff`, response.headers.get('x-content-type-options') === 'nosniff');
}

suite.group('Archive is reachable from the homepage');
{
  const home = await (await fetch(`${base}/`)).text();
  for (const post of publishedPosts) {
    suite.ok(`homepage links to /articles/${post.slug}.html`, home.includes(`href="articles/${post.slug}.html"`));
    const article = await fetch(`${base}/articles/${post.slug}.html`);
    suite.equal(`GET /articles/${post.slug}.html -> 200`, article.status, 200);
  }
  for (const page of publishedPages) {
    const response = await fetch(`${base}/${page.slug}.html`);
    suite.equal(`GET /${page.slug}.html -> 200`, response.status, 200);
  }
}

suite.group('Missing and unsafe routes');
{
  const missing = await fetch(`${base}/articles/does-not-exist.html`);
  suite.equal('an unknown article returns 404', missing.status, 404);
  suite.ok('the 404 response is the designed page', (await missing.text()).includes('hit a dead end'));

  const unknown = await fetch(`${base}/no-such-page`);
  suite.equal('an unknown page returns 404', unknown.status, 404);

  const traversal = await fetch(`${base}/../package.json`);
  suite.ok('path traversal cannot leave public/', traversal.status === 404 || !(await traversal.text()).includes('"scripts"'),
    `status ${traversal.status}`);

  const posted = await fetch(`${base}/`, { method: 'POST' });
  suite.equal('POST returns 405', posted.status, 405);
}

suite.group('Canonical metadata is served');
{
  for (const post of publishedPosts.slice(0, 3)) {
    const body = await (await fetch(`${base}/articles/${post.slug}.html`)).text();
    const expected = absoluteUrl(content.site, `/articles/${post.slug}.html`);
    suite.ok(`${post.slug} is served with its canonical URL`, body.includes(`<link rel="canonical" href="${expected}">`));
  }
}

server.close();
const passed = suite.report();
process.exit(passed ? 0 : 1);
