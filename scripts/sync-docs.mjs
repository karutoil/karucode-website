#!/usr/bin/env node
/**
 * Stage the karucode repository's documentation for this site.
 *
 * The website does not own documentation. The karucode repository does — one
 * `@kc-doc`-generated reference topic per behaviour, plus handbooks under
 * `docs/` — and its `docs/WEBSITE.md` already specifies how that tree is
 * imported by a static site generator. This script is that import, for Astro:
 *
 *   mkdocs.yml                 -> which pages exist, in what order, titled how
 *   docs/internal/index.json   -> the authoritative reference-topic metadata
 *   docs/**\/*.md + root pages -> the bodies
 *
 * Whatever the repository gains, the site gains: add a topic and run
 * `cargo run -p kc-docs -- --write`, add a handbook and give it a nav line, and
 * the next build publishes it at /docs/<name>/. Nothing here lists the pages.
 *
 * Output is `.karucode-docs/`, which is gitignored on purpose: a committed copy
 * would be the duplicate this whole thing exists to avoid.
 *
 *   node scripts/sync-docs.mjs                 # resolve, fetch, stage
 *   node scripts/sync-docs.mjs --source ../karucode   # use a checkout
 *   node scripts/sync-docs.mjs --ref main      # a branch, tag or commit (default: main)
 *   node scripts/sync-docs.mjs --check         # exit 1 if upstream moved
 *
 * Environment: KARUCODE_REPO (checkout path), KARUCODE_DOCS_REF (ref),
 * GITHUB_TOKEN is NOT needed — the source is fetched with `git ls-remote` plus a
 * codeload tarball, so a build never depends on the API's per-IP rate limit.
 *
 * Link rewriting follows `scripts/build_site.py` in the karucode repository: a
 * link to another doc becomes that doc's URL here, a link to a file in the
 * repository becomes a github.com URL, and fenced or inline code is never
 * touched. The one difference is the destination: mkdocs keeps the tree, this
 * site flattens it (see `siteId`).
 */

import { execFileSync } from 'node:child_process';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const SLUG = 'karutoil/karucode';
const REPO_URL = `https://github.com/${SLUG}`;
const DEFAULT_REF = 'main';
const OUT = '.karucode-docs';
const CACHE = '.karucode-docs-cache';
/** Root files that are pages of the documentation site. */
const ROOT_PAGES = ['README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md'];
/** Navigation sections that are not product documentation. */
const SKIP_SECTIONS = new Set(['Design']);
/** Where a nav entry that is not part of a section goes. */
const SINGLES_SECTION = 'Project';
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist', '.astro', 'site', '.site-docs']);

// ─── arguments ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { source: null, ref: null, check: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inline] = arg.split('=');
    const value = () => inline ?? argv[++i];
    if (key === '--source') args.source = value();
    else if (key === '--ref') args.ref = value();
    else if (key === '--check') args.check = true;
    else if (key === '--quiet') args.quiet = true;
    else if (key === '--help' || key === '-h') {
      console.log(
        'usage: node scripts/sync-docs.mjs [--source <checkout>] [--ref <ref>] [--check] [--quiet]',
      );
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

const log = (message) => console.log(`docs: ${message}`);
const warn = (message) => console.warn(`docs: warning: ${message}`);

// ─── source: a checkout, or the published tree at a pinned commit ────────────

/**
 * A source exposes every file path in the repository, whether a path is a
 * directory, and a reader for its contents.
 */
async function openSource(args) {
  if (args.ref && !args.source) {
    return openRemote(args.ref);
  }
  const local =
    args.source ??
    process.env.KARUCODE_REPO ??
    (existsSync(join('..', 'karucode', 'docs')) ? join('..', 'karucode') : null);
  if (local) return openCheckout(resolve(local));
  return openRemote(process.env.KARUCODE_DOCS_REF ?? DEFAULT_REF);
}

async function openCheckout(root) {
  if (!existsSync(join(root, 'docs'))) throw new Error(`${root} has no docs/ directory`);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  let sha = '';
  let date = null;
  try {
    sha = git('rev-parse', 'HEAD');
    date = git('log', '-1', '--format=%cI');
  } catch {
    warn(`${root} is not a git checkout — provenance will be weaker`);
  }
  // Untracked files count: a new doc is reviewed before it is committed, and a
  // local build should show it. Ignored build output never matches a nav entry.
  const files = new Set(await walk(root, ''));
  return finishSource({
    kind: 'checkout',
    label: root,
    ref: 'worktree',
    sha,
    date,
    files,
    read: (path) => readFile(join(root, path), 'utf8'),
  });
}

async function walk(root, prefix) {
  const out = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(root, path)));
    else out.push(path);
  }
  return out;
}

async function openRemote(ref) {
  const sha = lsRemote(ref);
  const cacheRoot = join(CACHE, sha);
  const stamp = join(cacheRoot, '.extracted');
  let root = cacheRoot;

  if (existsSync(stamp)) {
    log(`using cached archive for ${sha.slice(0, 7)}`);
  } else {
    await rm(cacheRoot, { recursive: true, force: true });
    await mkdir(cacheRoot, { recursive: true });
    const url = `https://codeload.github.com/${SLUG}/tar.gz/${sha}`;
    const tarball = join(cacheRoot, 'source.tar.gz');
    log(`fetching ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} -> HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(tarball));
    // `--strip-components=1` drops the `karucode-<sha>/` wrapper the archive adds.
    execFileSync('tar', ['-xzf', tarball, '-C', cacheRoot, '--strip-components=1'], {
      stdio: 'inherit',
    });
    await rm(tarball, { force: true });
    await writeFile(stamp, sha);
  }

  const files = new Set(await walk(root, ''));
  return finishSource({
    kind: 'github',
    label: `${SLUG}@${ref}`,
    ref,
    sha,
    date: null,
    files,
    read: (path) => readFile(join(root, path), 'utf8'),
  });
}

/** The commit sha for a ref, without the REST API (and without its rate limit). */
function lsRemote(ref) {
  if (/^[0-9a-f]{40}$/i.test(ref)) return ref;
  const output = execFileSync('git', ['ls-remote', `${REPO_URL}.git`, ref], { encoding: 'utf8' });
  const exact = output.split('\n').find((line) => line.endsWith(`\trefs/heads/${ref}`));
  const tag = output.split('\n').find((line) => line.endsWith(`\trefs/tags/${ref}^{}`));
  const match = exact ?? tag ?? output.split('\n').find((line) => line.trim());
  if (!match) throw new Error(`git ls-remote found no ref named ${ref}`);
  return match.split('\t')[0];
}

function finishSource(source) {
  const dirs = new Set(['']);
  for (const file of source.files) {
    for (let dir = posix.dirname(file); dir && dir !== '.'; dir = posix.dirname(dir)) {
      dirs.add(dir);
    }
  }
  return { ...source, dirs, has: (path) => source.files.has(path), isDir: (path) => dirs.has(path) };
}

// ─── reading the repository's own documentation index ────────────────────────

/**
 * `nav:` from mkdocs.yml, as groups of pages. The repository already has to keep
 * this list honest: its own site builds with `--strict` and
 * `scripts/gen_docs_nav.py --check` fails when the Reference section drifts.
 */
function parseNav(text) {
  const groups = [];
  let inNav = false;
  let navIndent = 0;
  let current = null;

  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!inNav) {
      if (/^nav:\s*$/.test(line)) inNav = true;
      continue;
    }
    if (!line.trim()) continue;
    if (/^\S/.test(line)) break; // the next top-level key ends the nav block
    const indent = line.length - line.trimStart().length;
    if (!navIndent) navIndent = indent;
    const match = /^-\s+([^:]+):\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    const title = unquote(match[1].trim());
    const target = unquote(match[2].trim());
    if (target) {
      const page = { title, path: target };
      // A top-level `- Title: file` is a page that belongs to no section.
      if (current && indent > navIndent) current.items.push(page);
      else groups.push({ name: title, items: [page], single: true });
    } else {
      current = { name: title, items: [] };
      groups.push(current);
    }
  }
  return groups.filter((group) => group.items.length);
}

const unquote = (value) => value.replace(/^(['"])(.*)\1$/, '$2');

async function readNav(source) {
  if (!source.has('mkdocs.yml')) {
    throw new Error('mkdocs.yml is missing from the source — cannot tell which docs are pages');
  }
  const groups = parseNav(await source.read('mkdocs.yml'));
  if (!groups.length) throw new Error('mkdocs.yml has no nav: block this script can read');
  return groups;
}

async function readReferenceIndex(source) {
  const path = 'docs/internal/index.json';
  if (!source.has(path)) return { topics: [] };
  const data = JSON.parse(await source.read(path));
  const topics = Array.isArray(data.topics) ? data.topics : [];
  return {
    topics: topics.map((topic) => ({
      path: posix.join('docs/internal', topic.path),
      slug: topic.slug,
      title: topic.title,
      summary: topic.summary ?? '',
      tags: topic.tags ?? [],
      appliesTo: topic.applies_to ?? [],
      source: topic.source ?? '',
    })),
  };
}

// ─── the page plan: every doc -> an id, a URL, a title, a section ────────────

function planPages(source, groups, index) {
  const referencePaths = new Set(index.topics.map((topic) => topic.path));
  const indexByPath = new Map(index.topics.map((topic) => [topic.path, topic]));
  const pageByPath = new Map();
  const pages = [];

  /** docs/internal/<name>.md -> reference/<name>; docs/<NAME>.md -> <name>. */
  const siteId = (repoPath) => {
    if (repoPath === 'README.md') return 'home';
    if (repoPath.startsWith('docs/internal/')) {
      const slug = repoPath.slice('docs/internal/'.length).replace(/\.md$/, '');
      return `${referencePaths.has(repoPath) ? 'reference' : 'internal'}/${slug}`;
    }
    if (repoPath.startsWith('docs/')) return repoPath.slice('docs/'.length).replace(/\.md$/, '');
    return repoPath.replace(/\.md$/, '').replace(/^.*\//, '');
  };

  const add = (repoPath, title, section) => {
    if (pageByPath.has(repoPath)) return pageByPath.get(repoPath);
    if (!source.has(repoPath)) return null;
    const id = siteId(repoPath).replace(/[A-Z]/g, (c) => c.toLowerCase());
    const meta = indexByPath.get(repoPath);
    const page = {
      id,
      path: repoPath,
      url: id === 'home' ? '/docs/' : `/docs/${id}/`,
      title: meta?.title ?? title,
      summary: meta?.summary ?? '',
      section: meta ? 'Reference' : section,
      order: 0,
      edit: `${REPO_URL}/blob/${source.ref === 'worktree' ? 'main' : source.ref}/${repoPath}`,
      tags: meta?.tags ?? [],
      appliesTo: meta?.appliesTo ?? [],
      reference: Boolean(meta),
    };
    pageByPath.set(repoPath, page);
    if (id !== 'home') pages.push(page);
    return page;
  };

  let singles = [];
  for (const group of groups) {
    if (SKIP_SECTIONS.has(group.name)) continue;
    if (group.single) {
      singles.push(...group.items);
      continue;
    }
    for (const item of group.items) {
      // Nav paths are relative to docs/, except the root pages staged beside it.
      const repoPath = ROOT_PAGES.includes(item.path) ? item.path : posix.join('docs', item.path);
      if (!add(repoPath, item.title, group.name)) {
        throw new Error(
          `mkdocs.yml lists "${item.path}" in the ${group.name} section, but ${repoPath} is not ` +
            'in the source. Push the doc (or drop the nav entry) before building the site.',
        );
      }
    }
  }
  for (const item of singles) {
    const repoPath = ROOT_PAGES.includes(item.path) ? item.path : posix.join('docs', item.path);
    if (!add(repoPath, item.title, item.path === 'README.md' ? 'Docs' : SINGLES_SECTION)) {
      warn(`mkdocs.yml lists "${item.path}" but it is not in the source — skipped`);
    }
  }
  // A topic that exists but is not in the nav yet must not be invisible here:
  // `cargo run -p kc-docs -- --write` is the step that creates it, and
  // `gen_docs_nav.py` is the step that remembers the nav.
  for (const topic of index.topics) {
    if (pageByPath.has(topic.path)) continue;
    if (!source.has(topic.path)) {
      warn(`index.json lists ${topic.path}, which is not in the source — skipped`);
      continue;
    }
    log(`adding ${topic.path} (in index.json but not in mkdocs.yml nav)`);
    add(topic.path, topic.title, 'Reference');
  }

  pages.forEach((page, i) => {
    page.order = i;
  });

  const home = pageByPath.get('README.md');
  if (!home) throw new Error('README.md is missing from the source — it is the docs home page');

  const urls = new Set([home.url]);
  for (const page of pages) {
    if (urls.has(page.url)) throw new Error(`two docs map to ${page.url}: ${page.path}`);
    urls.add(page.url);
  }

  const sectionOrder = [];
  for (const page of [home, ...pages]) {
    if (!sectionOrder.includes(page.section)) sectionOrder.push(page.section);
  }
  const groupsOut = sectionOrder
    .filter((name) => name !== 'Docs')
    .map((name) => ({
      name,
      urls: [home, ...pages].filter((p) => p.section === name && p.id !== 'home').map((p) => p.url),
    }))
    .filter((group) => group.urls.length);

  return { home, pages, pageByPath, groups: groupsOut, referencePaths };
}

// ─── rewriting the bodies for this site's URLs ───────────────────────────────

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const FENCE = /^\s*(```|~~~)/;
const INLINE_CODE = /(`+)([^`\n]+?)\1/g;
const MD_LINK = /(!?\[[^\]]*\]\()([^)\s]+)((?:\s+"[^"]*")?\))/g;
const HTML_ATTR = /(\s(?:src|href)=")([^"]+)(")/g;

function splitSuffix(target) {
  const match = /^([^?#]*)([?#].*)?$/.exec(target);
  return match ? [match[1], match[2] ?? ''] : [target, ''];
}

/**
 * Where a link in `fromPath` should point on this site, or `null` to leave it
 * exactly as written. Anything that leaves the repository keeps working because
 * it becomes a github.com URL; anything that stays and is a page becomes a route.
 */
function rewriteTarget(target, { fromPath, source, pageByPath, kind }) {
  if (!target || target.startsWith('#') || target.startsWith('/')) return null;
  if (SCHEME.test(target) || target.startsWith('//')) return null;

  const [pathPart, suffix] = splitSuffix(target);
  if (!pathPart) return null;

  const base = ROOT_PAGES.includes(fromPath) ? '' : posix.dirname(fromPath);
  const norm = posix.normalize(posix.join(base, pathPart)).replace(/\/$/, '');
  if (norm.startsWith('..')) return null; // outside the repository: not ours

  // A directory is not a page: its README is, otherwise it is a tree on GitHub.
  const readme = norm ? `${norm}/README.md` : 'README.md';
  const page = pageByPath.get(norm) ?? (source.isDir(norm) ? pageByPath.get(readme) : null);
  if (page) return page.url + suffix;

  if (source.has(norm)) {
    return kind === 'image'
      ? `https://raw.githubusercontent.com/${SLUG}/${source.ref === 'worktree' ? DEFAULT_REF : source.ref}/${norm}${suffix}`
      : `${REPO_URL}/blob/${source.ref === 'worktree' ? DEFAULT_REF : source.ref}/${norm}${suffix}`;
  }
  if (source.isDir(norm)) {
    return `${REPO_URL}/tree/${source.ref === 'worktree' ? DEFAULT_REF : source.ref}/${norm}${suffix}`;
  }
  return null;
}

/** Inline code is not a link, but a link's text often is code. Keep spans whole. */
function protectCode(line) {
  const saved = [];
  const text = line.replace(INLINE_CODE, (span) => {
    saved.push(span);
    return `\u0000${saved.length - 1}\u0000`;
  });
  return { text, saved };
}

function restoreCode(line, saved) {
  return saved.reduce((out, span, i) => out.replace(`\u0000${i}\u0000`, span), line);
}

function rewriteLine(line, context) {
  const { text, saved } = protectCode(line);
  const swapped = text
    .replace(MD_LINK, (match, open, target, close) => {
      const kind = open.startsWith('!') ? 'image' : 'link';
      const next = rewriteTarget(target, { ...context, kind });
      return next === null ? match : `${open}${next}${close}`;
    })
    .replace(HTML_ATTR, (match, open, target, close) => {
      const kind = open.includes('src') ? 'image' : 'link';
      const next = rewriteTarget(target, { ...context, kind });
      return next === null ? match : `${open}${next}${close}`;
    });
  return restoreCode(swapped, saved);
}

function rewriteBody(body, context) {
  const out = [];
  let fenced = false;
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      out.push(line);
      continue;
    }
    out.push(fenced ? line : rewriteLine(line, context));
  }
  return out.join('\n');
}

/** The `# Title` that the docs layout renders itself, and the generator's header. */
function stripLeadingTitle(text) {
  const lines = text.split('\n');
  let i = 0;
  // Generated topics open with `<!-- @generated … -->`: true in the repository,
  // noise on a page whose footer already says where it came from.
  for (;;) {
    if (i >= lines.length) break;
    if (!lines[i].trim()) {
      i++;
      continue;
    }
    if (lines[i].trimStart().startsWith('<!--')) {
      while (i < lines.length && !lines[i].includes('-->')) i++;
      i++;
      continue;
    }
    break;
  }
  const match = /^#\s+(.+?)\s*#*\s*$/.exec(lines[i] ?? '');
  if (!match) return { title: null, body: lines.slice(i).join('\n') };
  lines.splice(i, 1);
  while (i < lines.length && !lines[i].trim()) lines.splice(i, 1);
  return { title: plain(match[1]), body: lines.slice(i).join('\n') };
}

/**
 * A generated topic repeats its one-line summary as a blockquote under the
 * title. The layout shows that summary as the lede, so the quote would be the
 * same sentence twice — use it as the summary and drop the block.
 */
function absorbSummaryQuote(body, summary) {
  const lines = body.split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  if (!(lines[i] ?? '').trimStart().startsWith('>')) return { body, summary };
  let end = i;
  while (end < lines.length && (lines[end].trimStart().startsWith('>') || !lines[end].trim())) end++;
  const quote = plain(
    lines
      .slice(i, end)
      .map((line) => line.replace(/^\s*>\s?/, ''))
      .join(' ')
      .trim(),
  );
  if (!quote) return { body, summary };
  if (!summary) return { body: [...lines.slice(0, i), ...lines.slice(end)].join('\n'), summary: quote };
  const same = (a, b) => a.toLowerCase().replace(/[\s.!?…]+$/, '') === b.toLowerCase().replace(/[\s.!?…]+$/, '');
  if (!same(quote, summary)) return { body, summary };
  return { body: [...lines.slice(0, i), ...lines.slice(end)].join('\n'), summary };
}

const plain = (text) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/<[^>]+>/g, '')
    .trim();

/**
 * The README is a repository front door: a centred masthead, shields.io badges
 * and a note about release tarballs. On a page of this site those are furniture
 * from another room (and the badges are third-party requests the CSP forbids).
 */
function stripReadmeFurniture(text) {
  const lines = text.split('\n');
  const rule = lines.findIndex((line) => line.trim() === '---');
  if (rule === -1) return text;
  let i = rule + 1;
  const isBlanking = (line) => !line.trim() || line.trimStart().startsWith('>');
  while (i < lines.length && isBlanking(lines[i])) i++;
  return lines.slice(i).join('\n');
}

/** The first paragraph is the page's lede when the repo has no summary for it. */
function firstParagraph(body) {
  let fenced = false;
  for (const block of body.split(/\n\s*\n/)) {
    const block_ = block.trim();
    if (!block_) continue;
    if (FENCE.test(block_)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^(#|>|\||<|\s*[-*+] |\s*\d+\. |\s{4})/.test(block_)) continue;
    const text = plain(block_.replace(/\n/g, ' '));
    if (text.length < 12) continue;
    return text.length > 240 ? `${text.slice(0, 237).replace(/[ ,;:]+\S*$/, '')}…` : text;
  }
  return '';
}

// ─── staging ─────────────────────────────────────────────────────────────────

async function stage(source, plan) {
  const mdRoot = join(OUT, 'md');
  await rm(mdRoot, { recursive: true, force: true });
  await mkdir(mdRoot, { recursive: true });

  for (const page of [plan.home, ...plan.pages]) {
    let body = await source.read(page.path);
    if (page.path === 'README.md') body = stripReadmeFurniture(body);
    const stripped = stripLeadingTitle(body);
    // "Home" is the repository's nav label for README.md, not a page title.
    const title = stripped.title ?? page.title;
    page.title = !title || /^(home|readme)$/i.test(title) ? 'Documentation' : title;
    const absorbed = absorbSummaryQuote(stripped.body, page.summary);
    page.summary = absorbed.summary;
    body = rewriteBody(absorbed.body, {
      fromPath: page.path,
      source,
      pageByPath: plan.pageByPath,
    });
    if (!page.summary) page.summary = firstParagraph(body);

    const file = join(mdRoot, `${page.id}.md`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, `${body.replace(/^\n+/, '').trimEnd()}\n`);
  }

  const byUrl = new Map([plan.home, ...plan.pages].map((page) => [page.url, page]));
  const manifest = {
    source: {
      kind: source.kind,
      label: source.label,
      ref: source.ref,
      sha: source.sha,
      date: source.date,
      repo: REPO_URL,
    },
    generated: new Date().toISOString(),
    home: plan.home,
    pages: plan.pages,
    groups: plan.groups,
    counts: {
      pages: plan.pages.length + 1,
      reference: plan.pages.filter((page) => page.reference).length,
      sections: plan.groups.length,
    },
  };
  for (const group of manifest.groups) {
    for (const url of group.urls) if (!byUrl.has(url)) throw new Error(`unknown url ${url}`);
  }

  await writeFile(
    join(OUT, 'manifest.ts'),
    [
      '// @generated by scripts/sync-docs.mjs — do not edit.',
      '// The source of truth is the karucode repository; rerun `npm run sync:docs`.',
      '',
      'export interface DocPage {',
      '  id: string;',
      '  path: string;',
      '  url: string;',
      '  title: string;',
      '  summary: string;',
      '  section: string;',
      '  order: number;',
      '  edit: string;',
      '  tags: string[];',
      '  appliesTo: string[];',
      '  reference: boolean;',
      '}',
      '',
      'export interface DocGroup {',
      '  name: string;',
      '  urls: string[];',
      '}',
      '',
      'export interface DocsManifest {',
      '  source: {',
      '    kind: string;',
      '    label: string;',
      '    ref: string;',
      '    sha: string;',
      '    date: string | null;',
      '    repo: string;',
      '  };',
      '  generated: string;',
      '  home: DocPage;',
      '  pages: DocPage[];',
      '  groups: DocGroup[];',
      '  counts: { pages: number; reference: number; sections: number };',
      '}',
      '',
      `export const DOCS: DocsManifest = ${JSON.stringify(manifest, null, 2)};`,
      '',
    ].join('\n'),
  );
  await writeFile(join(OUT, 'statesha'), `${source.sha}\n`);
  return manifest;
}

async function updateSitemap(manifest) {
  const origin = 'https://code.karutoil.site';
  const urls = [
    { loc: `${origin}/`, priority: '1.0' },
    { loc: `${origin}/docs/`, priority: '0.9' },
    { loc: `${origin}/docs/reference/`, priority: '0.8' },
    ...manifest.pages.map((page) => ({
      loc: `${origin}${page.url}`,
      priority: page.reference ? '0.6' : '0.8',
    })),
  ];
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${u.loc}</loc><priority>${u.priority}</priority></url>`),
    '</urlset>',
    '',
  ].join('\n');
  await writeFile('public/sitemap.xml', xml);
}

// ─── entry point ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const source = await openSource(args);
  const from = source.kind === 'checkout' ? source.label : source.label;
  log(`${from} ${source.sha ? `@ ${source.sha.slice(0, 7)}` : ''}`.trim());

  if (args.check) {
    const previous = existsSync(join(OUT, 'statesha'))
      ? (await readFile(join(OUT, 'statesha'), 'utf8')).trim()
      : '';
    if (previous === source.sha) {
      log(`docs are current at ${source.sha.slice(0, 7)}`);
      return;
    }
    console.error(
      `docs: the source moved: ${previous ? previous.slice(0, 7) : 'never synced'} -> ${source.sha.slice(0, 7)}\n` +
        'docs: run `npm run sync:docs && npm run check` and deploy to publish it.',
    );
    process.exit(1);
  }

  const groups = await readNav(source);
  const index = await readReferenceIndex(source);
  const plan = planPages(source, groups, index);
  const manifest = await stage(source, plan);
  await updateSitemap(manifest);

  const reference = manifest.counts.reference;
  log(
    `staged ${manifest.counts.pages} pages (${reference} reference topics, ` +
      `${manifest.counts.pages - reference} handbooks) in ${OUT}/`,
  );
  for (const group of manifest.groups) {
    log(`  ${group.name}: ${group.urls.length}`);
  }
  if (!args.quiet) {
    log(`home: ${manifest.home.url} ← README.md`);
  }
}

main().catch((error) => {
  console.error(`docs: ${error.message}`);
  process.exit(1);
});