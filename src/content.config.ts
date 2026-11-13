import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * The documentation is not stored in this repository. `scripts/sync-docs.mjs`
 * stages it from the karucode repository into `.karucode-docs/md/` (gitignored)
 * before every `dev`, `build` and `check`, and the entry id is the page id from
 * `.karucode-docs/manifest.ts` — `home`, `quickstart`, `reference/approvals`, …
 *
 * There is no frontmatter to validate: the repo's markdown is plain GFM with its
 * title in the first `#` line, which the sync script lifts out for the layout.
 * Everything else a page needs (summary, section, order, edit URL) comes from
 * the manifest, so a doc gaining a paragraph never touches this site.
 */
const docs = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './.karucode-docs/md' }),
});

export const collections = { docs };