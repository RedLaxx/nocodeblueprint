/**
 * Unit tests for the build libraries.
 *
 * `npm run check` validates the generated site; this file validates the parts
 * that produce it, including the failure modes: bad slugs, duplicate featured
 * posts, unknown related links, unbalanced containers. Run with
 *
 *   node build/test/run.mjs
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Suite } from '../lib/harness.mjs';
import { parse as parseYaml, stringify as stringifyYaml, splitFrontmatter } from '../lib/yaml.mjs';
import {
  renderMarkdown, renderInline, countWords, escapeText, escapeAttribute, MarkdownError,
} from '../lib/markdown.mjs';
import {
  loadContent, sortArchive, sortFeed, absoluteUrl, formatLongDate, formatRfc822, SLUG_PATTERN, CARD_ART,
} from '../lib/content.mjs';
import { shortTitle, resolveRelated, renderRobots } from '../lib/templates.mjs';
import { serializeJson } from '../lib/json.mjs';
import { parseHtml, parseXml, visibleText, ValidationError } from '../lib/validate.mjs';

const ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const suite = new Suite('NoCode Blueprint — unit tests');

// ---------------------------------------------------------------------------
suite.group('YAML parser');
{
  suite.equal('plain string', parseYaml('name: NoCode Blueprint').name, 'NoCode Blueprint');
  suite.equal('integer', parseYaml('order: 4').order, 4);
  suite.equal('float', parseYaml('priority: 0.7').priority, 0.7);
  suite.equal('boolean true', parseYaml('featured: true').featured, true);
  suite.equal('boolean false', parseYaml('in_nav: false').in_nav, false);
  suite.equal('null', parseYaml('value: null').value, null);
  suite.equal('empty value is null', parseYaml('value:').value, null);
  suite.equal('dates stay strings', parseYaml('date: 2026-10-08').date, '2026-10-08');
  suite.equal('quoted string keeps its colon', parseYaml('title: "Before: after"').title, 'Before: after');
  suite.equal('single-quoted string', parseYaml("title: 'it''s here'").title, "it's here");
  suite.equal('comment is ignored', parseYaml('# note\nname: x').name, 'x');
  suite.equal('trailing comment is stripped', parseYaml('name: x # note').name, 'x');
  suite.equal('hash inside quotes is kept', parseYaml('name: "a # b"').name, 'a # b');

  suite.equal('block sequence', JSON.stringify(parseYaml('tags:\n  - a\n  - b').tags), '["a","b"]');
  suite.equal('flow sequence', JSON.stringify(parseYaml('tags: [a, b]').tags), '["a","b"]');
  suite.equal('empty flow sequence', JSON.stringify(parseYaml('tags: []').tags), '[]');
  suite.equal('nested mapping', parseYaml('a:\n  b:\n    c: 1').a.b.c, 1);
  suite.equal('sequence of mappings', parseYaml('items:\n  - name: a\n    button: A\n  - name: b').items[0].button, 'A');
  suite.equal('sequence of mappings, second item', parseYaml('items:\n  - name: a\n  - name: b').items[1].name, 'b');
  suite.equal('mapping inside a sequence item', parseYaml('items:\n  - name: a\n    sub:\n      x: 1').items[0].sub.x, 1);
  suite.equal('sequence of sequences', JSON.stringify(parseYaml('grid:\n  - - 1\n    - 2').grid), '[[1,2]]');
  suite.equal('empty flow mapping', JSON.stringify(parseYaml('value: {}').value), '{}');

  suite.equal('literal block scalar keeps newlines', parseYaml('body: |\n  line one\n  line two\n').body, 'line one\nline two\n');
  suite.equal('folded block scalar joins lines', parseYaml('body: >\n  line one\n  line two\n').body, 'line one line two\n');
  suite.equal('stripped folded scalar drops the trailing newline', parseYaml('body: >-\n  line one\n  line two\n').body, 'line one line two');
  suite.equal('block scalar de-indents by the first line', parseYaml('body: |\n    deep\n      deeper\n').body, 'deep\n  deeper\n');
  suite.equal('long folded scalar is reflowed on read',
    parseYaml('description: >-\n  a very long line that the emitter\n  folded across two source lines\n').description,
    'a very long line that the emitter folded across two source lines');
  suite.equal('unicode survives', parseYaml('text: em dash — arrow →').text, 'em dash — arrow →');
  suite.equal('escaped quotes in double-quoted scalar', parseYaml('text: "say \\"hi\\""').text, 'say "hi"');

  const roundTrip = {
    name: 'NoCode Blueprint', order: 4, featured: true, tags: ['a', 'b'],
    nested: { deep: { value: 'x' } }, date: '2026-10-08',
  };
  suite.equal('stringify then parse is lossless', JSON.stringify(parseYaml(stringifyYaml(roundTrip))), JSON.stringify(roundTrip));
  suite.ok('stringify quotes a value containing a colon', stringifyYaml({ a: 'x: y' }).includes('"x: y"'));

  const front = splitFrontmatter('---\ntitle: Hello\ntags:\n  - a\n---\n\nBody text\n');
  suite.equal('frontmatter data', front.data.title, 'Hello');
  suite.equal('frontmatter body drops the leading blank line', front.body, 'Body text\n');
  suite.equal('a document without frontmatter is all body', splitFrontmatter('# Heading\n').body, '# Heading\n');
  suite.throws('an unclosed frontmatter block is an error', () => splitFrontmatter('---\ntitle: x\n'), 'not closed');
  suite.throws('a tab-indented mapping is an error', () => parseYaml('a:\n\tb: 1'));
}

// ---------------------------------------------------------------------------
suite.group('Markdown renderer');
{
  suite.equal('heading levels', renderMarkdown('## Two\n\n### Three'), '<h2>Two</h2>\n<h3>Three</h3>');
  suite.equal('paragraph', renderMarkdown('Hello world'), '<p>Hello world</p>');
  suite.equal('two paragraphs are separated', renderMarkdown('One\n\nTwo'), '<p>One</p>\n<p>Two</p>');
  suite.equal('bold', renderMarkdown('a **b** c'), '<p>a <strong>b</strong> c</p>');
  suite.equal('inline code', renderMarkdown('use `foo()` here'), '<p>use <code>foo()</code> here</p>');
  suite.equal('unordered list', renderMarkdown('- one\n- two'), '<ul><li>one</li><li>two</li></ul>');
  suite.equal('ordered list', renderMarkdown('1. one\n2. two'), '<ol><li>one</li><li>two</li></ol>');
  suite.equal('links', renderMarkdown('[text](https://example.com)'), '<p><a href="https://example.com">text</a></p>');
  suite.equal('consecutive lines join into one paragraph', renderMarkdown('line one\nline two'), '<p>line one\nline two</p>');

  suite.equal('escapeText escapes ampersands and angle brackets', escapeText('a & <b>'), 'a &amp; &lt;b&gt;');
  suite.equal('escapeAttribute escapes quotes', escapeAttribute('say "hi"'), 'say &quot;hi&quot;');
  suite.equal('markdown does not escape raw unicode', renderMarkdown('dash — arrow →'), '<p>dash — arrow →</p>');
  suite.equal('angle brackets in prose are escaped', renderMarkdown('a < b'), '<p>a &lt; b</p>');

  // A single run of prose renders inline inside the box, with no <p> wrapper.
  suite.equal('callout container', renderMarkdown(':::callout\nBody\n:::'), '<div class="callout">Body</div>');
  suite.equal('notice container', renderMarkdown(':::notice\nBody\n:::'), '<div class="notice">Body</div>');
  suite.equal('callout renders inline markdown', renderMarkdown(':::callout\n**Bold** lead-in. Rest.\n:::'),
    '<div class="callout"><strong>Bold</strong> lead-in. Rest.</div>');
  suite.equal('callout joins wrapped lines with a newline', renderMarkdown(':::callout\nline one\nline two\n:::'),
    '<div class="callout">line one\nline two</div>');
  suite.ok('empty callout is an error', throwsMarkdown(':::callout\n\n:::'));
  suite.ok('callout rejects arguments', throwsMarkdown(':::callout "Title"\nBody\n:::'));
  suite.equal('checklist container', renderMarkdown(':::checklist\n- one\n- two\n:::'),
    '<ul class="checklist"><li>one</li><li>two</li></ul>');
  suite.equal('prompt container keeps its label', renderMarkdown(':::prompt "Prompt record"\nname: x\n:::'),
    '<div class="prompt-box"><span class="prompt-label">Prompt record</span>name: x</div>');
  suite.equal('prompt content is verbatim, not markdown', renderMarkdown(':::prompt "L"\n- not a list\n**not bold**\n:::'),
    '<div class="prompt-box"><span class="prompt-label">L</span>- not a list\n**not bold**</div>');
  suite.equal('prompt content keeps blank lines', renderMarkdown(':::prompt "L"\na\n\nb\n:::'),
    '<div class="prompt-box"><span class="prompt-label">L</span>a\n\nb</div>');
  suite.equal('prompt content keeps placeholders and underscores', renderMarkdown(':::prompt "L"\n{{account_id}}\nsnake_case\n:::'),
    '<div class="prompt-box"><span class="prompt-label">L</span>{{account_id}}\nsnake_case</div>');
  suite.equal('prompt label is escaped', renderMarkdown(':::prompt "A < B"\nx\n:::'),
    '<div class="prompt-box"><span class="prompt-label">A &lt; B</span>x</div>');
  suite.ok('prompt without a label is an error', throwsMarkdown(':::prompt\nx\n:::'));
  // Block-level content switches a callout to full Markdown rendering.
  suite.equal('a container can hold a list and a paragraph', renderMarkdown(':::callout\n- one\n\nText\n:::'),
    '<div class="callout">\n<ul><li>one</li></ul>\n<p>Text</p>\n</div>');
  suite.equal('a container can hold a heading', renderMarkdown(':::notice\n## Sub\n\nText\n:::'),
    '<div class="notice">\n<h2>Sub</h2>\n<p>Text</p>\n</div>');

  suite.equal('raw HTML passes through untouched', renderMarkdown('<div class="contact-card">x</div>'),
    '<div class="contact-card">x</div>');
  const unclosed = suite.throws('an unclosed container is an error', () => renderMarkdown(':::callout\nBody'));
  suite.ok('the unclosed-container error is a MarkdownError', unclosed instanceof MarkdownError);
  suite.throws('an unknown container is an error', () => renderMarkdown(':::sidebar\nBody\n:::'), 'sidebar');

  suite.equal('countWords ignores markup and containers', countWords('## Heading\n\nThree little words\n\n:::prompt "L"\nnot counted\n:::'), 4);
  suite.ok('renderInline is exported and escapes', renderInline('a & b').includes('&amp;'));
}

// ---------------------------------------------------------------------------
suite.group('JSON serializer');
{
  suite.equal('object separators', serializeJson({ a: 1, b: 'x' }), '{"a": 1, "b": "x"}');
  suite.equal('array separator', serializeJson([1, 2]), '[1, 2]');
  suite.equal('nested', serializeJson({ a: { b: [1, { c: null }] } }), '{"a": {"b": [1, {"c": null}]}}');
  suite.equal('unicode is not escaped', serializeJson({ t: 'dash —' }), '{"t": "dash —"}');
  suite.equal('quotes are escaped', serializeJson({ t: 'say "hi"' }), '{"t": "say \\"hi\\""}');
  suite.equal('undefined values are dropped', serializeJson({ a: 1, b: undefined }), '{"a": 1}');
  suite.equal('output reparses as JSON', JSON.parse(serializeJson({ a: [1, 'two', null, true] })).a[1], 'two');
}

// ---------------------------------------------------------------------------
suite.group('HTML and XML validators');
{
  suite.equal('balanced document has no errors', parseHtml('<div><p>hi</p></div>').errors.length, 0);
  suite.ok('unclosed tag is reported', parseHtml('<div><p>hi</div>').errors.length > 0);
  suite.ok('mismatched close is reported', parseHtml('<section></div>').errors.length > 0);
  suite.ok('void elements need no close', parseHtml('<p>a<br>b<meta charset="utf-8">c</p>').errors.length === 0);
  suite.equal('script content is not parsed as markup',
    parseHtml('<script>if (a < b) { x(); }</script>').errors.length, 0);
  suite.ok('duplicate attribute is reported', parseHtml('<p class="a" class="b">x</p>').errors.length > 0);
  suite.equal('elements are collected', parseHtml('<div><p>x</p></div>').elements.map((e) => e.tag).join(','), 'div,p');

  suite.equal('XML text is captured', parseXml('<a><b>hello</b></a>').children[0].children[0].text, 'hello');
  suite.equal('XML entities are decoded', parseXml('<a>x &amp; y</a>').children[0].text, 'x & y');
  suite.ok('XML rejects a bare ampersand', throwsXml('<a>x & y</a>'));
  suite.ok('XML rejects a mismatched close', throwsXml('<a><b></a></b>'));
  suite.ok('XML rejects an unclosed element', throwsXml('<a><b></b>'));
  suite.ok('XML rejects an attribute without quotes', throwsXml('<a b=c></a>'));
  suite.ok('XML accepts self-closing elements', !throwsXml('<a><b/></a>'));
  suite.equal('visibleText strips tags and collapses whitespace', visibleText('<p>a <strong>b</strong>\n c</p>'), 'a b c');
}

function throwsMarkdown(source) {
  try {
    renderMarkdown(source);
    return false;
  } catch (error) {
    return error instanceof MarkdownError;
  }
}

function throwsXml(source) {
  try {
    parseXml(source);
    return false;
  } catch (error) {
    return error instanceof ValidationError;
  }
}

// ---------------------------------------------------------------------------
suite.group('Content helpers');
{
  suite.ok('SLUG_PATTERN accepts a normal slug', SLUG_PATTERN.test('ai-inbox-triage'));
  suite.ok('SLUG_PATTERN rejects an uppercase slug', !SLUG_PATTERN.test('AI-Inbox'));
  suite.ok('SLUG_PATTERN rejects a trailing dash', !SLUG_PATTERN.test('inbox-'));
  suite.ok('SLUG_PATTERN rejects an underscore', !SLUG_PATTERN.test('inbox_triage'));
  suite.ok('every card art variant is a known CSS class', CARD_ART.length === 6);

  suite.equal('absoluteUrl joins without a double slash', absoluteUrl({ baseUrl: 'https://x.dev' }, '/a.html'), 'https://x.dev/a.html');
  suite.equal('absoluteUrl adds a leading slash', absoluteUrl({ baseUrl: 'https://x.dev' }, 'a.html'), 'https://x.dev/a.html');
  suite.equal('formatLongDate', formatLongDate('2026-10-08'), 'October 8, 2026');
  suite.equal('formatRfc822', formatRfc822('2026-10-08'), 'Thu, 08 Oct 2026 00:00:00 +0000');

  const post = (slug, date, position) => ({ slug, date, updated: date, archivePosition: position ?? null });
  const byDateDesc = [post('a', '2026-10-08'), post('b', '2026-10-07'), post('c', '2026-10-06')];
  suite.equal('sortArchive is newest first', sortArchive(byDateDesc).map((p) => p.slug).join(','), 'a,b,c');

  const pinned = [post('new', '2026-10-08'), post('mid', '2026-10-07'), post('old', '2026-09-15', 2)];
  suite.equal('sortArchive honours a pinned archive_position', sortArchive(pinned).map((p) => p.slug).join(','), 'new,old,mid');

  const unsortedFeed = [post('a', '2026-10-06'), post('b', '2026-10-08'), post('c', '2026-10-07')];
  suite.equal('sortFeed is strictly newest first and ignores pins', sortFeed(unsortedFeed).map((p) => p.slug).join(','), 'b,c,a');

  suite.equal('shortTitle cuts at a colon', shortTitle('Before you automate it: a 15-minute process audit'), 'Before you automate it');
  suite.equal('shortTitle cuts at an em dash', shortTitle('Qualify leads with AI—without letting it make the call'), 'Qualify leads with AI');
  suite.equal('shortTitle leaves a plain title alone', shortTitle('Weekly reporting'), 'Weekly reporting');
}

// ---------------------------------------------------------------------------
suite.group('Live content');
{
  const content = loadContent(ROOT);
  suite.equal('15 posts load', content.posts.length, 15);
  suite.equal('7 pages load', content.pages.length, 7);
  suite.equal('no post is a draft', content.posts.filter((p) => p.draft).length, 0);
  suite.equal('exactly one post is featured', content.posts.filter((p) => p.featured).length, 1);
  suite.equal('the featured post is ai-inbox-triage', content.featuredPost.slug, 'ai-inbox-triage');
  suite.equal('the newest post leads the archive', content.archive[0].slug, 'ai-inbox-triage');
  suite.equal('the pinned post sits fourth', content.archive[3].slug, 'process-audit');
  suite.equal('the feed leads with the newest post', content.feed[0].slug, 'ai-inbox-triage');
  suite.equal('the feed ends with the oldest post', content.feed[14].slug, 'process-audit');
  suite.equal('four categories are configured', content.categories.length, 4);

  suite.ok('every post slug matches its file name',
    content.posts.every((post) => existsSync(join(ROOT, 'content', 'posts', `${post.slug}.md`))));
  suite.ok('every page slug matches its file name',
    content.pages.every((page) => existsSync(join(ROOT, 'content', 'pages', `${page.slug}.md`))));
  suite.ok('every post has 3 card steps', content.posts.every((post) => post.cardSteps.length === 3));
  suite.ok('every post has a known card art variant', content.posts.every((post) => CARD_ART.includes(post.cardArt)));
  suite.ok('every post has a non-empty description', content.posts.every((post) => post.description.length > 40));
  suite.ok('every post has a banner title', content.posts.every((post) => post.bannerTitle.length > 3));
  suite.ok('every post body rendered to HTML', content.posts.every((post) => post.bodyHtml.includes('<h2>')));
  suite.ok('every page has a footer and sidebar label',
    content.pages.every((page) => page.footerLabel && page.sidebarLabel));
  suite.ok('page order is unique', new Set(content.pages.map((p) => p.order)).size === content.pages.length);
  suite.ok('archive_position values are unique',
    new Set(content.posts.filter((p) => p.archivePosition !== null).map((p) => p.archivePosition)).size
      === content.posts.filter((p) => p.archivePosition !== null).length);

  for (const post of content.posts) {
    const related = resolveRelated(content.bySlug, post);
    suite.equal(`related links for ${post.slug} resolve`, related.length, post.relatedSlugs.length);
    for (const entry of related) {
      const target = content.bySlug.get(entry.slug);
      suite.ok(`related target ${entry.slug} exists`, target !== undefined);
      suite.equal(`related label for ${entry.slug} is the shortened title`, entry.label, shortTitle(target.title));
    }
  }

  const baseline = JSON.parse(readFileSync(join(ROOT, 'build', 'test', 'fixtures', 'content-baseline.json'), 'utf8'));
  suite.equal('the baseline covers 22 documents', Object.keys(baseline.documents).length, 22);
  const totalWords = Object.values(baseline.documents).reduce((sum, entry) => sum + entry.words, 0);
  suite.ok('the baseline records more than 8,000 words of body copy', totalWords > 8000, `${totalWords} words`);

  suite.equal('robots.txt is generated from the base URL', renderRobots(content.site).trim().split('\n').pop(),
    `Sitemap: ${content.site.baseUrl}/sitemap.xml`);
}

const passed = suite.report();
process.exit(passed ? 0 : 1);
