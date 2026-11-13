// @ts-check
import { defineConfig } from 'astro/config';

// Static output: `astro build` emits dist/, which is what Cloudflare Pages serves.
export default defineConfig({
  site: 'https://code.karutoil.site',
  output: 'static',
  trailingSlash: 'ignore',
  build: { assets: '_assets', inlineStylesheets: 'auto' },
  compressHTML: true,
  prefetch: { prefetchAll: true, defaultStrategy: 'viewport' },
  devToolbar: { enabled: false },
  markdown: {
    // The docs are typed, not published: token colours from a highlighter theme
    // would be the only place on this site where a hue is not from tokens.css.
    // `base.css` styles `.prose pre` in the site's own greys and gold.
    syntaxHighlight: false,
  },
});
