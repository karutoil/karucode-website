# karucode-website

The marketing site for [karucode](https://github.com/karutoil/karucode) — a coding agent
that is one binary, not a stack. Static Astro site, no server, no runtime dependencies.

Every number on the site is measured and recorded in `docs/FACTS.md`; the install path it
documents is `packaging/install.sh` in the karucode repository and nothing else.

```bash
npm install
npm run dev          # http://localhost:4321
npm run build        # -> dist/
npm run preview      # serve dist/ on :4321
npm run check        # the gate: types, build, then link/fragment/alt audit
```

`npm run check` is four things in order: `astro check` (0 errors expected),
`astro build` (must exit 0), `scripts/check-links.mjs`, which walks `dist/` and fails
on a broken internal link, a missing `#fragment`, an `<img>` without `alt` or `width`,
or a page without exactly one `<h1>`, and `scripts/csp-hashes.mjs --check`, which
fails if `dist/_headers` lists stale inline-script hashes. Run it before you push.

### Deploy

The site is a static build, served by Cloudflare Pages with the headers in
`dist/_headers` (strict CSP, HSTS, immutable asset caching).

```bash
CLOUDFLARE_API_TOKEN=... npm run deploy    # wrangler pages deploy dist
```

`npm run deploy` runs the full check first, so a failing build never reaches the
edge. `wrangler login` also works if you have an interactive terminal, but a token
with the **Pages: Edit** permission is what CI should use — an interactive OAuth
token expires after a while and cannot refresh unattended.

The canonical origin is **https://code.karutoil.site**, set in `astro.config.mjs`
(`site`), `src/site.ts` (`url`), and the two files in `public/` (`sitemap.xml`,
`robots.txt`). Change all four together or the canonical tags and sitemap disagree.
Attaching the custom domain to the Pages project is a one-time step in the
Cloudflare dashboard (Workers & Pages -> karucode-website -> Custom domains).

## Deploying to Cloudflare Pages

Build command `npm run build`, output directory `dist`, Node 22.12+.
`public/_headers` sets caching and a strict CSP; `wrangler.toml` is the Pages project
config. To deploy by hand:

```bash
npx wrangler pages deploy dist --project-name karucode-website
```

## Before you change anything

- [`AGENTS.md`](AGENTS.md) — stack rules, design system, file ownership, definition of done.
- [`docs/FACTS.md`](docs/FACTS.md) — every number and claim the site is allowed to make.

## Layout

```
src/
  styles/       tokens.css (brand primitives + semantic layer), base.css, fonts.css
  layouts/      Base.astro (head, nav, footer, reveal observer)
  components/
    ui/         Nav, Footer, SectionHead, Cmd — shared, do not fork
    hero/       Hero, CursorField (the canvas field), Readout (the boot card)
    sections/   the seven numbered home sections, plus Coda (the light closing band)
  pages/        index, 404, docs/*, security
public/         everything here is published verbatim, so keep it to what is used
  brand/        favicon.svg, mark.svg, og.png only
  fonts/        Inter + JetBrains Mono (woff2, SIL OFL — licences included)
  media/        product screenshots
assets/brand/   the rest of the brand kit — source only, never published
docs/FACTS.md   the copy contract
```

Brand assets are generated in `karucode/branding/` and copied here. Change them there,
not here.

`public/` and `assets/` are split on purpose: a file in `public/` is copied into
`dist/` and served, so unreferenced brand variants (lockups, banners, mono marks)
live in `assets/brand/` and cost the deployed site nothing. Move a file into
`public/brand/` only when a page actually references it.
