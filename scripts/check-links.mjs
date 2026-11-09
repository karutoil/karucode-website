#!/usr/bin/env node
// Post-build link audit: every internal href/src in dist/ must resolve to a real
// file, and every #fragment must exist as an id on the target page.
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative } from 'node:path';

const DIST = 'dist';
const errors = [];
const htmlFiles = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (extname(entry.name) === '.html') htmlFiles.push(p);
  }
}
if (!existsSync(DIST)) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}
walk(DIST);

const idsByPage = new Map();
for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const ids = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) ids.add(m[1]);
  idsByPage.set(file, ids);
}

/** /docs/quickstart/ | /docs/quickstart | /docs/quickstart/index.html -> a dist file */
function resolveInternal(pathname) {
  const clean = decodeURI(pathname.startsWith('/') ? pathname : `/${pathname}`);
  const candidates = [
    join(DIST, clean),
    join(DIST, clean, 'index.html'),
    join(DIST, `${clean}.html`),
    join(DIST, `${clean}/index.html`),
  ];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile() && extname(c) === '.html') return c;
    if (existsSync(c) && statSync(c).isFile() && extname(c) !== '') return c;
  }
  return null;
}

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const page = '/' + relative(DIST, file).replace(/index\.html$/, '').replace(/\\/g, '/');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = m[1];
    if (!url || url.startsWith('http') || url.startsWith('mailto:') || url.startsWith('data:')) continue;
    if (url === '#') {
      errors.push(`${page}: empty fragment href="#"`);
      continue;
    }
    const [pathname, fragment] = url.split('#');
    const target = pathname === '' ? file : resolveInternal(pathname);

    if (!target) {
      errors.push(`${page}: missing target ${url}`);
      continue;
    }
    if (fragment) {
      const ids = idsByPage.get(target);
      if (ids && !ids.has(fragment)) errors.push(`${page}: ${url} — no id="${fragment}" on ${relative(DIST, target)}`);
    }
  }

  // cheap structural checks that catch the usual regressions
  const h1s = [...html.matchAll(/<h1[\s>]/g)].length;
  if (h1s !== 1) errors.push(`${page}: ${h1s} <h1> elements (expected exactly 1)`);
  if (/<img (?![^>]*\balt=)[^>]*>/.test(html)) errors.push(`${page}: <img> without alt`);
  if (/<img (?![^>]*\bwidth=)[^>]*>/.test(html)) errors.push(`${page}: <img> without width`);
}

console.log(`checked ${htmlFiles.length} page(s)`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):`);
  for (const e of errors) console.error('  • ' + e);
  process.exit(1);
}
console.log('all internal links, fragments, alt text and single-h1 checks pass');
