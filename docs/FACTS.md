# Facts — the only source of truth for copy

Every number and claim on this site must come from this file. If something is not
here, it is not true for our purposes: **do not invent it**. All of it is taken from
the karucode repository (`README.md`, `reports/bench.md`, `docs/SECURITY.md`,
`branding/BRAND.md`) at the time this project started.

## Identity

| | |
| --- | --- |
| Name | `karucode` — one word, lowercase, no space, no camel case, never `K` or `KaruCode` |
| Tagline (short, canonical) | One binary, not a stack. |
| Hero headline | A coding agent that is one binary, not a stack. |
| Positioning | Minimal, not bloated. The claim is measured: 27.9 MiB binary, 19.2 MiB idle RSS, one SQLite file. "Self-hosted" is true but no longer differentiating — keep it as a fact, never as the headline. |
| Facts line | 27.9 MiB binary · 19.2 MiB idle RSS · one SQLite file · no Node at runtime |
| Licence | MIT |
| Language | Rust 1.89+ |
| Repo | https://github.com/karutoil/karucode |
| Runtime deps | none for the frontend: the UI is embedded in the binary and needs no Node at runtime |
| Platforms | Linux is the primary target; other Unixes should work |
| Telemetry | none in the product. (No analytics claim on the site unless the site itself has none — it doesn't.) |

Wordmark: Inter Bold, `-0.04em` tracking, `karu` in text colour and `code` in the accent.

**Hero readout card** (`src/components/hero/Readout.astro`) — the values it displays,
all from this file, so an edit can be checked against its source:

| Row | Value shown | Where it comes from |
| --- | --- | --- |
| `api` | `127.0.0.1:8787 · UI, same origin` | default bind + embedded UI |
| `loop` | `approvals · subagents · budgets` | architecture |
| `model` | `any OpenAI-compatible endpoint` | provider |
| `tools` | `read · search · edit · shell · git · mcp` | tools + MCP |
| `state` | `one SQLite file, WAL mode` | architecture |
| `budget` | `no turn ceiling · 24 h wall clock` | `max_iterations = 0`, `max_run_secs = 86400` |
| ready line | `ready in 37 ms · 19.2 MiB rss` | bench: cold-start average, idle RSS |

Do not add a row that is not in this table; the card is a claim about the running
product, not decoration.

## What it does

- **Adjective-free summary:** a coding agent, delivered as one 27.9 MiB Rust binary that
  embeds its own UI (fonts and all) and keeps all state in one SQLite file. Nothing else to
  deploy.
- Reads your project, searches it, edits files, runs commands with streamed output,
  inspects git, delegates to subagents, and keeps going through multi-step tasks until
  the work is done or you stop it.
- **Long-horizon runs.** `limits.max_iterations` defaults to **0 = no turn ceiling**. A
  run ends when the work is done, when it is cancelled, at `max_run_secs` (**24 h**), or
  when the loop guard catches it repeating calls with no workspace change. No segment,
  no continuation turn, no `[runtime checkpoint]` injected into the transcript. A
  non-zero `max_iterations` is an optional backstop that ends the run `limit_reached`.
- **Real side effects.** Every tool result is bounded with an explicit truncation
  marker — never silently dropped.
- **Approvals before mutations.** `ask` is the default for shell and writes.
- **Containment for file tools.** Every path resolves through a confined workspace.
- **Crash-tolerant.** On restart, leftover `running` runs become `interrupted` and
  pending approvals `expired`; nothing is silently retried.
- **Self-documenting.** Facts about karucode are written as `@kc-doc` comments next to
  the code that implements them and compiled into the binary, so docs cannot drift from
  the build. The model reads them through the read-only `karucode_docs` tool.

## Architecture (from README)

```
browser (Preact UI, served by the same origin)
      REST + SSE
karucode — one Rust binary
├─ axum API + SSE .. embedded UI, same origin
├─ agent loop ...... approvals, subagents, budgets
├─ provider ........ any OpenAI-compatible endpoint
├─ tools ........... files, search, shell, git, docs
├─ plugins + MCP ... out of process, namespaced
└─ SQLite (WAL) .... projects, sessions, runs, agents
```

## Tools

Read, search, write and edit files; run shell commands with streamed output in their
own process group; inspect git; spawn subagents; read karucode's own documentation.
Independent tool calls **run in parallel** by default (`limits.parallel_tool_calls =
true`): reads, listings, searches and git inspections, plus disjoint file writes when the
policy would not ask. Anything the runtime cannot prove independent — `run_command`,
plugins, MCP, subagents, `note`, and any call that would park on an approval — runs in
call order. Results are folded into the transcript in call order either way.

## Approvals

- Default mode `ask` for shell and writes.
- Modes: `ask`, `ask_commands`, `auto`, `read_only`
  (`KARUCODE_APPROVAL_MODE`).
- Command-prefix allowlists (`KARUCODE_ALLOW_COMMANDS`), per-path auto-approval.
- In the UI: allow-once / allow-for-session / deny, all audited.
- `KARUCODE_LOCK_SETTINGS=1` removes the UI settings layer so a deployment can pin
  settings from the environment and reject browser edits with `403`.
- `KARUCODE_ADMIN_TOKEN` is required to change approvals or the endpoint.

## Containment

- Confined workspace: no `..` escapes, no absolute paths outside, symlink escapes
  canonicalised away, writes atomic.
- The system temp dir is an extra root by default (`KARUCODE_ALLOW_TEMP_DIR=true`).
- **Shell commands are explicitly not sandboxed.** Approvals are the gate, not
  isolation. Say this plainly; it is a trust feature, not a footnote.

## Subagents

- Concurrency default 3 (`KARUCODE_SUBAGENT_CONCURRENCY`), live detached agents per
  session default 8 (`KARUCODE_SUBAGENT_MAX_BACKGROUND`).
- Subagents share the parent's live workspace, including dirty and untracked files.
  `owned_paths` is advisory conflict reporting, not a lock.
- Recursive subagents are off by default (`KARUCODE_ALLOW_RECURSIVE_SUBAGENTS=false`).

## Providers

- Anything that speaks the OpenAI chat-completions API with streaming tool calls.
- Named profiles, a model library, model metadata, retries.
- Providers are install-wide, not per project; a *session* can pin its own provider,
  model and reasoning effort.

## Plugins and MCP

- Plugins are separate processes (not Wasm), namespaced, with no filesystem sandbox. A
  rebuilt plugin is picked up by a reload — `POST /api/plugins/reload`,
  `POST /api/plugins/:name/reload`, or `plugins_watch` (off by default) — not by a server
  restart.
- MCP supports stdio and streamable HTTP; tools only — resources and prompts are not
  surfaced. Legacy SSE-only transport is not implemented.

## Security posture

- Binds to loopback by default; a non-loopback bind requires an auth token (≥16 chars)
  **or** `[access] enabled` backed by a real password/passkey.
- Web sign-in: password (Argon2id, constant-time) or passkey (ES256/WebAuthn), exchanged
  for an `HttpOnly`, `SameSite=Lax` session cookie; the server stores only the SHA-256 of
  the session token. Eight wrong attempts from one address in 15 minutes lock it out for
  five. Passkeys verify challenge, origin, RP id, user-present and counter; attestation is
  not verified. `[access]` holds only policy (enabled, public_url, session_days, tunnel,
  trusted_proxies); the credentials live in SQLite and are set by the wizard or Settings.
- The first-run wizard takes model endpoint, appearance, approval mode and access.
- DNS-rebinding defence: with a loopback bind and no token, only `127.0.0.1`,
  `localhost` and `[::1]` Hosts are served. `KARUCODE_ALLOWED_HOSTS` extends the list.
- Browser clients are CSRF-protected: a custom header plus the Origin/Host check.
- Child processes get a credential-free environment allowlist, so a prompt-injected
  `curl` cannot exfiltrate the harness token or the provider key.
- Secrets are never returned to the browser or written to logs.
- Markdown is rendered with raw HTML disabled and then sanitised. A chat artifact is a
  separate document in a sandboxed opaque-origin frame with a random per-artifact
  capability — never the master token.
- No built-in TLS: put a reverse proxy in front for remote access.

## Performance (measured, not promised)

From `reports/bench.md`, host: AMD Ryzen 7 3700X, Linux 6.12, rustc 1.96, release build
with strip + thin LTO. Methodology: temp SQLite DB, local streaming mock provider, no
network; cold start polled on `/api/health`; RSS sampled after 3 s idle and during 3
concurrent runs.

| Metric | Value |
| --- | --- |
| Cold start | **37.4 ms** average (37.5 / 38.1 / 36.6 across three runs) |
| Idle RSS | **19.2 MiB** average |
| Peak RSS, 3 concurrent runs | **28.0 MiB** |
| Binary size | **27.9 MiB** (the whole UI and its fonts are embedded) |
| 3 concurrent runs, wall time | 266 ms |

Re-measured 2026-11-09 at commit 33629c9 with `scripts/bench.py` (release profile,
`strip = true`, `lto = "thin"`), because the UI grew to 7.6 MB of embedded assets and the
old 10.5 MiB / 7.9 ms / 10.2 MiB figures no longer describe the binary.

Always show these with the caveat: numbers are specific to that host and to the mock
provider; RSS during a real run also depends on the provider TLS stack and response
sizes. Never present them as a guarantee or a comparison.

## Configuration precedence (highest first)

1. overrides saved from the UI (SQLite `settings` table)
2. environment variables
3. the config file — `KARUCODE_CONFIG`, default `~/.config/karucode/config.toml`
4. built-in defaults

## Key environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `KARUCODE_HOST` / `KARUCODE_PORT` | `127.0.0.1` / `8787` | bind address; a non-loopback bind needs a token |
| `KARUCODE_WORKSPACE` | cwd | default workspace root |
| `KARUCODE_DATA_DIR` | `~/.local/share/karucode` | SQLite database + plugin data, mode `0700` |
| `KARUCODE_AUTH_TOKEN` | unset | bearer token for remote access (≥16 chars) |
| `KARUCODE_ADMIN_TOKEN` | unset | required to change approvals or the endpoint |
| `KARUCODE_PROJECT_ROOTS` | unset (any dir) | colon-separated allowlist for new project roots |
| `KARUCODE_ALLOW_TEMP_DIR` | `true` | let file tools also reach the system temp dir |
| `KARUCODE_BASE_URL` | `http://127.0.0.1:4000/v1` | OpenAI-compatible base URL |
| `KARUCODE_API_KEY` | unset | provider key (falls back to `OPENAI_API_KEY`) |
| `KARUCODE_MODEL` | `gpt-4o-mini` | model id |
| `KARUCODE_APPROVAL_MODE` | `ask` | `ask`, `ask_commands`, `auto`, `read_only` |
| `KARUCODE_ALLOW_COMMANDS` | empty | command prefixes that are never prompted for |
| `KARUCODE_MAX_ITERATIONS` | `0` | turns per run; `0` = no ceiling |
| `KARUCODE_PARALLEL_TOOL_CALLS` | `true` | run provably independent tool calls at once |
| `KARUCODE_MAX_RUN_SECS` | `86400` | hard wall clock for a whole run |
| `KARUCODE_COMMAND_TIMEOUT_SECS` | `120` | default shell timeout |
| `KARUCODE_MAX_TOOL_OUTPUT_BYTES` | `24000` | tool result bytes kept for the model |
| `KARUCODE_CONTEXT_MAX_CHARS` | `0` | `0` = derive from the model's window |
| `KARUCODE_SUBAGENT_CONCURRENCY` | `3` | concurrent subagents (`0` = no ceiling) |
| `KARUCODE_SUBAGENT_MAX_BACKGROUND` | `8` | live detached agents per session |
| `KARUCODE_ALLOW_RECURSIVE_SUBAGENTS` | `false` | nested delegation |
| `KARUCODE_LOG` | `info` | tracing filter, e.g. `info,karucode=debug` |
| `KARUCODE_ALLOWED_HOSTS` | empty | extra `Host` names for the loopback guard |
| `KARUCODE_ACCESS_ENABLED` | `false` | require a password or passkey for the web UI |
| `KARUCODE_PUBLIC_URL` | unset | the address people type; added to the Host allowlist |
| `KARUCODE_SESSION_DAYS` | `30` | how long a browser stays signed in (1..365) |
| `KARUCODE_TUNNEL` | `none` | `none`, `cloudflare` or `custom` |
| `KARUCODE_TRUSTED_PROXIES` | empty | comma-separated CIDRs whose forwarded headers are believed |

## Install path (there is one)

The release is a prebuilt binary. `packaging/install.sh` is the only install method, and
the three forms below are the same script:

```bash
# service install (needs root): binary + hardened unit, enabled and started
curl -fsSLO https://raw.githubusercontent.com/karutoil/karucode/main/packaging/install.sh
sudo sh install.sh --workspace /srv/karucode/workspace

# binary only, no root, no systemd
sh install.sh --prefix "$HOME/.local" --no-systemd

# upgrade = re-run it (or pin a release)
sudo sh install.sh
sudo sh install.sh --version 0.1.0
```

What it does, and what may be claimed about it:

- Downloads `karucode-<version>-x86_64-unknown-linux-gnu.tar.gz`, verifies it against the
  release's `SHA256SUMS`, and only then unpacks. **Nothing is piped into a shell** — do not
  write `curl | bash` anywhere.
- Installs to `<prefix>/bin/karucode`, keeping the previous binary as `karucode.old`.
- Runs as the account that ran the installer (`$SUDO_USER`, then `$LOGNAME`, then the
  session login uid); never root, never a newly created account.
- Writes site paths to `/etc/systemd/system/karucode.service.d/10-install.conf` so
  re-running it for an upgrade cannot lose them. `20-local.conf` is yours.
- Reports success only once `/api/health` answers; on failure the previous unit, drop-in
  and binary are restored (exit 2).
- `--dry-run` prints the plan and changes nothing.

Release shape: one target, `x86_64-unknown-linux-gnu`, produced by the `release` job on a
`v*` tag, with the version taken from the tag and required to match `Cargo.toml`.
Prerequisites for this path: Linux x86_64, `curl`, `sh`, and systemd (or `--no-systemd`).
**Rust 1.89+ and Node 22.12+ are only needed to build from source** — a contributor
workflow, not an install path, and not something the website should offer.

## Known limitations — state these plainly

- **No shell sandbox.** Commands run as the server user. Use a container or VM for
  untrusted code or unattended `auto` mode.
- **Subagents share the live workspace**, including dirty and untracked files;
  `owned_paths` is advisory, not locking.
- **Ordered side effects**: shell, plugins, MCP and subagents run in call order; only
  provably independent calls run in parallel.
- **MCP**: stdio and streamable HTTP only; tools only.
- **Plugins** are processes, not Wasm: no filesystem sandbox; a rebuilt plugin needs a
  reload (`plugins_watch`, off by default) rather than a restart.
- **Providers are install-wide, not per project.**
- **No built-in TLS** — use a reverse proxy (or a Cloudflare Tunnel; `[access] tunnel`).
- **Compaction is trimming**, not model-assisted summarisation.
- Token accounting is whatever the provider reports; absent usage is shown as unknown.

## Claims we must not make

These are the tempting ones. All are false or unverified:

- ❌ "Sandboxed shell" / "secure sandbox" — the shell is explicitly **not** sandboxed.
- ❌ "Fastest", "blazing", "10× better", any comparative benchmark.
- ❌ "Works on Windows" for the server.
- ❌ "Free tier", "pricing", "sign up", "book a demo", any growth CTA.
- ❌ "SOC 2", "audited", "enterprise-grade", "bank-level encryption".
- ❌ "Zero data leaves your machine" — it calls your provider's endpoint.
- ❌ Any user count, download count, star count, or quote from a user.
- ❌ Any feature not in this file: no cloud sync, no mobile app, no team workspaces,
  no built-in model, no voice, no browser automation.
