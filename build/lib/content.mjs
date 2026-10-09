/**
 * Loads, normalises and validates every piece of CMS-managed content.
 *
 * Sources
 *   config/site.yml     site-wide identity, canonical base URL, navigation labels
 *   content/posts/*.md  articles (Pages CMS "Posts" collection)
 *   content/pages/*.md  About / Editorial / Contact / legal pages ("Pages" collection)
 *
 * Nothing here touches the network or reads environment variables, so a build
 * is reproducible and needs no secrets.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { parse as parseYaml, splitFrontmatter } from './yaml.mjs';
import { renderMarkdown, countWords } from './markdown.mjs';

export class ContentError extends Error {
  constructor(message, file) {
    super(file ? `${file}: ${message}` : message);
    this.name = 'ContentError';
    this.file = file;
  }
}

export const CARD_ART = ['mail', 'lead', 'content', 'audit', 'system', 'ops'];
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export class BuildError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BuildError';
  }
}

function partsOf(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** "2026-10-08" -> "October 8, 2026" */
export function formatLongDate(iso) {
  const { year, month, day } = partsOf(iso);
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** "2026-10-08" -> "Thu, 08 Oct 2026 00:00:00 +0000" (RFC 822, UTC) */
export function formatRfc822(iso) {
  const { year, month, day } = partsOf(iso);
  const weekday = DAYS_SHORT[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  const pad = (n) => String(n).padStart(2, '0');
  return `${weekday}, ${pad(day)} ${MONTHS_SHORT[month - 1]} ${year} 00:00:00 +0000`;
}

function requireString(value, field, file) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ContentError(`"${field}" is required and must be a non-empty string`, file);
  }
  return value;
}

function optionalString(value, field, file, fallback = '') {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') {
    throw new ContentError(`"${field}" must be a string`, file);
  }
  return value;
}

function requireDate(value, field, file) {
  const text = requireString(value, field, file);
  if (!DATE_PATTERN.test(text)) {
    throw new ContentError(`"${field}" must be an ISO date such as 2026-10-08, got "${text}"`, file);
  }
  return text;
}

function optionalDate(value, field, file) {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value);
  if (!DATE_PATTERN.test(text)) {
    throw new ContentError(`"${field}" must be an ISO date such as 2026-10-08, got "${text}"`, file);
  }
  return text;
}

function listOfStrings(value, field, file) {
  if (value === undefined || value === null || value === '') return [];
  if (!Array.isArray(value)) {
    throw new ContentError(`"${field}" must be a list`, file);
  }
  return value.map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      throw new ContentError(`"${field}[${index}]" must be a non-empty string`, file);
    }
    return entry;
  });
}

function optionalNumber(value, field, file) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ContentError(`"${field}" must be a number`, file);
  }
  return value;
}

function readMarkdownFile(path) {
  const raw = readFileSync(path, 'utf8');
  try {
    return splitFrontmatter(raw);
  } catch (error) {
    throw new ContentError(error.message, path);
  }
}

function listDirectory(dir, extension) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => entry.name)
    .sort();
}

/* ------------------------------------------------------------------ *
 * Site configuration
 * ------------------------------------------------------------------ */

export function loadSite(rootDir) {
  const file = join(rootDir, 'config', 'site.yml');
  if (!existsSync(file)) throw new BuildError(`Missing site configuration: ${file}`);

  let data;
  try {
    data = parseYaml(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ContentError(error.message, file);
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ContentError('expected a mapping of site settings', file);
  }

  const baseUrl = requireString(data.baseUrl, 'baseUrl', file).replace(/\/+$/, '');
  if (!/^https:\/\/[^\s/]+/.test(baseUrl)) {
    throw new ContentError(`"baseUrl" must be an absolute https URL without a trailing slash, got "${baseUrl}"`, file);
  }

  const categories = Array.isArray(data.categories) ? data.categories : [];
  const normalisedCategories = categories.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new ContentError(`categories[${index}] must be a mapping with "name"`, file);
    }
    const name = requireString(entry.name, `categories[${index}].name`, file);
    return { name, button: optionalString(entry.button, `categories[${index}].button`, file, name) };
  });

  const site = {
    file,
    name: requireString(data.name, 'name', file),
    brandMark: optionalString(data.brandMark, 'brandMark', file, requireString(data.name, 'name', file).charAt(0)),
    tagline: requireString(data.tagline, 'tagline', file),
    themeColor: optionalString(data.themeColor, 'themeColor', file, '#f6f5f0'),
    baseUrl,
    description: requireString(data.description, 'description', file),
    shareDescription: optionalString(data.shareDescription, 'shareDescription', file, requireString(data.description, 'description', file)),
    schemaDescription: optionalString(data.schemaDescription, 'schemaDescription', file, requireString(data.description, 'description', file)),
    homeTitle: requireString(data.homeTitle, 'homeTitle', file),
    homeUpdated: requireDate(data.homeUpdated, 'homeUpdated', file),
    authorName: optionalString(data.authorName, 'authorName', file, requireString(data.name, 'name', file)),
    aboutPage: optionalString(data.aboutPage, 'aboutPage', file, 'about'),
    contactEmail: requireString(data.contactEmail, 'contactEmail', file),
    ctaSlug: optionalString(data.ctaSlug, 'ctaSlug', file, 'contact'),
    ctaLabel: optionalString(data.ctaLabel, 'ctaLabel', file, 'Contact'),
    footerCopy: requireString(data.footerCopy, 'footerCopy', file),
    copyrightYear: (() => {
      const value = optionalNumber(data.copyrightYear, 'copyrightYear', file);
      if (value === null) throw new ContentError('"copyrightYear" is required', file);
      if (!Number.isInteger(value) || value < 2000 || value > 2999) {
        throw new ContentError(`"copyrightYear" must be a four-digit year (got "${value}")`, file);
      }
      return value;
    })(),
    toplineLeft: requireString(data.toplineLeft, 'toplineLeft', file),
    toplineRight: requireString(data.toplineRight, 'toplineRight', file),
    bannerKicker: requireString(data.bannerKicker, 'bannerKicker', file),
    backLinkLabel: optionalString(data.backLinkLabel, 'backLinkLabel', file, 'Back to all articles'),
    articleEndNote: requireString(data.articleEndNote, 'articleEndNote', file),
    relatedHeading: optionalString(data.relatedHeading, 'relatedHeading', file, 'Keep building'),
    feedTitle: optionalString(data.feedTitle, 'feedTitle', file, requireString(data.homeTitle, 'homeTitle', file)),
    feedDescription: optionalString(data.feedDescription, 'feedDescription', file, optionalString(data.shareDescription, 'shareDescription', file)),
    feedLanguage: optionalString(data.feedLanguage, 'feedLanguage', file, 'en-us'),
    categories: normalisedCategories,
  };

  site.categoryButton = (name) => {
    const found = site.categories.find((entry) => entry.name.toLowerCase() === String(name).toLowerCase());
    return found ? found.button : String(name);
  };
  return site;
}

/* ------------------------------------------------------------------ *
 * Posts
 * ------------------------------------------------------------------ */

function loadPost(rootDir, filename, site) {
  const file = join(rootDir, 'content', 'posts', filename);
  const slugFromFile = basename(filename, '.md');
  const { data, body } = readMarkdownFile(file);

  const slug = optionalString(data.slug, 'slug', file, slugFromFile);
  if (!SLUG_PATTERN.test(slug)) {
    throw new ContentError(`"slug" must be lowercase letters, numbers and dashes (got "${slug}")`, file);
  }
  if (slug !== slugFromFile) {
    throw new ContentError(
      `"slug" is "${slug}" but the file is named "${slugFromFile}.md". `
      + 'The filename decides the public URL, so the two must match.',
      file,
    );
  }

  const title = requireString(data.title, 'title', file);
  const status = optionalString(data.status, 'status', file, 'published');
  if (!['published', 'draft'].includes(status)) {
    throw new ContentError(`"status" must be "published" or "draft" (got "${status}")`, file);
  }

  const date = requireDate(data.date, 'date', file);
  const updated = optionalDate(data.updated, 'updated', file) || date;
  if (updated < date) {
    throw new ContentError(`"updated" (${updated}) is earlier than "date" (${date})`, file);
  }

  const category = requireString(data.category, 'category', file);
  const description = requireString(data.description, 'description', file);
  const readingMinutes = optionalNumber(data.reading_minutes, 'reading_minutes', file);
  if (readingMinutes !== null && (!Number.isInteger(readingMinutes) || readingMinutes < 1)) {
    throw new ContentError('"reading_minutes" must be a whole number of minutes (1 or more)', file);
  }

  const cardSteps = listOfStrings(data.card_steps, 'card_steps', file);
  if (status === 'published' && cardSteps.length !== 3) {
    throw new ContentError(`"card_steps" must contain exactly 3 short steps (found ${cardSteps.length})`, file);
  }

  const cardArt = optionalString(data.card_art, 'card_art', file, 'system');
  if (!CARD_ART.includes(cardArt)) {
    throw new ContentError(`"card_art" must be one of ${CARD_ART.join(', ')} (got "${cardArt}")`, file);
  }

  const archivePosition = optionalNumber(data.archive_position, 'archive_position', file);
  if (archivePosition !== null && (!Number.isInteger(archivePosition) || archivePosition < 1)) {
    throw new ContentError('"archive_position" must be a whole number (1 or more)', file);
  }

  let html;
  try {
    html = renderMarkdown(body);
  } catch (error) {
    throw new ContentError(error.message, file);
  }
  if (status === 'published' && html.trim() === '') {
    throw new ContentError('the article body is empty', file);
  }

  const wordCount = optionalNumber(data.word_count, 'word_count', file);

  return {
    kind: 'post',
    file,
    filename,
    slug,
    title,
    status,
    draft: status === 'draft',
    date,
    updated,
    lastmod: updated,
    category,
    categoryKey: category.toLowerCase(),
    description,
    tags: listOfStrings(data.tags, 'tags', file),
    readingMinutes: readingMinutes === null ? Math.max(1, Math.round(countWords(body) / 200)) : readingMinutes,
    readingLabel: `${readingMinutes === null ? Math.max(1, Math.round(countWords(body) / 200)) : readingMinutes} min read`,
    wordCount: wordCount === null ? countWords(body) : wordCount,
    bannerTitle: requireString(data.banner_title, 'banner_title', file),
    cardArt,
    cardSteps,
    featured: data.featured === true,
    archivePosition,
    relatedSlugs: listOfStrings(data.related, 'related', file),
    seoTitle: optionalString(data.seo_title, 'seo_title', file, `${title} — ${site.name}`),
    ogTitle: title,
    seoDescription: optionalString(data.seo_description, 'seo_description', file, description),
    url: `/articles/${slug}.html`,
    dateLong: formatLongDate(date),
    bodyMarkdown: body,
    bodyHtml: html,
  };
}

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */

function loadPage(rootDir, filename, site) {
  const file = join(rootDir, 'content', 'pages', filename);
  const slugFromFile = basename(filename, '.md');
  const { data, body } = readMarkdownFile(file);

  const slug = optionalString(data.slug, 'slug', file, slugFromFile);
  if (!SLUG_PATTERN.test(slug)) {
    throw new ContentError(`"slug" must be lowercase letters, numbers and dashes (got "${slug}")`, file);
  }
  if (slug !== slugFromFile) {
    throw new ContentError(
      `"slug" is "${slug}" but the file is named "${slugFromFile}.md". `
      + 'The filename decides the public URL, so the two must match.',
      file,
    );
  }

  const title = requireString(data.title, 'title', file);
  const status = optionalString(data.status, 'status', file, 'published');
  if (!['published', 'draft'].includes(status)) {
    throw new ContentError(`"status" must be "published" or "draft" (got "${status}")`, file);
  }
  const order = optionalNumber(data.order, 'order', file);
  if (order === null || !Number.isInteger(order) || order < 1) {
    throw new ContentError('"order" is required and must be a whole number (1 or more); it sets navigation and sitemap order', file);
  }
  const updated = optionalDate(data.updated, 'updated', file) || site.homeUpdated;

  let html;
  try {
    html = renderMarkdown(body);
  } catch (error) {
    throw new ContentError(error.message, file);
  }
  if (status === 'published' && html.trim() === '') {
    throw new ContentError('the page body is empty', file);
  }

  const seoTitle = optionalString(data.seo_title, 'seo_title', file, `${title} — ${site.name}`);

  return {
    kind: 'page',
    file,
    filename,
    slug,
    title,
    status,
    draft: status === 'draft',
    order,
    updated,
    lastmod: updated,
    eyebrow: requireString(data.eyebrow, 'eyebrow', file),
    intro: requireString(data.intro, 'intro', file),
    inNav: data.in_nav === true,
    navLabel: optionalString(data.nav_label, 'nav_label', file, title),
    footerLabel: optionalString(data.footer_label, 'footer_label', file, title),
    sidebarLabel: optionalString(data.sidebar_label, 'sidebar_label', file, title),
    sidebarTitle: optionalString(data.sidebar_title, 'sidebar_title', file, 'Site information'),
    seoTitle,
    ogTitle: seoTitle,
    description: requireString(data.description, 'description', file),
    seoDescription: optionalString(data.seo_description, 'seo_description', file, requireString(data.description, 'description', file)),
    url: `/${slug}.html`,
    bodyMarkdown: body,
    bodyHtml: html,
  };
}

/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */

/**
 * Archive order: date descending, except posts that ask for an explicit
 * archive_position, which are inserted at exactly that slot. This reproduces
 * the launch ordering (the process audit sits fourth as the "start here" read)
 * while new posts simply appear newest-first.
 */
export function sortArchive(posts) {
  const published = posts.filter((post) => !post.draft);
  const pinned = published
    .filter((post) => post.archivePosition !== null)
    .sort((a, b) => a.archivePosition - b.archivePosition || b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
  const rest = published
    .filter((post) => post.archivePosition === null)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));

  const ordered = [...rest];
  for (const post of pinned) {
    ordered.splice(Math.max(0, Math.min(post.archivePosition - 1, ordered.length)), 0, post);
  }
  return ordered;
}

/** Feed order: strictly newest first. */
export function sortFeed(posts) {
  return posts
    .filter((post) => !post.draft)
    .sort((a, b) => b.date.localeCompare(a.date) || a.slug.localeCompare(b.slug));
}

/* ------------------------------------------------------------------ *
 * Load everything
 * ------------------------------------------------------------------ */

export function loadContent(rootDir) {
  const root = resolve(rootDir);
  const site = loadSite(root);

  const postFiles = listDirectory(join(root, 'content', 'posts'), '.md');
  const pageFiles = listDirectory(join(root, 'content', 'pages'), '.md');
  if (postFiles.length === 0) throw new BuildError('No posts found in content/posts/');
  if (pageFiles.length === 0) throw new BuildError('No pages found in content/pages/');

  const posts = postFiles.map((filename) => loadPost(root, filename, site));
  const pages = pageFiles.map((filename) => loadPage(root, filename, site)).sort((a, b) => a.order - b.order || a.slug.localeCompare(b.slug));

  const bySlug = new Map(posts.map((post) => [post.slug, post]));
  const duplicate = posts.length !== bySlug.size;
  if (duplicate) throw new BuildError('Two posts share the same slug');

  const published = posts.filter((post) => !post.draft);
  const publishedSlugs = new Set(published.map((post) => post.slug));
  const warnings = [];

  for (const post of published) {
    if (post.relatedSlugs.includes(post.slug)) {
      throw new ContentError('"related" must not list the article itself', post.file);
    }
    for (const related of post.relatedSlugs) {
      if (!publishedSlugs.has(related)) {
        throw new ContentError(`"related" points at "${related}", which is not a published post`, post.file);
      }
    }
    const seen = new Set();
    for (const related of post.relatedSlugs) {
      if (seen.has(related)) {
        // Reported, not fatal: the launch content already contains one such
        // duplicate and a migration must not silently rewrite copy.
        warnings.push(`"${post.slug}" lists "${related}" twice in its related links`);
      }
      seen.add(related);
    }
  }

  const featured = published.filter((post) => post.featured);
  if (featured.length > 1) {
    throw new BuildError(`Only one post can have featured: true (found ${featured.map((p) => p.slug).join(', ')})`);
  }

  const archive = sortArchive(posts);
  const featuredPost = featured.length === 1 ? featured[0] : archive[0];

  const usedPositions = new Map();
  for (const post of published) {
    if (post.archivePosition === null) continue;
    if (usedPositions.has(post.archivePosition)) {
      throw new BuildError(`archive_position ${post.archivePosition} is used by both "${usedPositions.get(post.archivePosition)}" and "${post.slug}"`);
    }
    usedPositions.set(post.archivePosition, post.slug);
  }

  const extraCategories = [...new Set(published.map((post) => post.category))]
    .filter((category) => !site.categories.some((entry) => entry.name.toLowerCase() === category.toLowerCase()))
    .sort((a, b) => a.localeCompare(b));

  if (pages.some((page) => page.slug === site.aboutPage) === false) {
    warnings.push(`aboutPage is "${site.aboutPage}" but no page with that slug exists; JSON-LD author links will 404`);
  }
  if (pages.some((page) => page.slug === site.ctaSlug) === false) {
    warnings.push(`ctaSlug is "${site.ctaSlug}" but no page with that slug exists; header contact links will 404`);
  }
  for (const post of published) {
    if (post.archivePosition !== null && post.archivePosition > published.length) {
      warnings.push(`"${post.slug}" has archive_position ${post.archivePosition} but only ${published.length} posts are published`);
    }
  }

  return {
    site,
    posts,
    pages,
    warnings,
    published,
    archive,
    featuredPost,
    feed: sortFeed(posts),
    categories: [
      ...site.categories.filter((entry) => published.some((post) => post.category.toLowerCase() === entry.name.toLowerCase())),
      ...extraCategories.map((name) => ({ name, button: name })),
    ],
    bySlug,
  };
}

/** Absolute URL for a site-relative path. */
export function absoluteUrl(site, path) {
  return `${site.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}
