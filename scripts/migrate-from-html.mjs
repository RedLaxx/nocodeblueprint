/**
 * One-shot migration: read the existing hand-written HTML in public/ and emit
 * the CMS-managed sources (content/posts, content/pages, config/site.yml).
 *
 * It is kept in the repository (scripts/migrate-from-html.mjs) so the mapping
 * from legacy HTML to Markdown is reviewable, and so it can be re-run against
 * any historic checkout. It is NOT part of `npm run build`.
 *
 * Usage: node scripts/migrate-from-html.mjs [--out DIR]
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { stringify as yamlStringify, formatFrontmatter } from '../build/lib/yaml.mjs';

const ROOT = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PUBLIC = join(ROOT, 'public');
const args = process.argv.slice(2);
const outFlag = args.indexOf('--out');
const OUT = outFlag === -1 ? ROOT : args[outFlag + 1];

const BASE_URL = 'https://nocodeblueprint.deehasalo.workers.dev';
const SITE_NAME = 'NoCode Blueprint';

/* ------------------------------------------------------------------ *
 * HTML -> Markdown
 * ------------------------------------------------------------------ */

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'div', 'blockquote', 'pre']);

/** Split an HTML fragment into top-level elements, ignoring inter-tag whitespace. */
function topElements(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    if (html[i] !== '<') {
      if (!/^\s*$/.test(html[i])) {
        throw new Error(`Unexpected text outside an element at offset ${i}: ${JSON.stringify(html.slice(i, i + 60))}`);
      }
      i += 1;
      continue;
    }
    const open = /^<([a-zA-Z0-9]+)([^>]*)>/.exec(html.slice(i));
    if (!open) throw new Error(`Unparsable markup at offset ${i}: ${JSON.stringify(html.slice(i, i + 60))}`);
    const tag = open[1].toLowerCase();
    if (!BLOCK_TAGS.has(tag)) throw new Error(`Unexpected top-level <${tag}> at offset ${i}`);
    let depth = 0;
    let j = i;
    let end = -1;
    while (j < html.length) {
      const next = html.indexOf('<', j);
      if (next === -1) break;
      const token = /^<(\/?)([a-zA-Z0-9]+)([^>]*)>/.exec(html.slice(next));
      if (!token) {
        j = next + 1;
        continue;
      }
      if (token[2].toLowerCase() === tag) {
        if (token[1] === '/') {
          depth -= 1;
          if (depth === 0) {
            end = next + token[0].length;
            break;
          }
        } else if (!token[3].endsWith('/')) {
          depth += 1;
        }
      }
      j = next + token[0].length;
    }
    if (end === -1) throw new Error(`Unclosed <${tag}> at offset ${i}`);
    out.push({ tag, html: html.slice(i, end), inner: html.slice(i + open[0].length, end - tag.length - 3) });
    i = end;
  }
  return out;
}

function classOf(fragment) {
  const match = /^<[a-zA-Z0-9]+[^>]*class="([^"]*)"/.exec(fragment);
  return match ? match[1] : '';
}

function listItems(inner, tag) {
  const items = [];
  const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  let match;
  let cursor = 0;
  while ((match = re.exec(inner)) !== null) {
    const between = inner.slice(cursor, match.index);
    if (!/^\s*$/.test(between)) throw new Error(`Unexpected content between <${tag}> items: ${JSON.stringify(between)}`);
    items.push(match[1]);
    cursor = match.index + match[0].length;
  }
  if (!/^\s*$/.test(inner.slice(cursor))) throw new Error(`Trailing content in list: ${JSON.stringify(inner.slice(cursor))}`);
  return items;
}

function inlineToMarkdown(html) {
  return html
    .replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/g, '*$1*')
    .replace(/<code>([\s\S]*?)<\/code>/g, '`$1`')
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, '[$2]($1)');
}

function blockToMarkdown(element) {
  const cls = classOf(element.html);
  const { tag, inner } = element;

  if (tag === 'p') return inlineToMarkdown(inner);
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag[1]))} ${inlineToMarkdown(inner)}`;

  if (tag === 'ul' && cls === 'checklist') {
    return [':::checklist', ...listItems(inner, 'li').map((item) => `- ${inlineToMarkdown(item)}`), ':::'].join('\n');
  }
  if (tag === 'ul' && cls === '') {
    return listItems(inner, 'li').map((item) => `- ${inlineToMarkdown(item)}`).join('\n');
  }
  if (tag === 'ol') {
    return listItems(inner, 'li').map((item, index) => `${index + 1}. ${inlineToMarkdown(item)}`).join('\n');
  }

  if (tag === 'div' && (cls === 'callout' || cls === 'notice')) {
    return [`:::${cls}`, inlineToMarkdown(inner), ':::'].join('\n');
  }

  if (tag === 'div' && cls === 'prompt-box') {
    const match = /^<span class="prompt-label">([\s\S]*?)<\/span>([\s\S]*)$/.exec(inner);
    if (!match) throw new Error(`prompt-box does not start with a prompt-label span: ${JSON.stringify(inner.slice(0, 80))}`);
    return [`:::prompt "${match[1]}"`, match[2], ':::'].join('\n');
  }

  // Anything else is preserved verbatim as a raw HTML block.
  return element.html;
}

export function htmlBodyToMarkdown(body) {
  return topElements(body).map(blockToMarkdown).join('\n\n');
}

/* ------------------------------------------------------------------ *
 * Reading the legacy files
 * ------------------------------------------------------------------ */

function read(file) {
  return readFileSync(file, 'utf8');
}

function must(pattern, source, label) {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern);
  const match = re.exec(source);
  if (!match) throw new Error(`Could not find ${label}`);
  return match[1];
}

function migrateArticle(file) {
  const source = read(file);
  const indexSource = read(join(PUBLIC, 'index.html'));
  const slug = basename(file, '.html');
  const ld = JSON.parse(must(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, source, `JSON-LD in ${file}`));

  const rawBody = must(/<article class="article-content">\n([\s\S]*)<\/article>/, source, `body in ${file}`);
  const bodyHtml = /^([\s\S]*)<div class="article-end">/.exec(rawBody)[1];

  const relatedHtml = must(/<div class="related-links">([\s\S]*?)<\/div><\/aside>/, source, `related links in ${file}`);
  const related = [...relatedHtml.matchAll(/<a href="([a-z0-9-]+)\.html">/g)].map((m) => m[1]);

  const cardBlock = new RegExp(`<article class="article-card"[^>]*>\\s*<a href="articles/${slug}\\.html"[\\s\\S]*?</article>`)
    .exec(indexSource)?.[0];
  if (!cardBlock) throw new Error(`No homepage card found for ${slug}`);
  const cardSteps = [...cardBlock.matchAll(/<div class="art-row"><i class="art-dot"><\/i>([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  if (cardSteps.length !== 3) throw new Error(`Expected 3 card steps for ${slug}, found ${cardSteps.length}`);

  const front = {
    title: ld.headline,
    slug,
    status: 'published',
    date: ld.datePublished,
    category: ld.articleSection,
    reading_minutes: Number(must(/<span class="byline-dot"><\/span><span>(\d+) min read<\/span>/, source, `reading time in ${file}`)),
    word_count: ld.wordCount,
    description: ld.description,
    seo_title: must(/<title>([\s\S]*?)<\/title>/, source, `title tag in ${file}`),
    banner_title: must(/<div class="banner-title">([\s\S]*?)<\/div>/, source, `banner title in ${file}`),
    card_art: must(/<div class="card-art ([a-z]+)">/, cardBlock, `card art for ${slug}`),
    card_steps: cardSteps,
    related,
  };
  if (ld.dateModified !== ld.datePublished) front.updated = ld.dateModified;
  if (new RegExp(`<a class="feature-card" href="articles/${slug}\\.html">`).test(indexSource)) front.featured = true;

  return { slug, front, body: htmlBodyToMarkdown(bodyHtml), haystack: must(/data-search="([^"]*)"/, cardBlock, `data-search for ${slug}`) };
}

/**
 * The legacy data-search haystack is title + description + tags joined by
 * spaces. Tags are phrases, so the split points are recovered from the
 * curated launch list below; anything unmatched falls back to single words.
 */
const TAG_SETS = {
  'ai-inbox-triage': ['inbox', 'email', 'triage', 'classification', 'review', 'workflow'],
  'lead-qualification': ['lead qualification', 'CRM', 'sales', 'scoring', 'routing', 'decision support'],
  'content-repurposing': ['content repurposing', 'writing', 'editorial', 'workflow', 'voice', 'social media', 'drafts'],
  'process-audit': ['process audit', 'automation', 'checklist', 'workflow mapping', 'ROI', 'foundations'],
  'meeting-notes-to-actions': ['meeting notes', 'action items', 'minutes', 'tasks', 'project management', 'AI workflow'],
  'support-ticket-routing': ['customer support', 'ticket routing', 'triage', 'escalation', 'help desk', 'AI operations'],
  'weekly-reporting': ['weekly reporting', 'dashboards', 'metrics', 'operations', 'automation', 'analysis', 'AI'],
  'document-intake': ['document intake', 'OCR', 'extraction', 'forms', 'PDFs', 'workflow validation', 'automation'],
  'invoice-processing': ['invoice', 'accounts payable', 'expense processing', 'OCR', 'approval', 'finance', 'automation'],
  'knowledge-base-assistant': ['knowledge base', 'search', 'RAG', 'internal assistant', 'documentation', 'citations', 'AI'],
  'client-onboarding': ['client onboarding', 'customer success', 'checklist', 'reminders', 'handoff automation'],
  'ai-workflow-evals': ['AI workflow evaluation', 'testing', 'quality assurance', 'prompts', 'regression tests', 'automation'],
  'prompt-versioning': ['prompt management', 'version control', 'AI operations', 'documentation', 'maintenance'],
  'calendar-scheduling': ['calendar', 'scheduling', 'meeting booking', 'availability', 'email automation', 'AI guardrails'],
  'follow-up-drafts': ['sales follow up', 'email', 'CRM', 'personalization', 'drafting', 'customer relationship', 'automation'],
};

function tagSetFor(slug, text) {
  const known = TAG_SETS[slug];
  if (known && known.join(' ') === text) return known;
  return text.split(/\s+/);
}

function migratePage(file) {
  const source = read(file);
  const slug = basename(file, '.html');
  const body = must(/<div class="article-content">([\s\S]*?)<\/div><\/div><aside/, source, `body in ${file}`);
  const front = {
    title: must(/<header class="standard-head"><div class="eyebrow">[^<]*<\/div><h1>([\s\S]*?)<\/h1>/, source, `h1 in ${file}`),
    slug,
    status: 'published',
    eyebrow: must(/<div class="eyebrow">([\s\S]*?)<\/div>/, source, `eyebrow in ${file}`),
    intro: must(/<h1>[\s\S]*?<\/h1><p>([\s\S]*?)<\/p><\/header>/, source, `intro in ${file}`),
    description: must(/<meta name="description" content="([^"]*)">/, source, `description in ${file}`),
    seo_title: must(/<title>([\s\S]*?)<\/title>/, source, `title in ${file}`),
  };
  return { slug, front, body: htmlBodyToMarkdown(body), source };
}

/* ------------------------------------------------------------------ *
 * Run
 * ------------------------------------------------------------------ */

const SIDEBAR_LABELS = {
  about: 'About NoCode Blueprint',
  'editorial-policy': 'Editorial policy',
  contact: 'Contact',
  'privacy-policy': 'Privacy policy',
  'cookie-policy': 'Cookie policy',
  terms: 'Terms of use',
  disclaimer: 'Disclaimer',
};
const FOOTER_LABELS = {
  about: 'About',
  'editorial-policy': 'Editorial',
  contact: 'Contact',
  'privacy-policy': 'Privacy',
  'cookie-policy': 'Cookies',
  terms: 'Terms',
  disclaimer: 'Disclaimer',
};
const NAV_LABELS = { about: 'About', 'editorial-policy': 'Editorial' };
const PAGE_ORDER = ['about', 'editorial-policy', 'contact', 'privacy-policy', 'cookie-policy', 'terms', 'disclaimer'];

const HOME_INDEX = read(join(PUBLIC, 'index.html'));

function migrate() {
  const indexSource = read(join(PUBLIC, 'index.html'));
  const posts = readdirSync(join(PUBLIC, 'articles')).filter((f) => f.endsWith('.html')).sort().map((f) => migrateArticle(join(PUBLIC, 'articles', f)));
  const pages = PAGE_ORDER.map((slug) => migratePage(join(PUBLIC, `${slug}.html`)));

  // Archive order comes from the homepage grid, which is the published order.
  const archiveOrder = [...HOME_INDEX.matchAll(/<a href="articles\/([a-z0-9-]+)\.html" aria-label="Read /g)].map((m) => m[1]);
  const uniqueOrder = [...new Set(archiveOrder)].filter((slug) => posts.some((p) => p.slug === slug));
  const dateOrder = [...posts].sort((a, b) => b.front.date.localeCompare(a.front.date)).map((p) => p.slug);

  // Record an explicit archive_position wherever the homepage order differs
  // from plain newest-first ordering.
  const withoutPinned = uniqueOrder.filter((slug) => slug !== 'process-audit');
  if (JSON.stringify(withoutPinned) !== JSON.stringify(dateOrder.filter((s) => s !== 'process-audit'))) {
    throw new Error('Archive order cannot be expressed as date-desc plus one pinned slot');
  }
  const pinnedPosition = uniqueOrder.indexOf('process-audit') + 1;

  for (const post of posts) {
    if (post.slug === 'process-audit') post.front.archive_position = pinnedPosition;
    // Recover tags by diffing the search haystack against title + description.
    const prefix = `${post.front.title} ${post.front.description} `;
    if (!post.haystack.startsWith(prefix)) {
      throw new Error(`data-search for ${post.slug} does not start with title + description`);
    }
    post.front.tags = tagSetFor(post.slug, post.haystack.slice(prefix.length));

    // Emit frontmatter keys in a stable, readable order.
    const ordered = {};
    const keyOrder = ['title', 'slug', 'status', 'date', 'updated', 'category', 'reading_minutes',
      'word_count', 'description', 'seo_title', 'tags', 'banner_title', 'card_art', 'card_steps',
      'featured', 'archive_position', 'related'];
    for (const key of keyOrder) {
      if (post.front[key] !== undefined) ordered[key] = post.front[key];
    }
    post.front = ordered;
  }

  for (const [index, page] of pages.entries()) {
    const ordered = {
      title: page.front.title,
      slug: page.front.slug,
      status: 'published',
      order: index + 1,
      updated: new RegExp(`<loc>${BASE_URL}/${page.slug}\\.html</loc><lastmod>([0-9-]+)</lastmod>`).exec(read(join(PUBLIC, 'sitemap.xml')))[1],
      eyebrow: page.front.eyebrow,
      intro: page.front.intro,
      description: page.front.description,
      seo_title: page.front.seo_title,
      in_nav: Boolean(NAV_LABELS[page.slug]),
    };
    if (NAV_LABELS[page.slug]) ordered.nav_label = NAV_LABELS[page.slug];
    ordered.footer_label = FOOTER_LABELS[page.slug];
    ordered.sidebar_label = SIDEBAR_LABELS[page.slug];
    page.front = ordered;
  }

  const site = {
    name: SITE_NAME,
    brandMark: 'N',
    tagline: 'AI automation, made useful',
    themeColor: '#f6f5f0',
    baseUrl: BASE_URL,
    description: must(/<meta name="description" content="([^"]*)">/, indexSource, 'index description'),
    shareDescription: must(/<meta property="og:description" content="([^"]*)">/, indexSource, 'index og description'),
    schemaDescription: JSON.parse(must(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, indexSource, 'index JSON-LD')).description,
    homeTitle: must(/<title>([\s\S]*?)<\/title>/, indexSource, 'index title'),
    homeUpdated: new RegExp(`<loc>${BASE_URL}/</loc><lastmod>([0-9-]+)</lastmod>`).exec(read(join(PUBLIC, 'sitemap.xml')))[1],
    authorName: SITE_NAME,
    aboutPage: 'about',
    contactEmail: 'hello@nocodeblueprint.com',
    ctaSlug: 'contact',
    ctaLabel: 'Contact',
    footerCopy: must(/<div class="footer-copy">([\s\S]*?) © <span id="year">/, indexSource, 'footer copy'),
    copyrightYear: Number(must(/<span id="year">(\d+)<\/span>/, indexSource, 'copyright year')),
    toplineLeft: must(/<div class="topline">([\s\S]*?) <span>✳<\/span>/, indexSource, 'topline left'),
    toplineRight: must(/<span>✳<\/span> ([\s\S]*?)<\/div>/, indexSource, 'topline right'),
    bannerKicker: must(/<div class="banner-kicker">([\s\S]*?)<\/div>/, read(join(PUBLIC, 'articles', `${posts[0].slug}.html`)), 'banner kicker'),
    backLinkLabel: 'Back to all articles',
    articleEndNote: must(/<span aria-hidden="true">←<\/span> Back to all articles<\/a><span>([\s\S]*?)<\/span>/, read(join(PUBLIC, 'articles', `${posts[0].slug}.html`)), 'article end note'),
    relatedHeading: must(/<aside class="related"><h2>([\s\S]*?)<\/h2>/, read(join(PUBLIC, 'articles', `${posts[0].slug}.html`)), 'related heading'),
    sidebarTitle: must(/<aside class="standard-sidebar"><strong>([\s\S]*?)<\/strong>/, read(join(PUBLIC, 'about.html')), 'sidebar title'),
    feedTitle: must(/<title>([\s\S]*?)<\/title>/, read(join(PUBLIC, 'feed.xml')), 'feed title'),
    feedDescription: must(/<description>([\s\S]*?)<\/description>/, read(join(PUBLIC, 'feed.xml')), 'feed description'),
    feedLanguage: must(/<language>([\s\S]*?)<\/language>/, read(join(PUBLIC, 'feed.xml')), 'feed language'),
    categories: [
      { name: 'Workflow', button: 'Workflows' },
      { name: 'Operations', button: 'Operations' },
      { name: 'Content', button: 'Content' },
      { name: 'Foundations', button: 'Foundations' },
    ],
  };

  mkdirSync(join(OUT, 'content', 'posts'), { recursive: true });
  mkdirSync(join(OUT, 'content', 'pages'), { recursive: true });
  mkdirSync(join(OUT, 'config'), { recursive: true });

  for (const post of posts) {
    writeFileSync(join(OUT, 'content', 'posts', `${post.slug}.md`), formatFrontmatter(post.front, post.body));
  }
  for (const page of pages) {
    writeFileSync(join(OUT, 'content', 'pages', `${page.slug}.md`), formatFrontmatter(page.front, page.body));
  }
  writeFileSync(join(OUT, 'config', 'site.yml'), yamlStringify(site));

  console.log(`migrated ${posts.length} posts and ${pages.length} pages into ${OUT}`);
}

if (!existsSync(PUBLIC)) {
  console.error(`Cannot find ${PUBLIC}`);
  process.exit(1);
}
migrate();
