# NoCode Blueprint

An editorial blog about AI automation and no-code workflows, published at
<https://nocodeblueprint.deehasalo.workers.dev/>.

Content is written in Markdown, edited through [Pages CMS](https://pagescms.org),
committed to this repository, and built into the static files in `public/` that
Cloudflare serves. The design is framework-free: plain HTML, one CSS file, one
vanilla JS file, and a Node build with **zero dependencies**.

```
edit in Pages CMS ──commit──▶ GitHub ──build──▶ Cloudflare ──▶ live site
```

---

## Contents

- [Repository layout](#repository-layout)
- [Editing content](#editing-content)
- [Connecting Pages CMS](#connecting-pages-cms)
- [Branches and review](#branches-and-review)
- [Building locally](#building-locally)
- [Previewing locally](#previewing-locally)
- [Deployment](#deployment)
- [Testing a new article end to end](#testing-a-new-article-end-to-end)
- [Quality checks](#quality-checks)
- [URLs and SEO](#urls-and-seo)
- [Design decisions](#design-decisions)
- [What could not be verified from the repository](#what-could-not-be-verified-from-the-repository)

---

## Repository layout

| Path | Role |
| --- | --- |
| `.pages.yml` | Pages CMS schema: which collections exist, which fields are editable, where media goes. |
| `content/posts/*.md` | **Source of truth** for the 15 articles. One file per article. |
| `content/pages/*.md` | **Source of truth** for About, Editorial policy, Contact and the legal pages. |
| `config/site.yml` | Site-wide settings: name, canonical URL, feed metadata, navigation wording, categories. |
| `build/build.mjs` | The build. Reads `content/` + `config/`, writes `public/`. |
| `build/lib/` | YAML parser, Markdown renderer, content loader, HTML templates, validators. |
| `build/verify.mjs` | Fails if `public/` does not match `content/`. |
| `build/check.mjs` | The deployment quality gate (URLs, links, HTML, JSON-LD, sitemap, feed, domain). |
| `build/test/run.mjs` | Unit tests for the parsers and renderers. |
| `build/smoke.mjs` | Serves `public/` locally and requests every important route. |
| `build/preview.mjs` | Local preview server. |
| `scripts/migrate-from-html.mjs` | One-shot migration that produced `content/` from the original hand-written HTML. Kept for auditability; not part of the build. |
| `public/` | **Generated** deploy directory, committed to Git. |
| `public/assets/site.css`, `site.js` | Hand-maintained design. Never generated. |
| `public/404.html`, `_headers`, `ads.txt` | Hand-maintained. Never generated. |
| `.github/workflows/verify.yml` | Runs the full gate on every push and pull request. |

**Generated into `public/`:** `index.html`, `articles/<slug>.html` (one per
published post), `<slug>.html` (one per published page), `sitemap.xml`,
`feed.xml`, `robots.txt`.

**Never touched by the build:** everything else in `public/`.

---

## Editing content

### Through Pages CMS (normal route)

1. Go to <https://app.pagescms.org> and sign in with GitHub.
2. Open `RedLaxx/nocodeblueprint` and pick a branch (see [Branches](#branches-and-review)).
3. Choose a collection:
   - **Posts** — the 15 articles. Click one to edit, or *Create entry* for a new one.
   - **Pages** — About, Editorial policy, Contact and the legal pages.
   - **Site settings** — `config/site.yml`: site name, canonical URL, feed text, footer line, categories.
4. Fill in the form. Every metadata field is a proper input: text, date picker,
   dropdown, toggle or repeatable list. The body is a Markdown editor.
5. Save. Pages CMS commits the file straight back to the branch you selected.
6. Cloudflare rebuilds and deploys automatically. Usually live within a minute.

Draft handling: set **Status** to `Draft` and the article disappears from the
site completely — no HTML file, no homepage card, no sitemap entry, no feed
item. Set it back to `Published` to restore it.

### In any editor

Change the file, then:

```sh
npm run build     # regenerate public/
npm run ci        # run every check
git add content config public
git commit -m "content: explain the change"
git push
```

Commit `content/`, `config/` **and** `public/` together. CI fails if they drift.

### Content format

Full field reference and the four site components (`:::callout`, `:::notice`,
`:::checklist`, `:::prompt "Label"`) are documented in
[`content/README.md`](content/README.md).

---

## Connecting Pages CMS

Pages CMS is a hosted editor that reads `.pages.yml` from your repository and
commits changes back through a GitHub App. There is no database and no separate
content store — Git history *is* the audit trail.

Setup, once per repository:

1. Open <https://app.pagescms.org> and choose **Sign in with GitHub**.
2. When prompted, install the **Pages CMS** GitHub App on the account that owns
   `RedLaxx/nocodeblueprint`. Choose **Only select repositories** and pick this
   one. The app needs write access to contents, which is what lets it commit.
3. Back in Pages CMS, open `RedLaxx/nocodeblueprint`.
4. Because `.pages.yml` is already committed, the Posts, Pages and Site settings
   collections appear immediately. Nothing else to configure.

If the app was installed on your personal account but the repository moves to an
organisation, reinstall it there — installations are per account.

**Verified in this repository:** `.pages.yml` parses against the real Pages CMS
`ConfigSchema` (the Zod schema in `pages-cms/pages-cms`), so every key and field
type used here is one the app accepts. Pages CMS reads `.pages.yml` per
repository *and* per branch, so a schema change on a feature branch does not
affect editors working on `main`.

---

## Branches and review

Pages CMS commits to whichever branch you select in the menu at the top left.

- **Editing on `main`** publishes immediately. Fast, and appropriate for typo
  fixes and new articles you have already reviewed.
- **Editing on a branch** gives you a review step. Create a branch, edit there,
  open a pull request, and merge when it looks right.

A recommended setup for editorial review:

1. Push a branch, for example `content/next-article`.
2. In Pages CMS, switch to that branch and write there.
3. Run `npm run build` locally (or let a maintainer do it) so the branch carries
   regenerated `public/` files, then open a pull request into `main`.
4. CI runs the full gate on the pull request.
5. Merge. Cloudflare deploys `main`.

The generated files must be committed on the same branch as the content change,
otherwise the sync check fails. If an editor saves through Pages CMS on a branch
and cannot run Node, a maintainer can run `npm run build` on that branch and push
the result before merging.

---

## Building locally

Requires Node 20.11 or newer. **No `npm install`** — the project has no
dependencies.

```sh
npm run build     # content/ + config/site.yml -> public/
npm run verify    # is public/ in sync with content/?
npm run check     # deployment quality gate
npm run test      # unit tests for the parsers and renderers
npm run smoke     # serve public/ and request every important route
npm run ci        # test + build + verify + check + smoke
```

The build is deterministic and offline: no network calls, no secrets, no
environment variables that affect output. Running it twice produces identical
bytes, and running it when nothing changed reports `0 created, 0 updated`.

---

## Previewing locally

```sh
npm run preview
# -> http://localhost:8788
```

Or with any static server:

```sh
python3 -m http.server 8000 --directory public
```

The bundled server binds `0.0.0.0`, answers for any `Host` header, resolves
extension-less URLs (`/about` → `about.html`), and serves the designed 404 page
for anything missing — the same behaviour Cloudflare gives you.

---

## Deployment

### What this repository is connected to

Inspecting the GitHub commit statuses on this repository shows **two** Cloudflare
deployments, both from the `cloudflare-workers-and-pages` GitHub App:

| Deployment | Evidence | URL |
| --- | --- | --- |
| **Worker** named `nocodeblueprint`, built by *Workers Builds* | Check run `Workers Builds: nocodeblueprint`, Script `nocodeblueprint`, Version ID `3ad2f4c0-93b3-4616-b3aa-468e3a36b721` | `https://nocodeblueprint.deehasalo.workers.dev/` |
| **Pages** project named `nocodeblueprint` | Check run `Cloudflare Pages`, preview deployment `https://11b57b6c.nocodeblueprint.pages.dev` | `https://nocodeblueprint.pages.dev/` |

So the canonical `workers.dev` URL is served by a **Worker with static assets**,
not by Pages, and a separate Pages project deploys the same `public/` directory.
Both are live and both read the committed files in `public/`.

### Why nothing in the deployment had to change

Because the generated HTML is **committed**, Cloudflare can keep deploying
`public/` exactly as it does today. No build command is required, no Node version
needs to be pinned, and the existing Worker and Pages configurations continue to
work untouched. This was deliberate: replacing a working deployment to add a
build step would risk the live site for no gain.

If you would rather have Cloudflare build from source on every deploy, set the
build command to `npm run build` in the dashboard (steps below). Both models
work; committing the output is the safer one and is what this repository does.

### Cloudflare dashboard settings

**For the Worker** (`nocodeblueprint.deehasalo.workers.dev`):

1. <https://dash.cloudflare.com> → **Workers & Pages** → **nocodeblueprint**.
2. **Settings** → **General**. Confirm:
   - **Source** — connected to `RedLaxx/nocodeblueprint`.
   - **Production branch** — `main`.
   - **Build command** — blank (or `npm run build`).
   - **Build output directory / assets directory** — `public`.
3. **Deployments** shows the build triggered by the latest commit to `main`.

**For the Pages project** (`nocodeblueprint.pages.dev`):

1. **Workers & Pages** → **nocodeblueprint** (the Pages one).
2. **Settings** → **Builds & deployments**. Confirm:
   - **Production branch** — `main`.
   - **Framework preset** — None.
   - **Root directory** — `/`.
   - **Build command** — blank (or `npm run build`).
   - **Build output directory** — `public`.
3. Every pull request gets its own preview deployment at
   `https://<hash>.nocodeblueprint.pages.dev`.

### How a Worker consumes `public/`

The Worker serves the directory as static assets. With no `wrangler.toml` in the
repository, that binding is configured in the dashboard, and Workers Builds
uploads `public/` as the asset manifest on each build. If you later want the
configuration in code, add a `wrangler.toml` with:

```toml
name = "nocodeblueprint"
compatibility_date = "2026-10-01"

[assets]
directory = "./public"
```

Then the same `npm run build` output is deployed by `wrangler deploy`. **Do not
add this file until you have confirmed the dashboard is not already managing the
Worker**, or you will have two sources of truth for one deployment.

### Redeploying after a CMS commit

Nothing manual is needed. A Pages CMS save is a normal commit; the GitHub App
push triggers Workers Builds and Cloudflare Pages, which rebuild and deploy
`main`. Watch progress under **Deployments** in the dashboard, or in the commit
statuses on GitHub.

To force a redeploy without a new commit: **Workers & Pages → your project →
Deployments → ⋯ → Retry deployment**.

---

## Testing a new article end to end

1. In Pages CMS, on a branch, create a post. Set `status: draft`, fill in every
   required field, and save.
2. Locally: `git fetch && git checkout <branch>`, then `npm run build`.
   A draft produces **no** file. Confirm with `npm run verify` and check that
   `public/articles/` is unchanged.
3. Set `status: published` in Pages CMS, save, pull, and run `npm run build`
   again. The new `public/articles/<slug>.html` appears, plus an updated
   `index.html`, `sitemap.xml` and `feed.xml`.
4. Run `npm run check`. It verifies the new article's canonical URL, JSON-LD,
   internal links, homepage card and sitemap entry.
5. Run `npm run preview` and open the article. Check the banner, the card steps,
   the related panel, the category filter and the search box.
6. Commit `content/` and `public/` together and push. CI runs the same gate.
7. Open a pull request into `main`. Review the generated diff — it shows exactly
   what will be published.
8. Merge. Cloudflare deploys. Confirm the article is live on
   `https://nocodeblueprint.deehasalo.workers.dev/articles/<slug>.html`, then
   check the URL in Search Console if the site is registered there.

---

## Quality checks

`npm run check` executes 1,095 assertions. It needs no network and no
secrets, and it produces the same verdict locally and in CI.

| Group | What it proves |
| --- | --- |
| Build sync and determinism | `public/` matches `content/`; two builds produce identical bytes |
| Protected URLs | All 15 article URLs, all 7 page URLs and every root/asset file exist; no orphan article HTML |
| Generated documents parse | Every HTML file is well formed; every article carries one `BlogPosting` JSON-LD with a numeric `wordCount`; the homepage carries `WebSite` JSON-LD |
| Internal links | Every relative `href`/`src` resolves to a real file; every in-page anchor resolves; no `http://` links; every sitemap and feed URL maps to a real file |
| Canonical URLs and domain | Every page's `canonical` and `og:url` equal the workers.dev URL for its path; Open Graph and Twitter tags present; no `nocodeblueprint.com` anywhere except `hello@nocodeblueprint.com` |
| Homepage archive | One card per published post, each with its category and search keywords; the featured slot; filter buttons; the archive count |
| Feed and sitemap metadata | RSS 2.0 shape, channel metadata, one `pubDate` per item, newest first, permanent guids; sitemap namespace, valid `lastmod`, priorities |
| Content fidelity | The visible text of all 22 documents hashes to the pre-migration baseline — not one word lost |
| Pages CMS configuration | `.pages.yml` matches the published schema; every collection covers its directory; body fields use the lossless editor |
| Hygiene | JavaScript syntax valid; no AdSense publisher ID, no analytics, no tag manager, no pixel; no credential material; build scripts read no environment variables |

The fidelity baseline lives in `build/test/fixtures/content-baseline.json`. It
records a SHA-256 of the visible text of each article and page body as it was
before the CMS migration, plus word, heading, paragraph, list-item, prompt-box,
callout and checklist counts. If a future edit accidentally truncates a document,
this check names the URL.

---

## URLs and SEO

- **Canonical base:** `https://nocodeblueprint.deehasalo.workers.dev` — set once
  in `config/site.yml` as `baseUrl`, used for every canonical URL, `og:url`,
  JSON-LD, the sitemap and `robots.txt`.
- **`nocodeblueprint.com` is gone.** `npm run check` fails if it reappears
  anywhere in `public/`, except in the contact address
  `hello@nocodeblueprint.com`.
- **Stable URLs.** All 15 launch article URLs and all 7 page URLs are asserted by
  name on every build.
- **Per article:** `canonical`, `og:title`, `og:description`, `og:url`,
  `og:type`, `og:site_name`, `twitter:card`, and `BlogPosting` JSON-LD with
  `headline`, `description`, `datePublished`, `dateModified`, `author`,
  `publisher`, `mainEntityOfPage`, `articleSection` and `wordCount`.
- **Homepage:** `WebSite` JSON-LD, Open Graph tags, the full archive grid,
  category filters and client-side search.
- **`sitemap.xml`:** 23 URLs — the homepage (weekly, 1.0), 7 pages (monthly,
  0.7) and 15 articles (monthly, 0.7), each with a `lastmod` from its content.
- **`feed.xml`:** RSS 2.0, newest first, permanent GUIDs, announced in
  `robots.txt` and linked from the homepage.
- **Relative links** throughout, so the site works on any host or subdirectory.

---

## Design decisions

**Generated output is committed.** Cloudflare keeps deploying with no build
command, the two existing deployments needed no change, and every content commit
shows its rendered HTML in the pull request diff. The cost is a sync
requirement, which `npm run verify` and CI enforce.

**Zero dependencies.** The YAML parser, Markdown renderer and HTML/XML
validators are in `build/lib/`. A clean checkout builds with nothing but Node,
so there is no lockfile to age and no supply chain to audit. The parsers were
differentially tested against the `yaml` package on all 24 real content files
(identical parses, stable round-trips) before the dependency was removed.

**The article body is a `code` field, not `rich-text`.** Pages CMS's rich-text
editor stores content through a Tiptap document model, so anything outside its
node schema is dropped on save. These articles depend on `:::callout`,
`:::notice`, `:::checklist`, `:::prompt` and a raw HTML contact card — all of
which a Tiptap round-trip would destroy. A `code` field has no read or write
transform, so the Markdown is committed byte-for-byte. Editors still get a
syntax-highlighted Markdown editor, and every other field is a normal typed
input.

**Homepage editorial copy lives in the template.** The hero, the method section
and the about panel are literals in `build/lib/templates.mjs`, not config keys.
They are part of the design, and exposing them as CMS fields would let a content
edit reflow the landing page and would need raw-HTML inputs. Only the parts that
genuinely change with content — the featured card, the filter buttons, the
archive grid, the counts — are generated from data.

**Legal pages are editable, and protected.** All seven are normal CMS entries, so
corrections do not need a developer. Their URLs cannot be deleted from the CMS
(`operations.delete: false`), their slugs are pattern-checked, and the build
refuses to publish a slug that does not match its file name. Review legal edits
in a pull request before merging.

**No advertising or analytics placeholders.** `public/ads.txt` ships fully
commented, with the real publisher line to be added only after AdSense approval.
There is no analytics snippet, no tag manager, no pixel and no newsletter form.
`npm run check` fails if any of those appear.

---

## What could not be verified from the repository

Stated plainly, so nobody assumes more was checked than actually was:

- **Cloudflare dashboard settings could not be inspected.** Build command,
  production branch, asset directory and environment variables for both the
  Worker and the Pages project live in the dashboard, which needs credentials
  this repository does not have and should not ask for. The two deployments were
  confirmed from public GitHub commit statuses instead. The exact settings to
  confirm by hand are listed in [Cloudflare dashboard
  settings](#cloudflare-dashboard-settings).
- **There is no `wrangler.toml`**, so the Worker's asset binding is
  dashboard-managed. Nothing in the repository declares it.
- **The Pages CMS GitHub App installation could not be enumerated** — the GitHub
  API rejects installation queries from this token. The App's presence is
  inferred from the `cloudflare-workers-and-pages` check runs, not from an
  installation list. Follow [Connecting Pages CMS](#connecting-pages-cms) to
  install it; Pages CMS will create nothing else, because `.pages.yml` is
  already here.
- **The Pages CMS editor UI could not be exercised**, since that needs an
  interactive GitHub login. The configuration was validated against the real
  upstream `ConfigSchema` instead, and the `code`-field round-trip claim rests on
  reading the field's source (no `read`/`write` transform) rather than on a
  live save.

---

## Migration note

`content/` was generated from the original hand-written HTML by
`scripts/migrate-from-html.mjs`, which is kept in the repository so the
extraction is auditable and repeatable. The result was verified file by file
against the pre-migration site:

- `index.html`, `sitemap.xml`, `robots.txt` and 14 of 15 articles are
  **byte-identical**.
- The 7 standard pages and `articles/prompt-versioning.html` differ only in
  whitespace between tags. Visible text and the ordered tag-and-attribute
  sequence are identical in all 24 documents.
- `feed.xml` differs in one place, deliberately: the `content-repurposing`
  summary was a stale, shorter variant of the article's own description. It now
  matches, so the feed is derived from content metadata as intended.

One pre-existing defect was **preserved rather than silently fixed**: the
`follow-up-drafts` article lists `content-repurposing` twice in its related
links panel. Fixing it would have changed published output during a migration
that was supposed to be content-neutral. The build reports it as a warning on
every run. To fix it, remove the duplicate entry from `related` in
`content/posts/follow-up-drafts.md` and run `npm run build`.
