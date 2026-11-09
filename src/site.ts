/**
 * One place for everything the site says about the outside world.
 * If a link or a number changes, it changes here — not in twelve components.
 */

export const SITE = {
  name: 'karucode',
  /** The canonical origin. Four files carry it — see README, "Deploy". */
  url: 'https://code.karutoil.site',
  tagline: 'One binary, not a stack.',
  facts: '27.9 MiB binary · 19.2 MiB idle RSS · one SQLite file · no Node at runtime',
  description:
    'karucode is a coding agent that is one 27.9 MiB Rust binary, not a stack: 19.2 MiB idle RSS, one SQLite file for state, any OpenAI-compatible endpoint, approvals before every mutation, and a transcript that survives a restart.',
  repo: 'https://github.com/karutoil/karucode',
  license: 'MIT',
  licenseUrl: 'https://github.com/karutoil/karucode/blob/main/LICENSE',
  author: 'karutoil',
  rust: '1.89+',
} as const;

export const NAV = [
  { href: '/#what-it-does', label: 'What it does' },
  { href: '/#architecture', label: 'Architecture' },
  { href: '/docs/', label: 'Docs' },
  { href: '/security/', label: 'Security' },
] as const;

export const FOOTER_LINKS = [
  {
    title: 'Product',
    links: [
      { href: '/#what-it-does', label: 'What it does' },
      { href: '/#approvals', label: 'Approvals' },
      { href: '/#performance', label: 'Performance' },
      { href: '/#limitations', label: 'What it doesn\u2019t do' },
    ],
  },
  {
    title: 'Docs',
    links: [
      { href: '/docs/', label: 'Overview' },
      { href: '/docs/quickstart/', label: 'Quick start' },
      { href: '/docs/configuration/', label: 'Configuration' },
      { href: '/security/', label: 'Security' },
    ],
  },
  {
    title: 'Project',
    links: [
      { href: SITE.repo, label: 'GitHub', external: true },
      { href: `${SITE.repo}/blob/main/CHANGELOG.md`, label: 'Changelog', external: true },
      { href: SITE.licenseUrl, label: 'MIT licence', external: true },
      { href: `${SITE.repo}/tree/main/branding`, label: 'Brand kit', external: true },
    ],
  },
] as const;
