# NoCode Blueprint — Cloudflare Pages blog

A framework-free, responsive AI automation blog built with plain HTML, CSS, and vanilla JavaScript. There is no build step and no package installation required.

The launch content includes **15 practical AI automation articles**, a searchable/filterable archive, structured SEO metadata, a sitemap, and the trust pages commonly needed before applying for advertising: About, Editorial Policy, Contact, Privacy Policy, Cookie Policy, Terms, and Disclaimer.

## Deploy to Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git** and select `RedLaxx/nocodeblueprint`.
2. Choose your production branch (usually `main`).
3. Use these build settings:
   - **Framework preset:** None
   - **Root directory:** `/` (repository root)
   - **Build command:** leave blank
   - **Build output directory:** `public`
4. Save and deploy. Do **not** use `npx wrangler deploy` for this Git-connected Pages site.

The deployed directory is `public/`.

## Project map

- `public/index.html` — editorial homepage, featured article, archive, search, and category filters
- `public/articles/` — 15 long-form AI automation articles
- `public/about.html` — publication mission and monetization disclosure
- `public/editorial-policy.html` — editorial, correction, and commercial disclosure standards
- `public/contact.html` — human contact route for corrections and privacy requests
- `public/privacy-policy.html`, `public/cookie-policy.html`, `public/terms.html`, `public/disclaimer.html` — publishing and advertising trust pages
- `public/assets/site.css` — shared responsive editorial styling
- `public/assets/site.js` — archive filtering and current-year footer labels
- `public/sitemap.xml`, `public/robots.txt`, `public/feed.xml` — crawler and RSS support
- `public/ads.txt` — intentionally commented until an approved AdSense publisher ID is available
- `public/_headers` — baseline response and cache headers for Cloudflare Pages

## Local preview

From the project root, run:

```sh
python3 -m http.server 8000 --directory public
```

Then open `http://localhost:8000` in your browser.

## Before applying for AdSense or publishing

- The current canonical/deployment URL is `https://nocodeblueprint.deehasalo.workers.dev`; update it in canonical URLs, JSON-LD, `robots.txt`, and `sitemap.xml` if the deployment domain changes.
- Replace `hello@nocodeblueprint.com` with a monitored publication inbox if needed.
- Review the legal pages with the requirements that apply to your business, audience, location, and hosting setup; they are a strong plain-language starting point, not legal advice.
- Add the exact active publisher line supplied by Google to `public/ads.txt` after AdSense approval. Do not leave the example placeholder active.
- If you enable AdSense, add the official script and a consent flow that matches the regions you serve. The privacy and cookie pages already explain the intended disclosure, but the live vendors and choices must match reality.
- Add a real favicon, social share image, and analytics only if you actually use them; do not add fake tracking or newsletter forms.
- Review every article for your editorial voice, current tool behavior, and any claims that need an up-to-date source.

## Add or update an article

Each article is a standalone HTML file under `public/articles/`. Update the matching card in `public/index.html`, add the URL to `public/sitemap.xml`, and include canonical/Open Graph metadata plus Article JSON-LD in the article head. Keep the review-first, human-accountability standard described in `editorial-policy.html`.
