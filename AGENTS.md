# AGENTS.md — karucode website

The marketing site for karucode: a coding agent that is one 10.5 MiB Rust binary,
not a stack. Static site, no server, deployed to Cloudflare Pages.

**Positioning, decided by the user:** "self-hosted coding agent" is now generic — every
project claims it. The site leads with *minimal, not bloated*, because that is the claim
the measurements actually support. `self-hosted` stays true and stays in the copy as a
fact; it never appears in a headline.

**Before writing any copy, read [`docs/FACTS.md`](docs/FACTS.md).** It is the only
source of truth for numbers and claims. Inventing a feature is the worst possible
failure here — this product's pitch is that it tells you what it does and what it
refuses to do.

## Stack, and what not to add

| | |
| --- | --- |
| Framework | Astro 6 (static output) |
| Node | whatever is on `PATH` (currently 22.22.2). Astro 7 needs 22.23.4+ — do **not** upgrade Astro. |
| Styling | plain CSS: global design tokens + **scoped `<style>` blocks in each component** |
| JS | vanilla TypeScript in `<script>` tags that Astro bundles. No framework, no islands, no hydration. |
| Fonts | self-hosted Inter + JetBrains Mono woff2 in `public/fonts`, **subset** to Latin-1 + punctuation (80 KB total, see the comment in `src/styles/fonts.css`) |

Do **not** add Tailwind, a component library, an icon package, an animation library,
a font from a CDN, or any runtime dependency. `@astrojs/check` is already installed as
the one dev dependency for `npm run check` — do not add more. If you believe something is genuinely
required, stop and say so in your report instead of installing it.

```bash
npm run dev      # http://localhost:4321
npm run build    # must exit 0 — this is the gate
npm run preview  # serve dist/ (does NOT apply public/_headers)
npm run check    # types + build + link/fragment/alt audit + CSP hashes; run this
```

**CSP:** `public/_headers` ships a strict policy with **no `'unsafe-inline'` in
`script-src`**. Astro inlines each component's small script, so `npm run build`
rewrites `dist/_headers` with a `sha256` of every inline block
(`scripts/csp-hashes.mjs`). Two consequences: never hand-edit the CSP in `dist/`
(it is generated), and if you add a script that is injected at runtime —
`document.createElement('script')`, an inline `onclick=`, `eval` — the policy will
block it and `npm run check` cannot save you. Add it as a bundled `<script>` in a
component instead.

## Look and feel

The brand is **warm charcoal, paper text, one gold accent**. It is a dark product for
people who live in a terminal. The site should feel like a well-set technical
document printed on good paper — not a SaaS landing page, not a neon developer tool.

Reference points, and what we are taking from each:

- **omp.sh** — dark canvas, numbered spine down the page, install block with tabs and copy.
- **pi.dev** — long-form editorial sections, hairline rules, a plain "what we didn't build" list.
- **Hermes Agent** — mono uppercase micro-labels, a real product frame, a feature grid with weight.
- **Google Antigravity** — airy hero, restrained particle field, a giant wordmark in the footer.
- **OpenAI Codex** — monochrome restraint: let the product and the type carry the page.

### Hard rules

1. **Colour comes from tokens only.** No literal hex outside `src/styles/tokens.css`.
   Gold is an accent — it marks the actionable thing. Never set gold text on a gold
   surface. Never introduce a hue that is not in the palette (no teal, no violet,
   no pink accents).
2. **Two typefaces.** Inter for text and headings, JetBrains Mono for anything
   code-shaped *or* meta (section numbers, kickers, labels, stats, env vars). No third.
3. **Type scale.** Use `--fs-*` and the `.display/.h1/.h2/.h3/.lede` classes. Don't
   invent sizes between 13px and 18px — that band is what makes pages read as mush.
   Micro-labels are mono, uppercase, `0.15em` tracking.
4. **Headlines are sentence case.** No Title Case, no ALL CAPS headlines.
5. **Radius and shadow from tokens** (`--kc-radius*`, `--shadow`).
6. **One idea per section.** A section is: mono kicker + number, a claim as an `h2`,
   one sentence of support, then the visual evidence. No paragraph longer than ~3 lines
   at desktop width.
7. **Visual evidence over adjectives.** A real command, a real number, a real diagram,
   a real screenshot. If a section is only text, it is not finished.
8. **Motion is a whisper.** Reveal on scroll (`.reveal`), hover transitions of
   150–300 ms, one signature animated moment on the page (the hero). Nothing loops
   forever in the periphery, nothing hijacks the scroll, and everything respects
   `prefers-reduced-motion` — when in doubt, render the final state immediately.
9. **Density.** Use the page width. Big type, generous whitespace, hairline dividers.
   Avoid the generic "row of three identical rounded cards with an emoji icon".

### Accessibility (non-negotiable)

- Body copy ≥ 4.5:1 against its background. `--text-3` (`#8b8d8c`) is the floor on
  dark — do not use it for anything smaller than 13px.
- Real landmarks: one `h1` per page, headings in order, `<section>` with an accessible
  name (`aria-labelledby`) where it helps.
- Every interactive control is a `<button>` or `<a>`, keyboard reachable, with a
  visible focus state (the global `:focus-visible` ring is already gold).
- Decorative SVG/canvas: `aria-hidden="true"`. Informative images: real `alt`.
- Interactive demos must work with the keyboard and announce state changes.
- `width`/`height` on every `<img>` to prevent layout shift.

### Performance budget

- 0 KB of framework JS. Total page JS should stay under ~25 KB gzipped.
- Animate only `transform` and `opacity`. Canvas work must cap DPR at 2, pause when
  offscreen or when the tab is hidden, and stop entirely under reduced motion.
- `loading="lazy"` + `decoding="async"` for below-the-fold images.
- No web font outside the three already in `public/fonts`.

## File ownership — read this before you edit

Parallel agents work in this repo at the same time. **Only touch the files assigned to
you.** If you need a change outside your area, describe it in your final report instead
of making it.

| Owner | Paths |
| --- | --- |
| shared / do not modify | `package.json`, `astro.config.mjs`, `tsconfig.json`, `src/styles/**`, `src/layouts/Base.astro`, `src/site.ts`, `src/components/ui/**`, `src/pages/index.astro`, `AGENTS.md`, `docs/**` |
| hero agent | `src/components/hero/**` |
| sections agent | `src/components/sections/**` |
| docs agent | `src/pages/docs/**`, `src/pages/security.astro`, `src/layouts/Docs.astro`, `src/components/docs/**` |

`src/pages/index.astro` already imports every home component and owns the numbered
rail. Each section component is a placeholder with the right file name — replace the
body, keep the component's default export.

## Shared pieces you should use

```astro
import SectionHead from '../ui/SectionHead.astro';
import Cmd from '../ui/Cmd.astro';
import { SITE } from '../../site';

<SectionHead num="03" kicker="Approvals" title="…" lede="…" id="approvals" />
<Cmd label="shell" command="cargo run --release -p kc-server" />
```

Global classes in `base.css`: `wrap`, `wrap--wide`, `section`, `section--tight`,
`grid grid--2|3|4|split`, `display`, `h1`, `h2`, `h3`, `lede`, `label`, `label__num`,
`mono`, `card`, `panel`, `code`, `prose`, `table-wrap`, `reveal`, `tick`, `link`,
`btn btn--primary|btn--lg`, `on-light`, `hairline`, `vh`.

## Anchors that other things link to

Keep these exact ids on the home page: `what-it-does`, `architecture`, `approvals`,
`performance`, `limitations`, `install`, `faq`. Nav, footer and rail link to them.

## Definition of done

1. `npm run check` exits 0 (types, build, the link audit, and the CSP hash check).
2. You looked at the result in a real browser (`npm run dev`, then a screenshot) at
   1440 px **and** 390 px. Not "it compiles" — actually looked at it.
3. No console errors, no horizontal scrollbar at 390 px.
4. Every claim traces back to `docs/FACTS.md`.
5. Your section has one non-text piece of evidence (diagram, real output, number,
   screenshot, interactive control).

Report back: files you created or changed, what you verified, anything you had to
leave undone, and anything you think a human should look at.
