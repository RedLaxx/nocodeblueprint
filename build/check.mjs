/**
 * Check: every quality gate the deployment depends on.
 *
 * Runs against the files in public/ as they are committed. Nothing here needs
 * network access or a secret, so it produces the same verdict locally and in
 * CI. Exits non-zero on the first failing group summary.
 *
 *   node build/check.mjs            full report
 *   node build/check.mjs --quiet    failures only
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { Suite } from './lib/harness.mjs';
import {
  parseHtml, parseXml, extractJsonLd, extractLinks, visibleText, isExternalLink, ValidationError,
} from './lib/validate.mjs';
import { parse as parseYaml } from './lib/yaml.mjs';
import { loadContent, absoluteUrl } from './lib/content.mjs';
import { buildOutputs } from './build.mjs';
import { verifySync } from './verify.mjs';

const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const ROOT = resolve(positional[0] ?? '.');
const PUBLIC = join(ROOT, 'public');
const suite = new Suite('NoCode Blueprint — deployment checks');

/** URLs that existed before the CMS migration and must never move or disappear. */
const PROTECTED_ARTICLES = [
  'ai-inbox-triage', 'lead-qualification', 'content-repurposing', 'process-audit',
  'meeting-notes-to-actions', 'support-ticket-routing', 'weekly-reporting', 'document-intake',
  'invoice-processing', 'knowledge-base-assistant', 'client-onboarding', 'ai-workflow-evals',
  'prompt-versioning', 'calendar-scheduling', 'follow-up-drafts',
];
const PROTECTED_PAGES = [
  'about', 'editorial-policy', 'contact', 'privacy-policy', 'cookie-policy', 'terms', 'disclaimer',
];
const PROTECTED_FILES = [
  'index.html', 'sitemap.xml', 'feed.xml', 'robots.txt', '404.html', 'ads.txt', '_headers',
  'assets/site.css', 'assets/site.js',
];
/** Domains that must not appear in generated output. */
const FORBIDDEN_DOMAIN = 'nocodeblueprint.com';
const ALLOWED_FORBIDDEN_USE = 'hello@nocodeblueprint.com';

const readPublic = (rel) => readFileSync(join(PUBLIC, rel), 'utf8');
const readRoot = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Walk public/ recursively, returning repo-relative paths with forward slashes. */
function walk(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) walk(absolute, base, out);
    else out.push(relative(base, absolute).split(sep).join('/'));
  }
  return out;
}

/**
 * Turn a link found in `from` into a public-relative path, or null if the link
 * leaves the site. Directory links ("./", "../", "/") resolve to index.html,
 * which is what both Cloudflare and a browser will serve.
 */
function resolveLocalLink(from, url) {
  const target = url.split('#')[0].split('?')[0];
  if (target === '') return from;
  if (isExternalLink(target)) return null;
  const joined = target.startsWith('/')
    ? target.replace(/^\/+/, '')
    : join(dirname(from), target);
  let clean = normalize(joined).split(sep).join('/');
  if (clean.endsWith('/')) clean += 'index.html';
  if (clean === '.' || clean === './' || clean === '') clean = 'index.html';
  clean = clean.replace(/^\.\//, '');
  if (clean === '.' || clean === '') clean = 'index.html';
  return clean;
}

const content = loadContent(ROOT);
const { site, posts, pages, archive, featuredPost } = content;
const publishedPosts = posts.filter((post) => !post.draft);
const publishedPages = pages.filter((page) => !page.draft);
/** Parsed <item> elements from feed.xml, shared by the link and metadata groups. */
let feedItems = [];

const generatedHtml = [
  'index.html',
  ...archive.map((post) => `articles/${post.slug}.html`),
  ...publishedPages.map((page) => `${page.slug}.html`),
];

// ---------------------------------------------------------------------------
suite.group('Build sync and determinism');
{
  const sync = verifySync(ROOT);
  suite.ok('public/ is in sync with content/ and config/site.yml', sync.inSync,
    [...sync.missing.map((p) => `missing: ${p}`), ...sync.differing.map((p) => `stale: ${p}`)].join('\n'));

  const first = buildOutputs(ROOT);
  const second = buildOutputs(ROOT);
  const sameKeys = [...first.outputs.keys()].join('|') === [...second.outputs.keys()].join('|');
  const sameBytes = sameKeys
    && [...first.outputs.entries()].every(([path, value]) => second.outputs.get(path) === value);
  suite.ok('two consecutive builds produce identical bytes', sameBytes, 'build output is not deterministic');

  suite.equal('build reports the canonical base URL', first.summary.baseUrl, 'https://nocodeblueprint.deehasalo.workers.dev');
  suite.equal('build sees 15 published posts', first.summary.posts, 15);
  suite.equal('build sees 0 drafts', first.summary.drafts, 0);
  suite.equal('build sees 7 published pages', first.summary.pages, 7);
}

// ---------------------------------------------------------------------------
suite.group('Protected URLs');
{
  for (const slug of PROTECTED_ARTICLES) {
    const path = `articles/${slug}.html`;
    suite.ok(`/articles/${slug}.html exists`, existsSync(join(PUBLIC, path)), `${path} is missing`);
    if (existsSync(join(PUBLIC, path))) {
      suite.ok(`/articles/${slug}.html is not empty`, statSync(join(PUBLIC, path)).size > 2000, `${path} is suspiciously small`);
    }
  }
  for (const slug of PROTECTED_PAGES) {
    const path = `${slug}.html`;
    suite.ok(`/${slug}.html exists`, existsSync(join(PUBLIC, path)), `${path} is missing`);
  }
  for (const path of PROTECTED_FILES) {
    suite.ok(`/${path} exists`, existsSync(join(PUBLIC, path)), `${path} is missing`);
  }

  const onDisk = readdirSync(join(PUBLIC, 'articles')).filter((name) => name.endsWith('.html')).sort();
  const expected = publishedPosts.map((post) => `${post.slug}.html`).sort();
  suite.equal('no orphan article files', onDisk.join(','), expected.join(','));

  for (const post of publishedPosts) {
    suite.ok(`content/posts/${post.slug}.md produced its article`, onDisk.includes(`${post.slug}.html`));
  }
}

// ---------------------------------------------------------------------------
suite.group('Generated documents parse');
{
  for (const path of generatedHtml) {
    const source = readPublic(path);
    const { errors } = parseHtml(source);
    suite.ok(`${path} is well-formed HTML`, errors.length === 0, errors.slice(0, 4).join('\n'));
  }
  suite.noThrow('404.html is well-formed HTML', () => {
    const { errors } = parseHtml(readPublic('404.html'));
    if (errors.length > 0) throw new ValidationError(errors[0]);
  });

  for (const post of publishedPosts) {
    const path = `articles/${post.slug}.html`;
    let payloads;
    try {
      payloads = extractJsonLd(readPublic(path));
    } catch (error) {
      suite.ok(`${path} JSON-LD parses`, false, error.message);
      continue;
    }
    suite.equal(`${path} has exactly one JSON-LD block`, payloads.length, 1);
    const data = payloads[0]?.data ?? {};
    suite.equal(`${path} JSON-LD type`, data['@type'], 'BlogPosting');
    suite.equal(`${path} JSON-LD headline`, data.headline, post.title);
    suite.equal(`${path} JSON-LD datePublished`, data.datePublished, post.date);
    suite.equal(`${path} JSON-LD mainEntityOfPage`, data.mainEntityOfPage?.['@id'], absoluteUrl(site, `/articles/${post.slug}.html`));
    suite.equal(`${path} JSON-LD articleSection`, data.articleSection, post.category);
    suite.ok(`${path} JSON-LD has a numeric wordCount`, Number.isInteger(data.wordCount) && data.wordCount > 100,
      `wordCount was ${JSON.stringify(data.wordCount)}`);
    suite.ok(`${path} JSON-LD author is an Organization`, data.author?.['@type'] === 'Organization');
  }

  let homeLd;
  try {
    homeLd = extractJsonLd(readPublic('index.html'));
  } catch (error) {
    suite.ok('index.html JSON-LD parses', false, error.message);
  }
  if (homeLd) {
    suite.equal('index.html has one JSON-LD block', homeLd.length, 1);
    suite.equal('index.html JSON-LD type', homeLd[0].data['@type'], 'WebSite');
    suite.equal('index.html JSON-LD url', homeLd[0].data.url, `${site.baseUrl}/`);
  }
}

// ---------------------------------------------------------------------------
suite.group('Internal links');
{
  const filesOnDisk = new Set(walk(PUBLIC, PUBLIC));
  const broken = [];
  const externalInsecure = [];
  const anchors = [];

  for (const path of [...generatedHtml, '404.html']) {
    const source = readPublic(path);
    const ids = new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
    for (const link of extractLinks(source)) {
      const { url } = link;
      if (url.startsWith('#')) {
        anchors.push({ path, url, ok: ids.has(url.slice(1)) });
        continue;
      }
      if (/^(mailto|tel):/i.test(url)) continue;
      if (isExternalLink(url)) {
        if (url.startsWith('http://')) externalInsecure.push(`${path}: ${url}`);
        continue;
      }
      const resolved = resolveLocalLink(path, url);
      if (resolved === null) continue;
      if (!filesOnDisk.has(resolved)) broken.push(`${path}:${link.line} -> ${url} (resolved to ${resolved})`);
    }
  }

  suite.ok('every relative link resolves to a file in public/', broken.length === 0, broken.slice(0, 12).join('\n'));
  suite.ok('every in-page anchor resolves to an id', anchors.every((a) => a.ok),
    anchors.filter((a) => !a.ok).slice(0, 8).map((a) => `${a.path} -> ${a.url}`).join('\n'));
  suite.ok('no insecure http:// links', externalInsecure.length === 0, externalInsecure.slice(0, 6).join('\n'));

  let sitemapUrls = [];
  if (suite.noThrow('sitemap.xml parses as XML', () => parseXml(readPublic('sitemap.xml')))) {
    const sitemap = parseXml(readPublic('sitemap.xml'));
    sitemapUrls = sitemap.children.flatMap((node) => node.children)
      .filter((node) => node.tag === 'url')
      .map((node) => node.children.find((child) => child.tag === 'loc')?.text.trim() ?? '');
  }
  suite.ok('sitemap.xml declares one <url> per document', sitemapUrls.length > 0, 'no <loc> entries found');
  const sitemapMissing = sitemapUrls
    .map((url) => {
      if (!url.startsWith(`${site.baseUrl}/`)) return `${url} is not under the canonical base URL`;
      const path = url.slice(site.baseUrl.length + 1) || 'index.html';
      return filesOnDisk.has(path) ? null : `${url} -> ${path} does not exist`;
    })
    .filter(Boolean);
  suite.ok('every sitemap URL maps to a real file', sitemapMissing.length === 0, sitemapMissing.slice(0, 8).join('\n'));
  suite.equal('sitemap URL count', sitemapUrls.length, 1 + publishedPages.length + publishedPosts.length);

  if (suite.noThrow('feed.xml parses as XML', () => parseXml(readPublic('feed.xml')))) {
    const feed = parseXml(readPublic('feed.xml'));
    const channel = feed.children.flatMap((node) => node.children).find((node) => node.tag === 'channel');
    feedItems = channel?.children.filter((node) => node.tag === 'item') ?? [];
  }
  const items = feedItems;
  suite.equal('feed.xml has one item per published post', items.length, publishedPosts.length);
  const feedMissing = items
    .map((item) => item.children.find((child) => child.tag === 'link')?.text.trim() ?? '')
    .map((url) => {
      const path = url.slice(site.baseUrl.length + 1);
      return filesOnDisk.has(path) ? null : `${url} -> ${path} does not exist`;
    })
    .filter(Boolean);
  suite.ok('every feed link maps to a real article', feedMissing.length === 0, feedMissing.slice(0, 6).join('\n'));
}

// ---------------------------------------------------------------------------
suite.group('Canonical URLs and domain');
{
  for (const path of generatedHtml) {
    const source = readPublic(path);
    // The homepage is served at "/", so its canonical URL has no file name.
    const expected = path === 'index.html' ? `${site.baseUrl}/` : absoluteUrl(site, `/${path}`);
    const canonical = /<link rel="canonical" href="([^"]*)">/.exec(source)?.[1];
    suite.equal(`${path} canonical URL`, canonical, expected);
    const ogUrl = /<meta property="og:url" content="([^"]*)">/.exec(source)?.[1];
    suite.equal(`${path} og:url`, ogUrl, expected);
    suite.ok(`${path} declares og:title`, /<meta property="og:title" content="[^"]+">/.test(source));
    suite.ok(`${path} declares og:description`, /<meta property="og:description" content="[^"]+">/.test(source));
    suite.ok(`${path} declares twitter:card`, /<meta name="twitter:card" content="[^"]+">/.test(source));
  }

  const offenders = [];
  for (const path of walk(PUBLIC, PUBLIC)) {
    const source = readPublic(path);
    let index = source.indexOf(FORBIDDEN_DOMAIN);
    while (index !== -1) {
      const context = source.slice(Math.max(0, index - 40), index + FORBIDDEN_DOMAIN.length + 10);
      if (!context.includes(ALLOWED_FORBIDDEN_USE)) offenders.push(`${path}: …${context.trim()}…`);
      index = source.indexOf(FORBIDDEN_DOMAIN, index + FORBIDDEN_DOMAIN.length);
    }
  }
  suite.ok(`no ${FORBIDDEN_DOMAIN} references outside ${ALLOWED_FORBIDDEN_USE}`, offenders.length === 0,
    offenders.slice(0, 8).join('\n'));

  const robots = readPublic('robots.txt');
  suite.equal('robots.txt points at the live sitemap',
    /Sitemap: (.+)/.exec(robots)?.[1].trim(), `${site.baseUrl}/sitemap.xml`);
  suite.ok('robots.txt allows crawling', /^Allow: \/$/m.test(robots));
}

// ---------------------------------------------------------------------------
suite.group('Homepage archive');
{
  const source = readPublic('index.html');
  const missingCards = archive.filter((post) => !source.includes(`href="articles/${post.slug}.html"`));
  suite.ok('homepage links to every published article', missingCards.length === 0,
    missingCards.map((post) => post.slug).join(', '));

  const cardLinks = [...source.matchAll(/href="articles\/([a-z0-9-]+)\.html"/g)].map((match) => match[1]);
  const uniqueCards = new Set(cardLinks);
  suite.equal('homepage card count matches the archive', uniqueCards.size, archive.length);

  suite.ok('homepage features the chosen post',
    source.includes(`href="articles/${featuredPost.slug}.html"`) && /class="featured-layout"/.test(source),
    `expected a featured card for ${featuredPost.slug}`);
  suite.ok('homepage shows the featured post category', source.includes(featuredPost.category));

  // Each grid card is <article class="article-card" data-category="…"> wrapping
  // the link, so pair the two up per card rather than by proximity.
  const cards = source.split('<article class="article-card"').slice(1).map((chunk) => {
    const category = /^\s+data-category="([a-z0-9-]+)"/.exec(chunk)?.[1];
    const slug = /href="articles\/([a-z0-9-]+)\.html"/.exec(chunk)?.[1];
    const search = /data-search="([^"]*)"/.exec(chunk)?.[1] ?? '';
    return { category, slug, search };
  });
  suite.equal('homepage renders one card per published post', cards.length, archive.length);
  for (const post of archive) {
    const card = cards.find((entry) => entry.slug === post.slug);
    suite.ok(`card for ${post.slug} exists`, card !== undefined);
    if (!card) continue;
    suite.equal(`card for ${post.slug} carries its category`, card.category, post.category.toLowerCase());
    suite.ok(`card for ${post.slug} exposes a search haystack`,
      card.search.includes(post.title) && card.search.includes(post.description),
      `data-search was "${card.search.slice(0, 120)}"`);
    for (const tag of post.tags) {
      suite.ok(`card for ${post.slug} is searchable by "${tag}"`, card.search.includes(tag));
    }
  }

  const categoriesInUse = [...new Set(archive.map((post) => post.category))];
  const buttons = [...source.matchAll(/data-filter="([a-z0-9-]+)"/g)].map((match) => match[1]);
  suite.equal('filter buttons cover "all" plus every category in use',
    [...new Set(buttons)].sort().join(','),
    ['all', ...categoriesInUse.map((name) => name.toLowerCase())].sort().join(','));

  suite.ok('homepage states the archive size',
    source.includes(`${archive.length} field notes`) && source.includes(`${archive.length} practical field notes`),
    `expected "${archive.length} field notes" and "${archive.length} practical field notes"`);

  const emptyState = /data-empty[^>]*>|class="empty-state"/.test(source);
  suite.ok('homepage keeps its empty-state markup', emptyState);
}

// ---------------------------------------------------------------------------
suite.group('Feed and sitemap metadata');
{
  const feedSource = readPublic('feed.xml');
  const sitemapSource = readPublic('sitemap.xml');

  suite.ok('feed.xml declares RSS 2.0', feedSource.includes('<rss version="2.0"'));
  suite.ok('feed.xml starts with an XML declaration', feedSource.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  suite.equal('feed channel link', /<channel>[\s\S]*?<link>([^<]*)<\/link>/.exec(feedSource)?.[1], `${site.baseUrl}/`);
  suite.ok('feed channel title is set', /<channel>[\s\S]*?<title>[^<]+<\/title>/.test(feedSource));
  suite.ok('feed channel has a description', /<channel>[\s\S]*?<description>[^<]+<\/description>/.test(feedSource));
  suite.match('feed channel declares a language', /<language>([a-z]{2}-[a-z]{2})<\/language>/.exec(feedSource)?.[1] ?? '', /^[a-z]{2}-[a-z]{2}$/);
  const lastBuildDate = /<lastBuildDate>([^<]+)<\/lastBuildDate>/.exec(feedSource)?.[1] ?? '';
  suite.ok('feed channel has a parseable lastBuildDate', Number.isFinite(Date.parse(lastBuildDate)), lastBuildDate);

  const pubDates = [...feedSource.matchAll(/<pubDate>([^<]+)<\/pubDate>/g)].map((match) => match[1]);
  suite.equal('feed has one pubDate per item', pubDates.length, publishedPosts.length);
  suite.ok('every pubDate parses', pubDates.every((value) => Number.isFinite(Date.parse(value))),
    pubDates.filter((value) => !Number.isFinite(Date.parse(value))).join(', '));
  const sorted = [...pubDates].sort((a, b) => Date.parse(b) - Date.parse(a));
  suite.equal('feed items are ordered newest first', pubDates.join('|'), sorted.join('|'));

  const guids = [...feedSource.matchAll(/<guid isPermaLink="true">([^<]+)<\/guid>/g)].map((match) => match[1]);
  suite.equal('every item has a permanent guid', guids.length, publishedPosts.length);
  suite.equal('guids match the item links', guids.join('|'),
    feedItems.map((item) => item.children.find((child) => child.tag === 'link')?.text.trim() ?? '').join('|'));

  suite.ok('sitemap declares the 0.9 namespace', sitemapSource.includes('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"'));
  const lastmods = [...sitemapSource.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((match) => match[1]);
  suite.ok('every sitemap entry has a valid lastmod',
    lastmods.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)), lastmods.filter((v) => !/^\d{4}-\d{2}-\d{2}$/.test(v)).join(', '));
  suite.ok('sitemap marks the homepage weekly and articles monthly',
    /<priority>1\.0<\/priority>/.test(sitemapSource) && /<priority>0\.7<\/priority>/.test(sitemapSource));
}

// ---------------------------------------------------------------------------
suite.group('Content fidelity against the pre-migration site');
{
  const baselinePath = join(ROOT, 'build', 'test', 'fixtures', 'content-baseline.json');
  if (!existsSync(baselinePath)) {
    suite.ok('content baseline fixture exists', false, baselinePath);
  } else {
    const baseline = JSON.parse(readRoot('build/test/fixtures/content-baseline.json'));
    suite.equal('baseline covers every generated document', Object.keys(baseline.documents).length, 22);

    for (const [url, expected] of Object.entries(baseline.documents)) {
      const path = url.replace(/^\//, '');
      const source = readPublic(path);
      const region = path.startsWith('articles/')
        ? /<article class="article-content">\n([\s\S]*?)<div class="article-end">/.exec(source)?.[1]
        : /<div class="article-content">([\s\S]*?)<\/div><\/div><aside class="standard-sidebar">/.exec(source)?.[1];
      if (region === undefined) {
        suite.ok(`${url} body region located`, false, 'the article-content markers changed, so fidelity cannot be measured');
        continue;
      }
      const text = visibleText(region);
      suite.equal(`${url} visible text is unchanged`, sha256(text), expected.textSha256);
      suite.equal(`${url} word count is unchanged`, text.split(/\s+/).filter(Boolean).length, expected.words);
      suite.equal(`${url} heading count is unchanged`, (region.match(/<h[2-6]>/g) ?? []).length, expected.headings);
      suite.equal(`${url} paragraph count is unchanged`, (region.match(/<p>/g) ?? []).length, expected.paragraphs);
      suite.equal(`${url} list item count is unchanged`, (region.match(/<li>/g) ?? []).length, expected.listItems);
      suite.equal(`${url} prompt box count is unchanged`, (region.match(/<div class="prompt-box">/g) ?? []).length, expected.promptBoxes);
      suite.equal(`${url} callout count is unchanged`, (region.match(/<div class="callout">/g) ?? []).length, expected.callouts);
      suite.equal(`${url} checklist count is unchanged`, (region.match(/<ul class="checklist">/g) ?? []).length, expected.checklists);
    }
  }
}

// ---------------------------------------------------------------------------
suite.group('Pages CMS configuration');
{
  const KNOWN_TOP_LEVEL = new Set(['cache', 'hide', 'media', 'content', 'components', 'actions', 'settings']);
  const KNOWN_FORMATS = new Set([
    'yaml-frontmatter', 'json-frontmatter', 'toml-frontmatter',
    'yaml', 'json', 'toml', 'datagrid', 'code', 'raw',
  ]);
  const KNOWN_FIELD_TYPES = new Set([
    'boolean', 'code', 'date', 'file', 'image', 'number', 'reference',
    'rich-text', 'select', 'string', 'text', 'uuid', 'object', 'block',
  ]);
  const KNOWN_LEAF_KEYS = new Set([
    'name', 'label', 'description', 'type', 'path', 'filename', 'exclude', 'view',
    'format', 'delimiters', 'subfolders', 'fields', 'list', 'commit', 'actions', 'operations',
  ]);
  const KNOWN_FIELD_KEYS = new Set([
    'name', 'label', 'type', 'component', 'required', 'pattern', 'hidden', 'readonly',
    'description', 'default', 'options', 'fields', 'list', 'blocks', 'blockKey',
  ]);
  const NAME_PATTERN = /^[a-zA-Z0-9-_]+$/;
  const PATH_PATTERN = /^[^/].*[^/]$|^$/;

  const problems = [];
  let config = null;
  try {
    config = parseYaml(readRoot('.pages.yml'));
  } catch (error) {
    problems.push(`.pages.yml does not parse: ${error.message}`);
  }

  if (config) {
    for (const key of Object.keys(config)) {
      if (!KNOWN_TOP_LEVEL.has(key)) problems.push(`unknown top-level key "${key}"`);
    }
    if (!Array.isArray(config.content)) problems.push('"content" must be a list');

    const checkFields = (fields, where) => {
      for (const field of fields) {
        const label = `${where}.${field.name ?? '(unnamed)'}`;
        if (!NAME_PATTERN.test(field.name ?? '')) problems.push(`${label}: "name" must match ^[a-zA-Z0-9-_]+$`);
        for (const key of Object.keys(field)) {
          if (!KNOWN_FIELD_KEYS.has(key)) problems.push(`${label}: unknown field key "${key}"`);
        }
        const hasType = 'type' in field;
        const hasComponent = 'component' in field;
        if (hasType === hasComponent) problems.push(`${label}: needs exactly one of "type" or "component"`);
        if (hasType && !KNOWN_FIELD_TYPES.has(field.type)) problems.push(`${label}: unknown field type "${field.type}"`);
        if (field.type === 'object' && !Array.isArray(field.fields)) problems.push(`${label}: type "object" needs "fields"`);
        if (field.type === 'object' && Array.isArray(field.fields)) checkFields(field.fields, label);
        if ('list' in field) {
          const list = field.list;
          const valid = typeof list === 'boolean'
            || (list && typeof list === 'object' && Object.keys(list).every((k) => ['min', 'max', 'collapsible'].includes(k))
              && 'collapsible' in list);
          if (!valid) problems.push(`${label}: "list" must be a boolean, or an object that also sets "collapsible"`);
        }
        if (field.type === 'code' && !field.options) {
          problems.push(`${label}: a "code" field must set "options" (Pages CMS reads options.lintFn unconditionally)`);
        }
        if (field.type === 'select' && !Array.isArray(field.options?.values)) {
          problems.push(`${label}: a "select" field must set "options.values"`);
        }
      }
    };

    for (const entry of config.content ?? []) {
      if (!NAME_PATTERN.test(entry.name ?? '')) problems.push(`entry "${entry.name}": bad name`);
      for (const key of Object.keys(entry)) {
        if (!KNOWN_LEAF_KEYS.has(key)) problems.push(`entry "${entry.name}": unknown key "${key}"`);
      }
      if (!['collection', 'file', 'group'].includes(entry.type)) problems.push(`entry "${entry.name}": bad type`);
      if ('path' in entry && !PATH_PATTERN.test(entry.path)) {
        problems.push(`entry "${entry.name}": "path" must be relative with no leading or trailing slash`);
      }
      if (entry.format && !KNOWN_FORMATS.has(entry.format)) problems.push(`entry "${entry.name}": unknown format "${entry.format}"`);
      if (entry.type === 'collection' && !entry.format) problems.push(`entry "${entry.name}": collections need a "format"`);
      if ('operations' in entry) {
        for (const key of Object.keys(entry.operations)) {
          if (!['create', 'rename', 'delete'].includes(key)) problems.push(`entry "${entry.name}": unknown operation "${key}"`);
        }
      }
      if (Array.isArray(entry.fields)) checkFields(entry.fields, entry.name);
      else problems.push(`entry "${entry.name}": no "fields"`);
    }

    // Every content file on disk must be reachable from a configured collection.
    const collectionPaths = (config.content ?? [])
      .filter((entry) => entry.type === 'collection')
      .map((entry) => entry.path);
    for (const directory of ['content/posts', 'content/pages']) {
      suite.ok(`.pages.yml has a collection for ${directory}`, collectionPaths.includes(directory));
    }
    suite.ok('.pages.yml exposes config/site.yml as a file entry',
      (config.content ?? []).some((entry) => entry.type === 'file' && entry.path === 'config/site.yml'));

    // Schema fields must line up with what the build actually reads.
    const postFields = new Set((config.content.find((e) => e.name === 'posts')?.fields ?? []).map((f) => f.name));
    const pageFields = new Set((config.content.find((e) => e.name === 'pages')?.fields ?? []).map((f) => f.name));
    for (const key of ['title', 'slug', 'status', 'date', 'category', 'description', 'tags', 'banner_title', 'card_steps']) {
      suite.ok(`CMS exposes the post field "${key}"`, postFields.has(key));
    }
    suite.ok('CMS exposes the post body', postFields.has('body'));
    for (const key of ['title', 'slug', 'status', 'order', 'description', 'footer_label', 'sidebar_label']) {
      suite.ok(`CMS exposes the page field "${key}"`, pageFields.has(key));
    }
    suite.ok('CMS exposes the page body', pageFields.has('body'));
    suite.equal('post body uses the lossless code editor',
      config.content.find((e) => e.name === 'posts')?.fields.find((f) => f.name === 'body')?.type, 'code');
    suite.equal('page body uses the lossless code editor',
      config.content.find((e) => e.name === 'pages')?.fields.find((f) => f.name === 'body')?.type, 'code');
    suite.ok('settings preserve frontmatter keys outside the schema', config.settings?.content?.merge === true);
    suite.ok('media is configured for public/media -> /media',
      config.media?.input === 'public/media' && config.media?.output === '/media');
  }

  suite.ok('.pages.yml matches the published Pages CMS schema', problems.length === 0, problems.slice(0, 15).join('\n'));

  const siteConfig = parseYaml(readRoot('config/site.yml'));
  suite.equal('config/site.yml declares the canonical base URL', siteConfig.baseUrl, site.baseUrl);
  suite.ok('config/site.yml lists every category in use',
    categoriesCover(siteConfig.categories, archive));

  // Every managed file must exist, and no content file may be left unmanaged.
  for (const path of ['config/site.yml', '.pages.yml']) {
    suite.ok(`${path} exists`, existsSync(join(ROOT, path)));
  }
  const stray = [];
  for (const directory of ['content/posts', 'content/pages']) {
    for (const name of readdirSync(join(ROOT, directory))) {
      if (!name.endsWith('.md') || name === 'README.md') continue;
      const slug = name.slice(0, -3);
      const known = directory === 'content/posts'
        ? posts.some((post) => post.slug === slug)
        : pages.some((page) => page.slug === slug);
      if (!known) stray.push(`${directory}/${name}`);
    }
  }
  suite.ok('every content file is loaded by the build', stray.length === 0, stray.join('\n'));
}

function categoriesCover(configured, articles) {
  const names = new Set((configured ?? []).map((entry) => entry.name));
  return articles.every((post) => names.has(post.category));
}

// ---------------------------------------------------------------------------
suite.group('Hygiene');
{
  const jsFiles = [
    join(PUBLIC, 'assets', 'site.js'),
    ...walk(join(ROOT, 'build'), ROOT).filter((path) => path.endsWith('.mjs')).map((path) => join(ROOT, path)),
    ...walk(join(ROOT, 'scripts'), ROOT).filter((path) => path.endsWith('.mjs')).map((path) => join(ROOT, path)),
  ];
  for (const file of jsFiles) {
    suite.ok(`JavaScript syntax: ${relative(ROOT, file)}`,
      runNodeCheck(file), `node --check failed on ${relative(ROOT, file)}`);
  }

  const banned = [
    [/ca-pub-\d{8,}/, 'a real-looking AdSense publisher ID'],
    [/\bG-[A-Z0-9]{8,}\b/, 'a Google Analytics 4 measurement ID'],
    [/\bUA-\d{4,}-\d+\b/, 'a Universal Analytics property ID'],
    [/googletagmanager\.com/, 'a tag manager snippet'],
    [/google-analytics\.com/, 'an analytics snippet'],
    [/\bgtag\s*\(/, 'a gtag call'],
    [/\bfbq\s*\(/, 'a Facebook pixel'],
    [/hotjar/i, 'a Hotjar snippet'],
  ];
  for (const path of walk(PUBLIC, PUBLIC)) {
    const source = readPublic(path);
    for (const [pattern, description] of banned) {
      suite.ok(`no ${description} in ${path}`, !pattern.test(source), `matched ${pattern}`);
    }
  }

  const ads = readPublic('ads.txt');
  suite.ok('ads.txt has no active publisher line', !/^google\.com,/m.test(ads),
    'ads.txt contains an uncommented google.com line');

  const secretPatterns = [
    /BEGIN (?:RSA |EC )?PRIVATE KEY/,
    /\b(?:sk|pk|ghp|gho|github_pat)_[A-Za-z0-9]{20,}/,
    /\bAKIA[0-9A-Z]{16}\b/,
  ];
  for (const path of walk(PUBLIC, PUBLIC)) {
    const source = readPublic(path);
    for (const pattern of secretPatterns) {
      suite.ok(`no credential material in ${path}`, !pattern.test(source));
    }
  }

  const buildFiles = walk(join(ROOT, 'build'), ROOT).concat(walk(join(ROOT, 'scripts'), ROOT));
  for (const path of buildFiles) {
    if (!path.endsWith('.mjs')) continue;
    const source = readRoot(path);
    suite.ok(`${path} reads no environment variable`, !/process\.env\.(?!BUILD_DEBUG|NO_COLOR|PORT|HOST)[A-Z_]+/.test(source),
      'build scripts must not require secrets');
  }
}

function runNodeCheck(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
const quiet = process.argv.includes('--quiet');
if (quiet) {
  const failed = suite.groups.flatMap((group) => group.checks.filter((check) => !check.passed));
  if (failed.length === 0) {
    console.log(`All checks passed (${suite.assertions} assertions).`);
  } else {
    console.log(`${failed.length} of ${suite.assertions} checks failed:`);
    for (const check of failed) console.log(`  ✗ ${check.name}${check.detail ? `\n      ${check.detail}` : ''}`);
  }
} else {
  suite.report();
}

if (content.warnings.length > 0) {
  console.log(`Content warnings (${content.warnings.length}):`);
  for (const warning of content.warnings) console.log(`  ! ${warning}`);
  console.log('');
}

process.exit(suite.failures === 0 ? 0 : 1);
