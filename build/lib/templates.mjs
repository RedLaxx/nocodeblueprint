/**
 * Layout templates.
 *
 * This module owns the site's HTML skeleton. It reproduces the launch markup
 * exactly so the CMS migration cannot change the visual design: all styling
 * still comes from public/assets/site.css and all behaviour from
 * public/assets/site.js, neither of which the build touches.
 *
 * Only three things vary per page:
 *   1. metadata (title, description, canonical, Open Graph, JSON-LD)
 *   2. content rendered from content/posts/*.md and content/pages/*.md
 *   3. the derived article grid, featured card, filters, sitemap and feed
 */

import { escapeAttribute as esc, escapeText } from './markdown.mjs';
import { absoluteUrl, formatRfc822 } from './content.mjs';
import { serializeJson } from './json.mjs';

/* ------------------------------------------------------------------ *
 * Shared chrome
 * ------------------------------------------------------------------ */

function topline(site) {
  return `<div class="topline">${esc(site.toplineLeft)} <span>✳</span> ${esc(site.toplineRight)}</div>`;
}

function brand(site, href, withAriaLabel) {
  const aria = withAriaLabel ? ` aria-label="${esc(site.name)} home"` : '';
  return `<a class="brand" href="${href}"${aria}><span class="brand-mark">${esc(site.brandMark)}</span>`
    + `<span class="brand-name">${esc(site.name)}<small>${esc(site.tagline)}</small></span></a>`;
}

function navLinks(links) {
  return links.map((link) => {
    const current = link.ariaCurrent ? ' aria-current="page"' : '';
    return `<a href="${link.href}"${current}>${esc(link.label)}</a>`;
  }).join('');
}

/**
 * @param {object} site
 * @param {object} ctx  { prefix, homeHref, currentPage }
 *   prefix     "" for root-level pages, "../" for articles
 *   homeHref   how the Blog/Method anchors are written from this page
 */
function siteHeader(site, pages, ctx) {
  const nav = [
    { href: `${ctx.homeHref}#latest`, label: 'Blog', ariaCurrent: ctx.currentPage === 'home' },
    { href: `${ctx.homeHref}#method`, label: 'Method' },
    ...pages.filter((page) => page.inNav).map((page) => ({
      href: `${ctx.prefix}${page.slug}.html`,
      label: page.navLabel,
    })),
  ];
  return `<header class="site-header"><div class="wrap header-inner">`
    + `${brand(site, ctx.prefix === '' ? './' : ctx.prefix, true)}`
    + `<nav class="nav-links" aria-label="Main navigation">${navLinks(nav)}</nav>`
    + `<a class="nav-cta" href="${ctx.prefix}${site.ctaSlug}.html">${esc(site.ctaLabel)} <span aria-hidden="true">↗</span></a>`
    + `</div></header>`;
}

function siteFooter(site, pages, ctx) {
  const links = [
    { href: `${ctx.homeHref}#latest`, label: 'Blog' },
    ...pages.map((page) => ({ href: `${ctx.prefix}${page.slug}.html`, label: page.footerLabel })),
  ];
  return `<footer class="site-footer"><div class="wrap footer-inner">`
    + `${brand(site, ctx.prefix === '' ? './' : ctx.prefix, false)}`
    + `<div class="footer-copy">${esc(site.footerCopy)} © <span id="year">${site.copyrightYear}</span> ${esc(site.name)}.</div>`
    + `<nav class="footer-links" aria-label="Footer navigation">${navLinks(links)}</nav>`
    + `</div></footer>`;
}

function sidebar(pages, sidebarTitle, prefix) {
  return `<aside class="standard-sidebar"><strong>${esc(sidebarTitle)}</strong>`
    + pages.map((page) => `<a href="${prefix}${page.slug}.html">${esc(page.sidebarLabel)}</a>`).join('')
    + `</aside>`;
}

/* ------------------------------------------------------------------ *
 * Articles
 * ------------------------------------------------------------------ */

function articleJsonLd(site, post) {
  return serializeJson({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.seoDescription,
    datePublished: post.date,
    dateModified: post.updated,
    author: {
      '@type': 'Organization',
      name: site.authorName,
      url: absoluteUrl(site, `/${site.aboutPage}.html`),
    },
    publisher: { '@type': 'Organization', name: site.name, url: `${site.baseUrl}/` },
    mainEntityOfPage: { '@type': 'WebPage', '@id': absoluteUrl(site, post.url) },
    articleSection: post.category,
    wordCount: post.wordCount,
  });
}

export function renderArticle(site, pages, post, relatedPosts) {
  const canonical = absoluteUrl(site, post.url);
  const ctx = { prefix: '../', homeHref: '../', currentPage: null };
  const related = relatedPosts
    .map((entry) => `<a href="${entry.slug}.html">${esc(entry.label)}</a>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="${esc(site.themeColor)}">
  <meta name="description" content="${esc(post.seoDescription)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:title" content="${esc(post.ogTitle)}">
  <meta property="og:description" content="${esc(post.seoDescription)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta name="twitter:card" content="summary">
  <title>${esc(post.seoTitle)}</title>
  <link rel="stylesheet" href="../assets/site.css">
  <link rel="alternate" type="application/rss+xml" title="${esc(site.name)} feed" href="../feed.xml">
  <script type="application/ld+json">${articleJsonLd(site, post)}</script>
</head>
<body>
<a class="skip-link" href="#article">Skip to article</a>
${topline(site)}
${siteHeader(site, pages, ctx)}
<main class="wrap article-shell" id="article">
  <div class="crumbs"><a href="../">Home</a> &nbsp;/&nbsp; <a href="../#latest">Articles</a> &nbsp;/&nbsp; ${esc(post.category)}</div>
  <header class="article-head"><span class="tag">${esc(post.category)}</span><h1>${esc(post.title)}</h1><p class="article-dek">${esc(post.description)}</p><div class="article-byline"><span>${esc(site.authorName)}</span><span class="byline-dot"></span><time datetime="${esc(post.date)}">${esc(post.dateLong)}</time><span class="byline-dot"></span><span>${esc(post.readingLabel)}</span></div></header>
  <div class="article-banner" role="img" aria-label="${esc(post.bannerTitle)}"><div class="banner-inner"><div class="banner-kicker">${esc(site.bannerKicker)}</div><div class="banner-title">${esc(post.bannerTitle)}</div></div></div>
  <article class="article-content">
${post.bodyHtml}<div class="article-end"><a class="back-link" href="../#latest"><span aria-hidden="true">←</span> ${esc(site.backLinkLabel)}</a><span>${esc(site.articleEndNote)}</span></div></article>
  <aside class="related"><h2>${esc(site.relatedHeading)}</h2><div class="related-links">${related}</div></aside>
</main>
${siteFooter(site, pages, ctx)}
<script src="../assets/site.js" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * Standard pages (About, Editorial, Contact, legal)
 * ------------------------------------------------------------------ */

export function renderPage(site, pages, page) {
  const canonical = absoluteUrl(site, page.url);
  const ctx = { prefix: '', homeHref: 'index.html', currentPage: null };

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="${esc(site.themeColor)}">
  <meta name="description" content="${esc(page.seoDescription)}"><meta name="robots" content="index,follow"><link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="website"><meta property="og:site_name" content="${esc(site.name)}"><meta property="og:title" content="${esc(page.ogTitle)}"><meta property="og:description" content="${esc(page.seoDescription)}"><meta property="og:url" content="${esc(canonical)}"><meta name="twitter:card" content="summary">
  <title>${esc(page.seoTitle)}</title><link rel="stylesheet" href="assets/site.css">
</head>
<body><a class="skip-link" href="#main">Skip to content</a>${topline(site)}
${siteHeader(site, pages, ctx)}
<main class="wrap standard-page" id="main"><div class="standard-layout"><div><header class="standard-head"><div class="eyebrow">${esc(page.eyebrow)}</div><h1>${esc(page.title)}</h1><p>${esc(page.intro)}</p></header><div class="article-content">${page.bodyHtml}</div></div>${sidebar(pages, page.sidebarTitle, '')}</div></main>
${siteFooter(site, pages, ctx)}<script src="assets/site.js" defer></script></body></html>`;
}

/* ------------------------------------------------------------------ *
 * Homepage
 * ------------------------------------------------------------------ */

function articleCard(post, site) {
  const haystack = [post.title, post.description, ...post.tags].join(' ');
  const rows = post.cardSteps.map((step) => `<div class="art-row"><i class="art-dot"></i>${esc(step)}</div>`).join('');
  return `<article class="article-card" data-category="${esc(post.categoryKey)}" data-search="${esc(haystack)}">
  <a href="articles/${post.slug}.html" aria-label="Read ${esc(post.title)}">
    <div class="card-art ${esc(post.cardArt)}"><span class="mini-label">${esc(post.category)} / field note</span><div class="art-stack">${rows}</div><span class="art-arrow">READ THE BLUEPRINT ↗</span></div>
    <div class="card-meta"><span class="tag">${esc(post.category)}</span><span>${esc(post.readingLabel)}</span></div><h3 class="card-title">${esc(post.title)}</h3><p class="card-desc">${esc(post.description)}</p><div class="card-link"><span>Read the article</span><span aria-hidden="true">↗</span></div>
  </a>
</article>`;
}

function featureCard(post, site) {
  const steps = post.cardSteps.map((step) => `<div class="feature-step"><i></i>${esc(step)}</div>`).join('');
  return `      <a class="feature-card" href="articles/${post.slug}.html">
        <div class="feature-visual"><span class="visual-label">Featured field note / ${esc(post.category)}</span><div class="feature-diagram">${steps}</div></div>
        <div class="feature-copy"><span class="tag">${esc(post.category)}</span><h3>${esc(post.title)}</h3><p>${esc(post.description)}</p><div class="feature-meta">${esc(post.dateLong)} · ${esc(post.readingLabel)} <span aria-hidden="true">↗</span></div></div>
      </a>`;
}

/**
 * Homepage editorial copy that is part of the design rather than CMS content:
 * the hero, the trust row and the "start here" section head. Kept literal so a
 * content edit can never reflow the landing page. Everything below is still
 * generated: metadata, featured card, category filters, archive counts and the
 * article grid.
 */
const HOME_HERO = `  <section class="wrap home-hero" aria-labelledby="hero-title">
    <div class="hero-copy-wrap">
      <div class="eyebrow">The practical AI automation journal</div>
      <h1 id="hero-title">Make room for <em>better work.</em></h1>
      <p class="hero-copy">Turn repetitive work into reliable workflows—with clear, no-hype guides you can build, test, and improve one step at a time.</p>
      <div class="hero-actions"><a class="button" href="#latest">Browse the articles <span aria-hidden="true">↓</span></a><a class="button button-light" href="#method">See the method</a></div>
      <div class="hero-note"><span>Framework-agnostic</span><span class="dot"></span><span>Human in the loop</span><span class="dot"></span><span>Built for real work</span></div>
    </div>
    <div class="hero-art" aria-label="Illustration of an automation workflow: capture, AI assist, then human review">
      <div class="art-grid"></div><div class="art-head"><span>Workflow blueprint / 001</span><span class="live-pill">Ready to map</span></div>
      <div class="flow-stack"><div class="flow-card"><span class="flow-icon" aria-hidden="true">↘</span><div><span class="flow-label">01 · Capture</span><strong>A new request arrives</strong></div><span class="flow-number">INPUT</span></div><div class="flow-arrow" aria-hidden="true">↓</div><div class="flow-card"><span class="flow-icon" aria-hidden="true">✳</span><div><span class="flow-label">02 · AI assist</span><strong>Sort, summarize, suggest</strong></div><span class="flow-number">DRAFT</span></div><div class="flow-arrow" aria-hidden="true">↓</div><div class="flow-card"><span class="flow-icon" aria-hidden="true">✓</span><div><span class="flow-label">03 · Human check</span><strong>Review, then route</strong></div><span class="flow-number">ACTION</span></div></div>
      <div class="art-foot"><span>Useful automation</span><b>≠ autopilot</b></div><div class="float-stamp"><strong>Start small.</strong><span>Make it dependable.</span></div>
    </div>
  </section>
  <div class="wrap trust-row" aria-label="Editorial principles"><span class="trust-item"><i></i><strong>Clear steps</strong></span><span class="trust-item"><i></i>Honest tool picks</span><span class="trust-item"><i></i>Human review by design</span><span class="trust-item"><i></i>No magic-button promises</span></div>

  <section class="wrap section" id="featured" aria-labelledby="featured-title">
    <div class="section-head"><div><div class="section-kicker">Start here</div><h2 id="featured-title">A small workflow.<br>A real first win.</h2></div><p class="section-intro">The best place to begin is a repetitive task with a clear outcome, a safe review step, and a person who owns the result.</p></div>`;

const HOME_TAIL = `  <section class="method" id="method" aria-labelledby="method-title"><div class="wrap"><div class="section-kicker">The NoCode Blueprint method</div><div class="section-head"><h2 id="method-title">Good automation starts<br>before the tool.</h2><p class="method-intro">The best workflow is not the one with the most AI. It is the one that removes friction while keeping the right person in control.</p></div><div class="steps"><div class="step"><span class="step-no">01 / SPOT</span><h3>Find the repeat</h3><p>Choose a task that happens often and has a clear, observable outcome.</p></div><div class="step"><span class="step-no">02 / MAP</span><h3>Make it visible</h3><p>Write down the inputs, decisions, handoffs, exceptions, and owner.</p></div><div class="step"><span class="step-no">03 / BUILD</span><h3>Start with a draft</h3><p>Automate the predictable parts. Let AI assist where language or context helps.</p></div><div class="step"><span class="step-no">04 / REVIEW</span><h3>Keep improving</h3><p>Measure the result, watch for edge cases, and keep a human review path.</p></div></div></div></section>

  <section class="wrap about-section" id="about"><div class="about-mark"><p>Less busywork.<br>More room to think.</p></div><div class="about-copy"><div class="section-kicker">About this blueprint</div><h2>Useful systems.<br>Human judgment.</h2><p>NoCode Blueprint is an independent field guide to practical AI automation. We focus on clear workflows, thoughtful tool choices, and the checks that make automation dependable—not on replacing people or promising one-click transformation.</p><p>New here? Start with the process audit, then pick one small workflow to improve.</p><a class="button" href="about.html">Read about the project <span aria-hidden="true">↗</span></a></div></section>
`;

export function renderIndex(site, pages, archive, featuredPost) {
  const ctx = { prefix: '', homeHref: '', currentPage: 'home' };
  const canonical = `${site.baseUrl}/`;
  const websiteJsonLd = serializeJson({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: site.name,
    url: canonical,
    description: site.schemaDescription,
    publisher: {
      '@type': 'Organization',
      name: site.name,
      url: absoluteUrl(site, `/${site.aboutPage}.html`),
    },
  });

  const count = archive.length;
  const filters = ['<button class="filter-btn" type="button" data-filter="all" aria-pressed="true">All articles</button>']
    .concat(site.categories.map((category) => `<button class="filter-btn" type="button" data-filter="${esc(category.name.toLowerCase())}" aria-pressed="false">${esc(category.button)}</button>`))
    .join('');
  const cards = archive.map((post) => articleCard(post, site)).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="${esc(site.themeColor)}">
  <meta name="description" content="${esc(site.description)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${esc(canonical)}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(site.name)}">
  <meta property="og:title" content="${esc(site.homeTitle)}">
  <meta property="og:description" content="${esc(site.shareDescription)}">
  <meta property="og:url" content="${esc(canonical)}">
  <meta name="twitter:card" content="summary">
  <title>${esc(site.homeTitle)}</title>
  <link rel="stylesheet" href="assets/site.css">
  <link rel="alternate" type="application/rss+xml" title="${esc(site.name)} feed" href="feed.xml">
  <script type="application/ld+json">${websiteJsonLd}</script>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${topline(site)}
${siteHeader(site, pages, ctx)}
<main id="main">
${HOME_HERO}
    <div class="featured-layout">
${featureCard(featuredPost, site)}
      <aside class="editor-note"><div class="section-kicker">The editorial rule</div><h3>AI can accelerate the middle. People own the edges.</h3><p>Every blueprint here separates predictable rules from language-heavy assistance—and keeps consequential decisions visible, reviewable, and reversible.</p><a class="button" href="editorial-policy.html">How we publish <span aria-hidden="true">↗</span></a></aside>
    </div>
  </section>

  <section class="wrap section" id="latest" aria-labelledby="latest-title">
    <div class="section-head"><div><div class="section-kicker">The archive / ${count} field notes</div><h2 id="latest-title">The good stuff, in steps.</h2></div><p class="section-intro">Practical blueprints for the work behind the work. Pick one repetitive task, then make it a little easier.</p></div>
    <div class="toolbar"><div class="filter-list" role="group" aria-label="Filter articles by category">${filters}</div><label class="search-wrap"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" stroke="currentColor" stroke-width="1.7"/><path d="m16 16 5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg><input id="article-search" type="search" placeholder="Find an article…" aria-label="Search articles"></label></div>
    <p id="results-status" class="section-kicker results-status" aria-live="polite">${count} practical field notes</p>
    <div class="article-grid" id="article-grid">${cards}<div class="empty-state" id="empty-state" hidden>No articles match that search. Try a different phrase or category.</div></div>
  </section>

${HOME_TAIL}</main>
${siteFooter(site, pages, ctx)}
<script src="assets/site.js" defer></script>
</body>
</html>
`;
}

/* ------------------------------------------------------------------ *
 * Sitemap and feed
 * ------------------------------------------------------------------ */

function sitemapEntry(url, lastmod, changefreq, priority) {
  return `  <url><loc>${esc(url)}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

export function renderSitemap(site, pages, archive) {
  const homeLastmod = [site.homeUpdated, ...archive.map((post) => post.updated)].sort().pop();
  const entries = [
    sitemapEntry(`${site.baseUrl}/`, homeLastmod, 'weekly', '1.0'),
    ...pages.map((page) => sitemapEntry(absoluteUrl(site, page.url), page.lastmod, 'monthly', '0.7')),
    ...archive.map((post) => sitemapEntry(absoluteUrl(site, post.url), post.lastmod, 'monthly', '0.7')),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

export function renderFeed(site, feedPosts) {
  const lastBuild = feedPosts.length > 0 ? feedPosts[0].date : site.homeUpdated;
  const items = feedPosts.map((post) => {
    const url = absoluteUrl(site, post.url);
    return `<item><title>${esc(post.title)}</title>
<link>${esc(url)}</link>
<guid isPermaLink="true">${esc(url)}</guid>
<pubDate>${formatRfc822(post.date)}</pubDate>
<description>${esc(post.description)}</description></item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${esc(site.feedTitle)}</title>
<link>${esc(`${site.baseUrl}/`)}</link>
<description>${esc(site.feedDescription)}</description>
<language>${esc(site.feedLanguage)}</language>
<lastBuildDate>${formatRfc822(lastBuild)}</lastBuildDate>
${items.join('\n')}
</channel></rss>
`;
}

export function renderRobots(site) {
  return `User-agent: *
Allow: /
Sitemap: ${absoluteUrl(site, '/sitemap.xml')}
`;
}

/* ------------------------------------------------------------------ *
 * Related links
 * ------------------------------------------------------------------ */

/**
 * Related link labels shorten a title at its first colon or em dash, which is
 * the convention the launch content already uses ("Prompt versioning: the
 * small habit..." shows as "Prompt versioning").
 */
export function shortTitle(title) {
  const cut = title.split(/(?::|—)/)[0].trim();
  return cut === '' ? title : cut;
}

export function resolveRelated(bySlug, post) {
  return post.relatedSlugs.map((slug) => {
    const target = bySlug.get(slug);
    return { slug, label: shortTitle(target.title) };
  });
}

export { escapeText };
