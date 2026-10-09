# Writing content

Everything on the site is edited here, in Markdown with YAML frontmatter. The
build turns these files into the HTML in `public/`.

```
content/
  posts/    one .md file per article   ->  public/articles/<slug>.html
  pages/    one .md file per page      ->  public/<slug>.html
config/
  site.yml  site-wide settings         ->  every generated file
```

Two ways to edit:

- **Pages CMS** — <https://app.pagescms.org>, sign in with GitHub, open
  `RedLaxx/nocodeblueprint`, pick a branch, edit, save. Saving commits the file
  back to that branch. This is the normal route and needs no local setup.
- **Any editor** — change the file, run `npm run build`, commit both the
  content and the regenerated `public/` files.

---

## Anatomy of a post

```markdown
---
title: Your first useful AI automation: an inbox triage
slug: ai-inbox-triage
status: published
date: 2026-10-08
updated: 2026-10-08
category: Workflow
description: >-
  A small, reviewable workflow for turning a noisy inbox into a clear
  next-action queue—without letting a model send messages on your behalf.
tags:
  - inbox
  - email triage
  - classification
banner_title: Capture → classify → queue → decide
card_art: mail
card_steps:
  - New message lands
  - AI suggests a label
  - Human chooses next action
featured: true
related:
  - lead-qualification
  - meeting-notes-to-actions
---

## First heading

Body copy goes here.
```

### Field reference — posts

| Field | Required | What it does |
| --- | --- | --- |
| `title` | yes | Heading on the article, the homepage card and the RSS feed. |
| `slug` | yes | Public URL `/articles/<slug>.html` **and** the file name. Must match. |
| `status` | yes | `published` or `draft`. Drafts build nothing: no HTML, no card, no sitemap or feed entry. |
| `date` | yes | Published date. Drives byline, archive order and feed order. |
| `updated` | no | `dateModified` in the JSON-LD and `lastmod` in the sitemap. Defaults to `date`. Must not be earlier than `date`. |
| `category` | yes | One of `Workflow`, `Operations`, `Content`, `Foundations`. Drives the article tag, breadcrumb, homepage filter and `articleSection`. |
| `description` | yes | The dek. Also the meta description, the card text and the RSS summary. |
| `seo_title` | no | Browser tab title. Defaults to `<title> — NoCode Blueprint`. |
| `seo_description` | no | Override for the meta and Open Graph description. Defaults to `description`. |
| `tags` | no | Search keywords for the homepage filter. Not displayed. Phrases are fine. |
| `reading_minutes` | no | Shown as “N min read”. Defaults to body words ÷ 200, rounded to the nearest minute, minimum 1. |
| `word_count` | no | `wordCount` in the JSON-LD. Defaults to a count of the body. |
| `banner_title` | yes | Short line inside the article banner, usually the shape of the workflow. |
| `card_art` | yes | Card colour and pattern: `mail`, `lead`, `content`, `audit`, `system`, `ops`. Defined in `public/assets/site.css`. |
| `card_steps` | yes | **Exactly three** very short lines drawn on the homepage card. |
| `featured` | no | Shows the post in the large “Start here” slot. Only one post may set it; the build fails otherwise. |
| `archive_position` | no | Pins the post to an exact slot in the homepage grid (1 = first). Without it, posts sort by date, newest first. |
| `related` | no | Up to four other post slugs for the “Keep building” panel. Link text is each target title shortened at its first `:` or `—`. |
| body | yes | Markdown, below the frontmatter. |

### Field reference — pages

| Field | Required | What it does |
| --- | --- | --- |
| `title` | yes | Page heading and title. |
| `slug` | yes | Public URL `/<slug>.html` **and** the file name. |
| `status` | yes | `published` or `draft`. A draft page loses its header, footer and sidebar links. |
| `order` | yes | Position in the footer, sidebar and sitemap. The launch pages use 1–7. |
| `updated` | no | `lastmod` in the sitemap. |
| `eyebrow` | yes | Small label above the heading, e.g. “The project”. |
| `intro` | yes | One or two sentences under the heading. |
| `description` | yes | Meta and Open Graph description. |
| `seo_title` | no | Browser tab title. Defaults to `<title> — NoCode Blueprint`. |
| `in_nav` | no | Show in the header navigation. On for About and Editorial policy. |
| `nav_label` | no | Header label when `in_nav` is on, e.g. “Editorial”. |
| `footer_label` | yes | Footer label, e.g. “Privacy”, “Cookies”. |
| `sidebar_label` | yes | Label in the “Site information” sidebar, e.g. “Privacy policy”. |

---

## Body syntax

Ordinary Markdown:

```markdown
## A section heading

### A subsection

A paragraph. Wrap lines however you like; consecutive lines stay in one
paragraph. Leave a blank line to start a new one.

**Bold** and `inline code`.

- a bullet
- another bullet

1. a numbered step
2. another step

[Link text](https://example.com)
```

### The four site components

Each component opens with `:::name` on its own line and closes with a line
containing only `:::`.

```markdown
:::callout
**Keep the original close.** A summary is a shortcut, not a source of truth.
:::

:::notice
Warnings and caveats render in the tinted notice box.
:::

:::checklist
- Can a reviewer reach the original message in one click?
- Are unclear and failed cases visible?
:::

:::prompt "Draft reply prompt"
role: support draft writer
input: {{ticket_text}}
output: one short reply, no promises about pricing
:::
```

- `:::callout` and `:::notice` take a single run of prose. If the body contains
  a blank line, a list or a heading, it is rendered as full Markdown blocks
  inside the box instead.
- `:::checklist` items must start with `- `. They render as
  `<ul class="checklist">` with the tick styling from `site.css`.
- `:::prompt "Label"` content is **verbatim** — no Markdown, no escaping, no
  entity encoding. Blank lines, `- ` bullets, `1.` lists, `{{placeholders}}` and
  `snake_case` all survive untouched, which is what makes prompts copy-pasteable.
  The label is required.
- Components cannot nest.

Raw HTML is passed through untouched, so the contact card in
`content/pages/contact.md` works as-is. Use it sparingly: anything the Markdown
renderer can express should stay Markdown.

---

## What the build refuses to publish

These fail the build with a message naming the file, so a mistake can never
reach the live site:

- `slug` does not match the file name
- a slug that is not lowercase letters, numbers and single dashes
- `updated` earlier than `date`
- `card_steps` with anything other than exactly three entries
- an unknown `card_art` value
- `related` naming a post that does not exist, or naming itself
- two posts both marked `featured: true`
- two posts claiming the same `archive_position`
- an unclosed or unknown `:::` component
- a `:::checklist` item that is not a list item
- no posts, or no pages, in `content/`

These warn but still build:

- `related` listing the same post twice (a known quirk inherited from the
  original `follow-up-drafts` page)
- `aboutPage` or `ctaSlug` in `config/site.yml` pointing at a missing page
- an `archive_position` larger than the number of published posts

---

## Adding a category

1. Use the new name in the post's `category` field.
2. Add it to `categories` in `config/site.yml`, in the order you want the filter
   buttons to appear. `button` is the plural label shown on the homepage
   (`Workflow` → `Workflows`); omit it to reuse the name.
3. Add the new name to `options.values` on the `category` field in `.pages.yml`,
   otherwise Pages CMS will reject it on save.

A category with no published article is hidden automatically.

## Adding an image

Upload through Pages CMS, or put the file in `public/media/`. Reference it from
the body with a normal Markdown image:

```markdown
![A short description](/media/diagram.png)
```

`media` in `.pages.yml` maps `public/media/` on disk to `/media/` in URLs. The
launch articles are text-only; the design has no image slots, so adding
photography means a CSS change too.

## Before you commit

```sh
npm run build    # regenerate public/
npm run verify   # is public/ in sync with content/?
npm run check    # URLs, links, HTML, JSON-LD, sitemap, feed, canonical domain
npm run smoke    # serve public/ locally and request every important route
npm run ci       # all of the above, in order
```

Commit `content/`, `config/` **and** `public/` together. Cloudflare deploys
whatever is committed in `public/`.
