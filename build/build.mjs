/**
 * Build: content/ + config/site.yml -> public/
 *
 * Deterministic, offline and secret-free. Running it twice produces identical
 * bytes, and the generated files are committed so the site still deploys even
 * when no build command is configured on Cloudflare.
 *
 * Generated into public/
 *   index.html              homepage (metadata, featured card, filters, grid)
 *   articles/<slug>.html    one per published post
 *   <slug>.html             one per published page
 *   sitemap.xml, feed.xml, robots.txt
 *
 * Left untouched (hand-maintained, part of the design)
 *   assets/site.css, assets/site.js, 404.html, _headers, ads.txt, media/
 */

import { mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { loadContent } from './lib/content.mjs';
import {
  renderArticle, renderPage, renderIndex, renderSitemap, renderFeed, renderRobots, resolveRelated,
} from './lib/templates.mjs';

export const GENERATED_ROOT_FILES = ['index.html', 'sitemap.xml', 'feed.xml', 'robots.txt'];

/** Build every generated file in memory. Returns a Map of repo-relative path -> content. */
export function buildOutputs(rootDir = '.') {
  const root = resolve(rootDir);
  const content = loadContent(root);
  const { site, pages, archive, feed, featuredPost, bySlug, posts, warnings } = content;
  const publishedPages = pages.filter((page) => !page.draft);
  const outputs = new Map();

  outputs.set('public/index.html', renderIndex(site, publishedPages, archive, featuredPost));

  for (const post of archive) {
    const related = resolveRelated(bySlug, post);
    outputs.set(`public/articles/${post.slug}.html`, renderArticle(site, publishedPages, post, related));
  }

  for (const page of publishedPages) {
    outputs.set(`public/${page.slug}.html`, renderPage(site, publishedPages, page));
  }

  outputs.set('public/sitemap.xml', renderSitemap(site, publishedPages, archive));
  outputs.set('public/feed.xml', renderFeed(site, feed));
  outputs.set('public/robots.txt', renderRobots(site));

  return {
    outputs,
    summary: {
      posts: archive.length,
      drafts: posts.filter((post) => post.draft).length,
      pages: publishedPages.length,
      featured: featuredPost.slug,
      baseUrl: site.baseUrl,
      warnings,
    },
  };
}

/** Article files that must be removed because their post is gone or is a draft. */
function staleArticleFiles(root, outputs) {
  const dir = join(root, 'public', 'articles');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.html'))
    .filter((name) => !outputs.has(`public/articles/${name}`))
    .map((name) => `public/articles/${name}`);
}

/**
 * Write the build into public/. Pass `write: false` to compute the plan only.
 */
export function writeOutputs(rootDir = '.', { write = true } = {}) {
  const root = resolve(rootDir);
  const { outputs, summary } = buildOutputs(root);
  const changed = [];
  const created = [];
  const unchanged = [];

  for (const [path, content] of [...outputs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const absolute = join(root, path);
    let before = null;
    if (existsSync(absolute)) before = readFileSync(absolute, 'utf8');
    if (before === content) {
      unchanged.push(path);
      continue;
    }
    (before === null ? created : changed).push(path);
    if (write) {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, content, 'utf8');
    }
  }

  const removed = staleArticleFiles(root, outputs);
  if (write) {
    for (const path of removed) rmSync(join(root, path));
  }

  return { outputs, summary, changed, created, unchanged, removed, warnings: summary.warnings };
}

function main() {
  const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
  const result = writeOutputs(root);
  const { summary, changed, created, removed, unchanged, warnings } = result;

  console.log(`NoCode Blueprint build`);
  console.log(`  base URL      ${summary.baseUrl}`);
  console.log(`  posts         ${summary.posts} published, ${summary.drafts} draft`);
  console.log(`  pages         ${summary.pages}`);
  console.log(`  featured      ${summary.featured}`);
  console.log(`  files         ${created.length} created, ${changed.length} updated, ${unchanged.length} unchanged, ${removed.length} removed`);
  for (const path of created) console.log(`    + ${path}`);
  for (const path of changed) console.log(`    ~ ${path}`);
  for (const path of removed) console.log(`    - ${path}`);
  if (created.length + changed.length + removed.length === 0) {
    console.log('  public/ is already in sync with content/');
  }
  if (warnings.length > 0) {
    console.log(`  warnings      ${warnings.length}`);
    for (const warning of warnings) console.log(`    ! ${warning}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  try {
    main();
  } catch (error) {
    console.error(`\nBuild failed: ${error.message}\n`);
    if (error.file) console.error(`  in ${relative(process.cwd(), error.file)}\n`);
    if (process.env.BUILD_DEBUG) console.error(error.stack);
    process.exit(1);
  }
}
