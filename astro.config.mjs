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
});
