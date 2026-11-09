#!/usr/bin/env node
/**
 * Rewrite dist/_headers with a hash-based script-src.
 *
 * Astro inlines every small component script into the page, so a strict
 * `script-src 'self'` would block the nav, tabs, approvals demo and progress bar.
 * The alternative to 'unsafe-inline' is listing a sha256 of each inline block,
 * which only works if the hashes are computed from the built HTML — so this runs
 * after `astro build`, never before.
 *
 *   node scripts/csp-hashes.mjs          rewrite dist/_headers
 *   node scripts/csp-hashes.mjs --check  exit 1 if dist/_headers is stale
 *
 * Only executable scripts are hashed. `<script type="application/ld+json">` is a
 * data block that is never executed, so CSP does not check it and its hash would
 * be noise in the header.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const NO_JS = /^(application\/(ld\+)?json|text\/template|application\/importmap)$/i;

/** Every .html file under dist, at any depth. */
function htmlFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) out.push(...htmlFiles(path));
    else if (name.endsWith('.html')) out.push(path);
  }
  return out;
}

/** Inline, executable <script> bodies, hashed exactly as they appear in the file. */
function inlineHashes(html) {
  const hashes = new Set();
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  for (const [, attrs, body] of html.matchAll(re)) {
    if (/\bsrc\s*=/i.test(attrs)) continue; // external file, allowed by 'self'
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    if (type && NO_JS.test(type)) continue; // data block, never executed
    if (!body.trim()) continue;
    const digest = createHash('sha256').update(body, 'utf8').digest('base64');
    hashes.add(`'sha256-${digest}'`);
  }
  return hashes;
}

const files = htmlFiles(DIST);
const all = new Set();
for (const file of files) {
  for (const h of inlineHashes(readFileSync(file, 'utf8'))) all.add(h);
}
const sources = [`'self'`, ...[...all].sort()].join(' ');

const headersPath = join(DIST, '_headers');
if (!existsSync(headersPath)) {
  console.error(`csp-hashes: ${headersPath} is missing — did astro build run?`);
  process.exit(1);
}

const original = readFileSync(headersPath, 'utf8');
const line = /^(\s*Content-Security-Policy:\s*)(.*)$/m;
if (!line.test(original)) {
  console.error('csp-hashes: no Content-Security-Policy line in dist/_headers');
  process.exit(1);
}

const updated = original.replace(line, (_m, prefix, policy) => {
  if (!/script-src[^;]*/.test(policy)) {
    console.error('csp-hashes: the policy has no script-src directive');
    process.exit(1);
  }
  const next = policy.replace(/script-src[^;]*/, `script-src ${sources}`);
  return prefix + next;
});

if (process.argv.includes('--check')) {
  if (updated !== original) {
    console.error(
      `csp-hashes: dist/_headers is stale — ${all.size} inline script hash(es) ` +
        'do not match the built pages. Run `npm run build`.',
    );
    process.exit(1);
  }
  console.log(`csp-hashes: ok — ${all.size} inline script hashes match ${files.length} pages`);
  process.exit(0);
}

writeFileSync(headersPath, updated);
if (/script-src[^;]*'unsafe-inline'/.test(updated)) {
  console.error('csp-hashes: script-src still contains unsafe-inline');
  process.exit(1);
}
console.log(
  `csp-hashes: ${all.size} inline script hashes across ${files.length} pages -> dist/_headers`,
);
