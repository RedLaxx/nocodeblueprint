# NoCode Blueprint — Cloudflare Pages starter

A framework-free, responsive AI automation blog scaffold. The site uses plain HTML, CSS, and a small amount of vanilla JavaScript; no build step or package installation is required.

## Deploy to Cloudflare Pages

1. In Cloudflare, open **Workers & Pages → Create application → Pages → Connect to Git** and select `RedLaxx/nocodeblueprint`.
2. Choose your production branch (usually `main`).
3. Use these build settings:
   - **Framework preset:** None
   - **Root directory:** `/` (repository root)
   - **Build command:** leave blank
   - **Build output directory:** `public`
4. Save and deploy. Do **not** use `npx wrangler deploy` for this Git-connected Pages site.

The deployed directory is `public/`; it contains `index.html`, the article pages, `404.html`, `_headers`, and `robots.txt`.

## Project map

- `public/index.html` — homepage, article search, and category filters
- `public/articles/` — four starter playbooks
- `public/assets/site.css` — shared article/404 styling (the homepage also embeds its styles so it previews as a standalone file)
- `public/_headers` — baseline response headers for Cloudflare Pages

## Local preview

From the project root, run:

```sh
python3 -m http.server 8000 --directory public
```

Then open `http://localhost:8000` in your browser.

## Add this starter to your empty GitHub repository

Extract the project folder, then from inside it run:

```sh
git init
git add .
git commit -m "Create NoCode Blueprint AI automation blog"
git branch -M main
git remote add origin https://github.com/RedLaxx/nocodeblueprint.git
git push -u origin main
```

If the repository has already gained a commit since this starter was prepared, inspect the remote history before pushing rather than force-pushing.

## Before publishing

- Review and edit all starter copy so it reflects your actual editorial voice and expertise.
- Add a real privacy/contact page before collecting reader information.
- There is intentionally no fake newsletter form. Connect a real email provider and consent flow before adding signup capture.
- Add a sitemap and canonical URLs after choosing the final production domain.
